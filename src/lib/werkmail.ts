/* ------------------------------------------------------------------ *
 *  Het werkadres van een medewerker
 *
 *  Casper: "voor werknemers moet ik een soort microsoft 365 kunnen
 *  aanklikken, dan krijgen ze automatisch een mail, met hun voornaam@domein."
 *
 *  Dit is die knop. Wat er achter zit -- het postvak, het mailprogramma, de
 *  documenten -- komt later; dit stuk is in elke variant daarvan hetzelfde en
 *  is het enige deel dat je naderhand niet meer kunt rechtzetten. Een adres
 *  dat eenmaal is uitgedeeld staat op briefpapier en bij klanten in hun
 *  adresboek.
 *
 *  Twee adressen
 *  -------------
 *
 *  user.email blijft het privéadres: daarmee logt iemand in en daar gaan zijn
 *  meldingen heen. user.werkEmail komt ernaast. Die splitsing is geen detail
 *  maar de reden dat dit werkt: zou de melding naar het werkadres gaan, dan
 *  komt de uitnodiging om dat postvak te openen in dat postvak.
 *
 *  Het adres bedenkt de server
 *  ---------------------------
 *
 *  En niet dit bestand. Twee schermen die tegelijk een Jan aanzetten stellen
 *  allebei jan@ voor; de database kijkt in dezelfde transactie wat vrij is.
 *  Zie werkadres_voorstel() in migratie 0081.
 * ------------------------------------------------------------------ */

import { db, uid } from './db'
import { enqueue } from './sync'
import { supabase, supabaseConfigured } from './api/supabaseApi'
import { handtekeningVoor } from './handtekening'
import type { Postbus, PostbusLid, User } from './types'

/**
 * Welk adres zou deze persoon krijgen?
 *
 * Null als er geen domein is ingesteld, of als de naam niets oplevert om een
 * adres van te maken. Het scherm hoort dat te zeggen in plaats van een knop
 * aan te bieden die niets doet.
 */
export async function werkadresVoorstel(userId: string): Promise<string | null> {
  if (!supabaseConfigured) return null
  const { data, error } = await supabase().rpc('werkadres_voorstel', { wie: userId })
  if (error) throw new Error(error.message)
  const adres = typeof data === 'string' ? data.trim() : ''
  return adres || null
}

/**
 * Het postvak aanzetten.
 *
 * Bij de eerste keer wordt het adres vastgelegd; daarna blijft het staan, ook
 * als het postvak later weer uit gaat. Dat is met opzet: post die binnenkomt
 * op het adres van iemand die weg is, hoort niet bij de volgende Jan terecht
 * te komen.
 */
export async function zetWerkmail(gebruiker: User, aan: boolean): Promise<User> {
  let adres = gebruiker.werkEmail

  if (aan && !adres) {
    adres = (await werkadresVoorstel(gebruiker.id)) ?? undefined
    if (!adres) {
      throw new Error(
        'Er is nog geen werkdomein ingesteld, of uit deze naam valt geen adres '
        + 'te maken. Zet het domein bij Beheer.')
    }
  }

  /*
   * En meteen een handtekening, als hij er nog geen heeft.
   *
   * Hier en niet bij het eerste bericht: dan staat hij er al voordat iemand
   * zijn eerste mail typt, en kan hij hem rustig bijstellen in plaats van te
   * ontdekken dat er iets onder zijn verstuurde bericht stond.
   *
   * Alleen als het veld leeg is. Iemand die hem heeft aangepast en zijn
   * postvak even uit- en weer aanzet, hoort zijn eigen tekst terug te
   * krijgen -- niet die van ons.
   */
  const handtekening = aan && !gebruiker.mailHandtekening?.trim()
    ? handtekeningVoor({ ...gebruiker, werkEmail: adres },
        (await db.locations.get(gebruiker.locationId ?? ''))?.name)
    : gebruiker.mailHandtekening

  const nieuw: User = {
    ...gebruiker,
    werkEmail: adres,
    werkMailAan: aan,
    mailHandtekening: handtekening,
    /* Wanneer het voor het eerst aanging. Blijft staan als het later uit
       gaat -- dat is het antwoord op "sinds wanneer had hij dit adres". */
    werkMailSinds: gebruiker.werkMailSinds ?? (aan ? Date.now() : undefined),
    updatedAt: Date.now(),
  }

  await db.users.put(nieuw)
  await enqueue('users', 'put', nieuw.id, nieuw)
  return nieuw
}

/**
 * Je eigen handtekening bijstellen.
 *
 * Dit mag je zelf: het is je eigen naam eronder, en 0082 laat de kolom met
 * zoveel woorden buiten de rem op profiles (profiel_bewaak_wijziging) die de
 * rest van het dossier vasthoudt.
 *
 * Leeg bewaren mag ook -- dan komt er niets onder je mail. Dat is een geldige
 * keuze en geen reden om de standaard terug te zetten; wie hem terug wil,
 * drukt op de knop die hem opnieuw voorstelt.
 */
export async function zetHandtekening(gebruiker: User, tekst: string): Promise<User> {
  const nieuw: User = {
    ...gebruiker,
    mailHandtekening: tekst.trim() ? tekst : undefined,
    updatedAt: Date.now(),
  }
  await db.users.put(nieuw)
  await enqueue('users', 'put', nieuw.id, nieuw)
  return nieuw
}

/* ------------------------------------------------------------------ *
 *  Gedeelde postvakken (0084)
 *
 *  info@, verkoop@ -- een adres dat niet aan een mens hangt maar aan het
 *  bedrijf, met een lijst van wie erbij mag. Aanmaken doet het management;
 *  dat is hetzelfde soort besluit als een werkadres uitdelen, want het komt
 *  op briefpapier terecht.
 * ------------------------------------------------------------------ */

/** Alleen het stuk vóór de @ hoeft ingevuld; het domein komt uit Beheer. */
export function postbusAdres(voorvoegsel: string, domein: string): string {
  return `${voorvoegsel.trim().toLowerCase().replace(/^@/, '')}@${domein.trim().toLowerCase()}`
}

export async function maakPostbus(input: {
  adres: string
  naam: string
  omschrijving?: string
  door: Pick<User, 'id' | 'name'>
}): Promise<Postbus> {
  const adres = input.adres.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adres)) {
    throw new Error('Dat is geen geldig adres.')
  }

  const al = (await db.postbussen.toArray())
    .find((p) => p.adres.toLowerCase() === adres)
  if (al) throw new Error(`${adres} bestaat al.`)

  const vak: Postbus = {
    id: uid('pb'),
    adres,
    naam: input.naam.trim() || adres,
    omschrijving: input.omschrijving?.trim() || undefined,
    actief: true,
    door: input.door.id,
    doorNaam: input.door.name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  await db.postbussen.put(vak)
  await enqueue('postbussen', 'put', vak.id, vak)
  return vak
}

/**
 * Een postvak sluiten of heropenen.
 *
 * Weggooien kan niet, ook niet door het management: er hangt post aan. Een
 * gesloten postvak houdt zijn adres bezet en zijn post bewaard, en laat
 * niemand meer binnen -- ook zijn eigen leden niet.
 */
export async function zetPostbusActief(vak: Postbus, actief: boolean): Promise<Postbus> {
  const nieuw = { ...vak, actief, updatedAt: Date.now() }
  await db.postbussen.put(nieuw)
  await enqueue('postbussen', 'put', nieuw.id, nieuw)
  return nieuw
}

/** Iemand toelaten, of bijstellen of hij ook mag versturen. */
export async function zetLid(
  postbusId: string, userId: string, magSturen: boolean, door?: string,
): Promise<PostbusLid> {
  const al = (await db.postbusLeden.toArray())
    .find((l) => l.postbusId === postbusId && l.userId === userId)

  const lid: PostbusLid = al
    ? { ...al, magSturen, updatedAt: Date.now() }
    : {
      id: uid('plid'),
      postbusId,
      userId,
      magSturen,
      door,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

  await db.postbusLeden.put(lid)
  await enqueue('postbusLeden', 'put', lid.id, lid)
  return lid
}

export async function haalLidWeg(lid: PostbusLid): Promise<void> {
  await db.postbusLeden.delete(lid.id)
  await enqueue('postbusLeden', 'delete', lid.id, null)
}

/**
 * Waar een melding heen gaat.
 *
 * Altijd het privéadres, ook als er een werkadres is. Eén functie, zodat er
 * niet op tien plekken een keuze wordt gemaakt die er maar één keer is.
 *
 * Dit staat hier vooral als plek om naar te wijzen: de verleiding om dit
 * "netjes" te maken zodra de postvakken werken is groot, en dan valt iedereen
 * buiten die zijn wachtwoord kwijt is.
 */
export function meldadresVan(gebruiker: Pick<User, 'email'>): string {
  return gebruiker.email
}

/* ------------------------------------------------------------------ *
 *  Op welk domein staan de uitgedeelde adressen?
 *
 *  Casper: "Ik heb hem hier op een ander domein dan bedoeld is... Kan je dit
 *  fixen? gezien ik nu niks kan versturen of krijgen."
 *
 *  Het domein is een instelling, maar een uitgedeeld adres is tekst in
 *  profiles.werk_email. Verander je de instelling, dan gebeurt er met de
 *  bestaande adressen niets -- en niets zei dat. Het scherm beloofde
 *  "voornaam@nieuwdomein.nl" terwijl er mensen op het oude rondliepen, en
 *  een adres op een domein dat Resend niet kent is een adres waar niets heen
 *  gaat en niets vandaan komt.
 * ------------------------------------------------------------------ */

/** Eén domein waarop werkadressen staan. */
export interface WerkDomeinStand {
  domein: string
  hoeveel: number
  /** Is dit het domein dat is ingesteld? */
  isIngesteld: boolean
  /** Hoeveel daarvan een open postvak hebben. */
  openPostvak: number
}

/** Welke domeinen er in gebruik zijn. */
export async function werkadressenStand(): Promise<WerkDomeinStand[]> {
  const { data, error } = await supabase().rpc('werkadressen_stand')
  if (error) throw new Error(error.message)

  return (Array.isArray(data) ? data : []).map((r: Record<string, unknown>) => ({
    domein: String(r.domein ?? ''),
    hoeveel: Number(r.hoeveel) || 0,
    isIngesteld: r.is_ingesteld === true,
    openPostvak: Number(r.open_postvak) || 0,
  }))
}

/** Wat een verhuizing met één adres doet. */
export interface Verhuizing {
  wie: string
  naam: string
  oud: string
  nieuw: string
  gelukt: boolean
  waarom: string
}

/**
 * De adressen meenemen naar een ander domein.
 *
 * Met `echtDoen = false` een proefronde die niets verandert. Dat is geen
 * franje: een botsing -- het nieuwe adres bestaat al, of het is het adres
 * waarmee iemand inlogt -- wil je zien vóórdat je het doet.
 */
export async function werkadressenVerhuizen(
  naar: string,
  opties: { van?: string; echtDoen?: boolean } = {},
): Promise<Verhuizing[]> {
  const { data, error } = await supabase().rpc('werkadressen_verhuizen', {
    naar_in: naar,
    van_in: opties.van ?? null,
    echt_doen: opties.echtDoen === true,
  })
  if (error) throw new Error(error.message)

  return (Array.isArray(data) ? data : []).map((r: Record<string, unknown>) => ({
    wie: String(r.wie ?? ''),
    naam: String(r.naam ?? ''),
    oud: String(r.oud ?? ''),
    nieuw: String(r.nieuw ?? ''),
    gelukt: r.gelukt === true,
    waarom: String(r.waarom ?? ''),
  }))
}
