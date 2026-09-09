/**
 * Naspeuren: waarom weigert de database deze twee inserts?
 *
 * Casper: "bij het downloaden krijg ik nog steeds die fout, evenals bij
 * verzenden in chat ... fix dit permanent"
 *
 *   docBestanden   new row violates row-level security policy for doc_bestand
 *   chatMessages   new row violates row-level security policy for chat_messages
 *
 * Dit script bouwt het schema op in een echte PostgreSQL (PGlite, in Node),
 * zet een profiel neer zoals dat in productie staat, en probeert precies die
 * twee inserts. Daarna knijpt het de voorwaarden een voor een af, zodat er
 * niet één oorzaak wordt aangenomen maar aangewezen.
 *
 * Waarom niet gewoon de policy lezen en de fout gokken: dat heb ik gedaan en
 * er kwamen twee kandidaten uit. Een van de twee had een schermwijziging
 * opgeleverd die niets oplost.
 *
 * Draaien:  node scripts/naspeuren.mjs
 */

import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sqlFile = (p) => readFileSync(join(root, p), 'utf8')

const SUPABASE_STUB = `
create role anon;
create role authenticated;
create role service_role;

create schema if not exists auth;

create table auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text unique,
  raw_user_meta_data  jsonb default '{}'::jsonb
);

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on all tables in schema auth to authenticated, service_role;

create schema if not exists storage;
create table storage.buckets (
  id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text, name text, owner uuid
);

grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema storage to authenticated;

/* Supabase geeft anon en authenticated rechten op alles in public, via
   standaardrechten. Zonder dit loopt elke insert op "permission denied" in
   plaats van op de beveiligingsregel, en toets je iets anders dan je denkt. */
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;

alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;
`

const db = await PGlite.create()
await db.exec(SUPABASE_STUB)

for (const f of readdirSync(join(root, 'supabase', 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(sqlFile('supabase/migrations/' + f))
}

const server = () => db.exec("set test.uid = '';")
await server()

/* ------------------------------------------------------------------ *
 *  Het profiel zoals het in productie staat
 *
 *  Management, en -- dit is de aanname die getoetst moet worden -- met
 *  all_locations op de standaardwaarde en zonder losse grants. Dat is wat er
 *  in de database staat als iemand de rol management heeft gekregen en
 *  niemand daarna met de hand rechten heeft aangevinkt: de rechten die de
 *  ROL meebrengt staan in permissions.ts, in de app, en met opzet niet in
 *  de kolom grants.
 * ------------------------------------------------------------------ */

const AUTH = '11111111-1111-1111-1111-111111111111'

await db.exec(`
  insert into auth.users (id, email) values ('${AUTH}', 'casper@truckwash1group.nl')
    on conflict (id) do nothing;

  insert into public.locations (id, code, name, city, kind, active)
  values ('loc_a', 'A', 'Vestiging A', 'Venlo', 'vestiging', true),
         ('loc_b', 'B', 'Vestiging B', 'Ede',   'vestiging', true)
  on conflict (id) do nothing;

  /* handle_new_user() heeft bij het aanmaken van het account al een profiel
     gezet -- op inactief en zonder rollen, want dat is een aanmelding. Dat
     profiel werken we bij in plaats van een tweede te maken; auth_id is
     uniek en een tweede rij zou daar meteen op stuklopen. */
  update public.profiles
     set roles = array['management']::text[],
         active = true,
         location_id = 'loc_a',
         all_locations = false,
         grants = array[]::text[],
         name = 'Casper'
   where auth_id = '${AUTH}';
`)

async function alsCasper(sql) {
  /* Sessiebreed en niet met set_config(..., true): dat laatste geldt alleen
     binnen een transactie, en elke query hier is zijn eigen transactie. Dan
     is auth.uid() bij de volgende opdracht weer leeg -- en dan toets je de
     regels van een niet-ingelogde bezoeker. */
  await db.exec(`set test.uid = '${AUTH}';`)
  await db.exec('set role authenticated;')
  try {
    const r = await db.query(sql)
    return { ok: true, rows: r.rows }
  } catch (e) {
    return { ok: false, fout: String(e.message ?? e).split('\n')[0] }
  } finally {
    await db.exec('reset role;')
    await server()
  }
}

function zeg(wat, uit) {
  console.log(`  ${uit.ok ? 'LUKT ' : 'FAALT'}  ${wat}${uit.ok ? '' : '\n           ' + uit.fout}`)
}

console.log('\n=== de functies die erover beslissen ===')
for (const f of [
  'public.my_roles()',
  'public.my_id()',
  'auth.uid()',
  'public.is_management()',
  'public.is_supervisor()',
  'public.is_technician()',
  'public.is_staff()',
  'public.is_lead()',
  'public.mag_documenten()',
  'public.sees_all_locations()',
  "public.in_my_locations('loc_b')",
  "public.in_my_locations(null)",
  "public.heeft_recht('locations.all')",
  "public.heeft_recht('chat.manage')",
]) {
  const uit = await alsCasper(`select ${f} as x`)
  console.log(`  ${uit.ok ? String(uit.rows[0].x).padEnd(5) : 'fout '} ${f}`)
}

console.log('\n=== een document, zoals de app hem stuurt ===')

zeg("doc zonder vestiging (locationId undefined)", await alsCasper(`
  insert into public.doc_bestand (id, naam, opslag, emmer, pad, bron, zichtbaarheid, eigenaar, door)
  values ('doc_1', 'factuur.pdf', 'supabase', 'documenten', 'p/1', 'upload', 'vestiging', (select id from public.profiles where auth_id = '${AUTH}'), (select id from public.profiles where auth_id = '${AUTH}'))
  returning id;`))

zeg("doc op de EIGEN vestiging (loc_a)", await alsCasper(`
  insert into public.doc_bestand (id, naam, opslag, emmer, pad, bron, zichtbaarheid, eigenaar, door, location_id)
  values ('doc_2', 'factuur.pdf', 'supabase', 'documenten', 'p/2', 'upload', 'vestiging', (select id from public.profiles where auth_id = '${AUTH}'), (select id from public.profiles where auth_id = '${AUTH}'), 'loc_a')
  returning id;`))

zeg("doc op een ANDERE vestiging (loc_b)", await alsCasper(`
  insert into public.doc_bestand (id, naam, opslag, emmer, pad, bron, zichtbaarheid, eigenaar, door, location_id)
  values ('doc_3', 'factuur.pdf', 'supabase', 'documenten', 'p/3', 'upload', 'vestiging', (select id from public.profiles where auth_id = '${AUTH}'), (select id from public.profiles where auth_id = '${AUTH}'), 'loc_b')
  returning id;`))

console.log('\n=== een chatbericht ===')

await db.exec(`
  insert into public.channels (id, name, kind, private, member_ids, location_id)
  values ('ch_open',  'Algemeen',  'kanaal',  false, array[]::text[], null),
         ('ch_vest',  'Venlo',     'vestiging', false, array[]::text[], 'loc_a'),
         ('ch_vestb', 'Ede',       'vestiging', false, array[]::text[], 'loc_b'),
         ('ch_prive', 'Directie',  'kanaal',  true,  array[]::text[], null),
         ('ch_gesp',  'Gesprek',   'gesprek',   true,  array[(select id from public.profiles where auth_id = '${AUTH}'),'u_ander']::text[], null)
  on conflict (id) do nothing;
`)

for (const [wat, kanaal] of [
  ['open kanaal', 'ch_open'],
  ['vestigingskanaal van de eigen vestiging', 'ch_vest'],
  ['vestigingskanaal van een andere vestiging', 'ch_vestb'],
  ['prive kanaal waar hij GEEN lid van is', 'ch_prive'],
  ['gesprek waar hij lid van is', 'ch_gesp'],
]) {
  const kan = await alsCasper(`select public.can_see_channel('${kanaal}') as x`)
  const uit = await alsCasper(`
    insert into public.chat_messages (id, channel_id, author_id, author_name, body, at)
    values ('cm_${kanaal}', '${kanaal}', (select id from public.profiles where auth_id = '${AUTH}'), 'Casper', 'hallo', 1)
    returning id;`)
  console.log(`  ${uit.ok ? 'LUKT ' : 'FAALT'}  ${wat}  (can_see_channel=${kan.ok ? kan.rows[0].x : '?'})`)
  if (!uit.ok) console.log('           ' + uit.fout)
}

console.log('\n=== een kanaal dat alleen plaatselijk bestaat ===')
const uit = await alsCasper(`
  insert into public.chat_messages (id, channel_id, author_id, author_name, body, at)
  values ('cm_weg', 'ch_bestaat_niet', (select id from public.profiles where auth_id = '${AUTH}'), 'Casper', 'hallo', 1)
  returning id;`)
zeg('bericht in een kanaal dat niet op de server staat', uit)

console.log('\n=== de insertregel los, ZONDER returning ===')
{
  const mij = (await db.query(
    "select id from public.profiles where auth_id = $1",
    ['11111111-1111-1111-1111-111111111111'])).rows[0].id

  /* PostgREST stuurt bij een upsert zonder .select() een
     Prefer: return=minimal, en dan staat er geen returning in de opdracht.
     Precies zo toetsen dus -- met returning meet je ook de leesregel, en die
     is een heel ander verhaal. */
  const gevallen = [
    ['geen vestiging', 'null'],
    ['eigen vestiging loc_a', "'loc_a'"],
    ['andere vestiging loc_b', "'loc_b'"],
  ]
  let n = 0
  for (const [wat, loc] of gevallen) {
    n += 1
    const r = await alsCasper(`
      insert into public.doc_bestand
        (id, naam, opslag, emmer, pad, bron, zichtbaarheid, eigenaar, door, door_naam, location_id)
      values ('doc_iso${n}', 'x.pdf', 'supabase', 'documenten', 'p/iso${n}', 'upload',
              'vestiging', '${mij}', '${mij}', 'Casper', ${loc});`)
    console.log(`  ${r.ok ? 'LUKT ' : 'FAALT'}  document met ${wat}`)
    if (!r.ok) console.log('         ' + r.fout)
  }

  console.log('')
  const kanalen = [
    ['open kanaal', 'ch_open'],
    ['prive kanaal, geen lid', 'ch_prive'],
    ['kanaal dat niet op de server staat', 'ch_weg'],
  ]
  let m = 0
  for (const [wat, kanaal] of kanalen) {
    m += 1
    const r = await alsCasper(`
      insert into public.chat_messages (id, channel_id, author_id, author_name, body, at)
      values ('cm_iso${m}', '${kanaal}', '${mij}', 'Casper', 'hallo', 1);`)
    console.log(`  ${r.ok ? 'LUKT ' : 'FAALT'}  bericht in ${wat}`)
    if (!r.ok) console.log('         ' + r.fout)
  }

  console.log('')
  /* En een kanaal aanmaken -- de stap die eraan voorafgaat. Als deze faalt,
     bestaat het kanaal alleen plaatselijk en is elk bericht erin voor altijd
     geweigerd, ongeacht wat er verder klopt. */
  const rk = await alsCasper(`
    insert into public.channels (id, name, kind, private, member_ids)
    values ('ch_nieuw', 'Nieuw kanaal', 'kanaal', false, array[]::text[]);`)
  console.log(`  ${rk.ok ? 'LUKT ' : 'FAALT'}  een kanaal aanmaken (zonder returning)`)
  if (!rk.ok) console.log('         ' + rk.fout)

  const rk2 = await alsCasper(`
    insert into public.channels (id, name, kind, private, member_ids)
    values ('ch_nieuw2', 'Nieuw kanaal 2', 'kanaal', false, array[]::text[])
    returning id;`)
  console.log(`  ${rk2.ok ? 'LUKT ' : 'FAALT'}  een kanaal aanmaken (MET returning)`)
  if (!rk2.ok) console.log('         ' + rk2.fout)
}

console.log('\n=== de uitdrukking van de regel, stuk voor stuk ===')
for (const uit of [
  "public.mag_documenten()",
  "public.in_my_locations(null)",
  "public.mag_documenten() and public.in_my_locations(null)",
  "public.rij_bestaat('public.doc_bestand'::regclass, 'doc_nieuw')",
  "public.rij_bestaat('public.doc_bestand'::regclass, 'doc_nieuw') or (public.mag_documenten() and public.in_my_locations(null))",
]) {
  const r = await alsCasper(`select (${uit}) as x`)
  console.log(`  ${r.ok ? String(r.rows[0].x).padEnd(5) : 'FOUT '} ${uit}`)
  if (!r.ok) console.log('         ' + r.fout)
}

console.log('\n=== de insert met de kolommen die de app werkelijk stuurt ===')
{
  const mij = (await db.query(
    "select id from public.profiles where auth_id = $1", ['11111111-1111-1111-1111-111111111111'])).rows[0].id
  const r = await alsCasper(`
    insert into public.doc_bestand
      (id, naam, opslag, emmer, pad, bron, zichtbaarheid, eigenaar, door, door_naam)
    values ('doc_kaal', 'x.pdf', 'supabase', 'documenten', 'p/k', 'upload', 'vestiging',
            '${mij}', '${mij}', 'Casper')
    returning id;`)
  console.log(`  ${r.ok ? 'LUKT ' : 'FAALT'}  kaal, MET returning`)
  if (!r.ok) console.log('         ' + r.fout)

  /* Zonder returning. Een insert met returning vraagt OOK leesrecht op de
     nieuwe rij, en doc_bestand_select gaat via mag_document() -- een stabiele
     security-definer-functie die de tabel opnieuw bevraagt en de rij die nog
     wordt ingevoegd dus niet ziet. */
  const r2 = await alsCasper(`
    insert into public.doc_bestand
      (id, naam, opslag, emmer, pad, bron, zichtbaarheid, eigenaar, door, door_naam)
    values ('doc_kaal2', 'x.pdf', 'supabase', 'documenten', 'p/k2', 'upload', 'vestiging',
            '${mij}', '${mij}', 'Casper');`)
  console.log(`  ${r2.ok ? 'LUKT ' : 'FAALT'}  kaal, ZONDER returning`)
  if (!r2.ok) console.log('         ' + r2.fout)

  const r3 = await alsCasper("select public.mag_document('doc_kaal2') as x")
  console.log(`  mag_document('doc_kaal2') na het invoegen = ${r3.ok ? r3.rows[0].x : r3.fout}`)
}

console.log('\n=== de regels zoals ze ECHT in de database staan ===')
for (const tabel of ['doc_bestand', 'chat_messages']) {
  const r = await db.query(`
    select policyname, cmd, permissive, qual, with_check
      from pg_policies where schemaname = 'public' and tablename = $1
     order by cmd, policyname`, [tabel])
  console.log(`\n  ${tabel}:`)
  for (const p of r.rows) {
    console.log(`    ${p.cmd.padEnd(6)} ${p.permissive.padEnd(10)} ${p.policyname}`)
    if (p.with_check) console.log(`           check: ${p.with_check}`)
  }
}

console.log('\n=== triggers ===')
for (const tabel of ['doc_bestand', 'chat_messages']) {
  const r = await db.query(`
    select tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = $1 and not t.tgisinternal`, [tabel])
  console.log(`  ${tabel}: ${r.rows.map((x) => x.tgname).join(', ') || '(geen)'}`)
}

await db.close()
console.log('')
