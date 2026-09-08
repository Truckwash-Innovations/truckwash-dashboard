import { db, uid } from './db'
import { enqueue } from './sync'
import { users as userRepo } from './repo'
import type {
  Functiegroep, Sollicitatie, SollicitatieStatus, User, Vacature,
} from './types'

/* ------------------------------------------------------------------ *
 *  Werving: vacatures en sollicitaties
 *
 *  Casper: "je moet de sollicitaties ook aanpassen ipv trainstation (...)
 *  zorg dat dan ook alle gegevens deels zijn ingevuld, waardoor ik op een knop
 *  kan drukken, en de gemiste dingen (ID, bankpas, contract ect) enkel hoef in
 *  te scannen en toe te voegen."
 *
 *  Dat laatste is waar naarMedewerker() voor is: alles wat de sollicitant zelf
 *  heeft ingevuld gaat mee naar het dossier, zodat wat overblijft precies de
 *  dingen zijn die je niet kúnt invullen -- een kopie van een ID, een bankpas,
 *  een getekend contract.
 * ------------------------------------------------------------------ */

async function put<T extends { id: string; updatedAt?: number }>(
  entity: Parameters<typeof enqueue>[0],
  table: { put: (v: T) => Promise<unknown> },
  record: T,
) {
  const stamped = { ...record, updatedAt: Date.now() }
  await table.put(stamped)
  await enqueue(entity, 'put', record.id, stamped)
  return stamped
}

/* ------------------------------------------------------------------ *
 *  Statussen
 * ------------------------------------------------------------------ */

export const SOL_STATUS: { key: SollicitatieStatus; label: string; tint: string }[] = [
  { key: 'nieuw', label: 'Nieuw', tint: 'brand' },
  { key: 'gesprek', label: 'Gesprek', tint: 'info' },
  { key: 'proefdag', label: 'Proefdag', tint: 'oranje' },
  { key: 'aangenomen', label: 'Aangenomen', tint: 'ok' },
  { key: 'afgewezen', label: 'Afgewezen', tint: 'neutraal' },
  { key: 'ingetrokken', label: 'Ingetrokken', tint: 'neutraal' },
]

export const FUNCTIEGROEPEN: { key: Functiegroep; label: string }[] = [
  { key: 'FG1', label: 'FG1 — Junior' },
  { key: 'FG2', label: 'FG2 — Allrounder' },
  { key: 'FG3', label: 'FG3 — Senior' },
  { key: 'FG4', label: 'FG4 — Teamleider' },
  { key: 'FG5', label: 'FG5 — Bedrijfsleider' },
]

export const DAGEN = [
  'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag',
] as const

/**
 * Leeftijd uit een geboortedatum.
 *
 * Het gespreksformulier vraagt naar de leeftijd; wij bewaren de geboortedatum
 * en rekenen hem elke keer opnieuw uit. Anders klopt hij na een verjaardag
 * niet meer -- en het loon uit de salaristabel hangt eraan.
 */
export function leeftijd(geboortedatum?: string, nu = new Date()): number | null {
  if (!geboortedatum || !/^\d{4}-\d{2}-\d{2}$/.test(geboortedatum)) return null
  const [j, m, d] = geboortedatum.split('-').map(Number)
  let uit = nu.getFullYear() - j
  const gehad = nu.getMonth() + 1 > m || (nu.getMonth() + 1 === m && nu.getDate() >= d)
  if (!gehad) uit -= 1
  return uit >= 0 && uit < 120 ? uit : null
}

/* ------------------------------------------------------------------ *
 *  Vacatures
 * ------------------------------------------------------------------ */

/**
 * Een slug uit een titel.
 *
 * Alleen kleine letters, cijfers en streepjes: dit wordt een pad op de
 * website, en een spatie of een accent in een adres is een adres dat elke
 * browser anders opschrijft.
 */
export function slugVan(titel: string): string {
  return titel
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/**
 * Mag deze persoon deze vacature aanmaken of wijzigen?
 *
 * Casper: "leiding voor hun locaties, managment voor alles (incl locaties)".
 *
 * Een lege lijst vestigingen betekent "overal", en dat mag een leidinggevende
 * dus niet -- niet omdat hij geen vacature mag maken, maar omdat "overal" ook
 * de zeventien vestigingen bevat waar hij niets te zeggen heeft. Dezelfde
 * regel staat in de database (mag_vacature in 0068).
 */
export function magVacature(locaties: string[], wie: User): boolean {
  if (wie.allLocations || wie.roles.includes('management') || wie.roles.includes('developer')) {
    return true
  }
  if (!wie.roles.includes('supervisor')) return false
  if (!locaties.length) return false
  const mijne = new Set([...(wie.manages ?? []), ...(wie.locationId ? [wie.locationId] : [])])
  return locaties.every((l) => mijne.has(l))
}

export const vacatures = {
  async aanmaken(input: {
    titel: string
    intro?: string
    tekst?: string
    taken?: string[]
    eisen?: string[]
    bieden?: string[]
    uren?: string
    functiegroep?: Functiegroep
    locaties: string[]
    door: Pick<User, 'id' | 'name'>
  }): Promise<Vacature> {
    const alle = await db.vacatures.toArray()
    const basis = slugVan(input.titel) || 'vacature'

    /* Een slug moet uniek zijn: twee vacatures op hetzelfde adres betekent dat
       er één onbereikbaar is. Bij botsing een cijfer erachter, en niet een
       foutmelding -- de titel is van Casper, het adres is een technisch
       gevolg. */
    let slug = basis
    for (let n = 2; alle.some((v) => v.slug === slug); n++) slug = `${basis}-${n}`

    const vacature: Vacature = {
      id: uid('vac'),
      slug,
      titel: input.titel.trim(),
      functiegroep: input.functiegroep,
      intro: (input.intro ?? '').trim(),
      tekst: (input.tekst ?? '').trim(),
      taken: (input.taken ?? []).filter((t) => t.trim()),
      eisen: (input.eisen ?? []).filter((t) => t.trim()),
      bieden: (input.bieden ?? []).filter((t) => t.trim()),
      uren: input.uren?.trim() || undefined,
      locaties: input.locaties,
      actief: true,
      volgorde: alle.reduce((m, v) => Math.max(m, v.volgorde), -1) + 1,
      door: input.door.id,
      doorNaam: input.door.name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    return put('vacatures', db.vacatures, vacature)
  },

  async bijwerken(id: string, wijziging: Partial<Vacature>) {
    const bestaand = await db.vacatures.get(id)
    if (!bestaand) return null
    return put('vacatures', db.vacatures, { ...bestaand, ...wijziging, id })
  },

  /* Uitzetten en niet weggooien: aan een vacature hangen sollicitaties, en
     die horen te blijven staan met de titel waarop iemand solliciteerde. */
  async sluiten(id: string) {
    return vacatures.bijwerken(id, { actief: false })
  },
}

/* ------------------------------------------------------------------ *
 *  Sollicitaties
 * ------------------------------------------------------------------ */

export const sollicitaties = {
  async bijwerken(id: string, wijziging: Partial<Sollicitatie>, door?: Pick<User, 'id' | 'name'>) {
    const bestaand = await db.sollicitaties.get(id)
    if (!bestaand) return null
    return put('sollicitaties', db.sollicitaties, {
      ...bestaand,
      ...wijziging,
      ...(door ? {
        behandeldDoor: door.id,
        behandeldDoorNaam: door.name,
        behandeldAt: Date.now(),
      } : {}),
      id,
    })
  },

  async zetStatus(id: string, status: SollicitatieStatus, door: Pick<User, 'id' | 'name'>) {
    return sollicitaties.bijwerken(id, { status }, door)
  },
}

/* ------------------------------------------------------------------ *
 *  Van sollicitant naar medewerker
 *
 *  De knop waar Casper om vroeg. Alles wat de sollicitant zelf heeft
 *  ingevuld gaat mee naar het dossier; wat overblijft is precies wat je niet
 *  kunt invullen omdat het gescand moet worden.
 *
 *  Wat er bewust NIET automatisch gebeurt:
 *
 *   - er wordt geen inlogaccount gemaakt. Dat kan alleen met beheerdersrechten
 *     en die zitten met opzet niet in de app; de server koppelt het account op
 *     e-mailadres zodra het er is.
 *   - er wordt geen loon gezet. De salaristabel hangt aan leeftijd én
 *     functiegroep, en een bedrag dat de app zelf invult is een bedrag dat
 *     niemand meer narekent.
 *   - het dossier komt op de vestiging van de sollicitatie te staan, en de
 *     rol is 'employee'. Meer weten we niet, en meer gokken is erger dan
 *     openlaten.
 * ------------------------------------------------------------------ */

/** Wat er na het aanmaken nog met de hand bij moet. */
export const NOG_NODIG = [
  'Kopie identiteitsbewijs',
  'Bankgegevens (IBAN)',
  'Getekend contract',
  'Loonheffingsverklaring',
] as const

export async function naarMedewerker(
  sollicitatie: Sollicitatie,
  door: Pick<User, 'id' | 'name'>,
): Promise<User> {
  if (sollicitatie.profileId) {
    const bestaand = await db.users.get(sollicitatie.profileId)
    if (bestaand) return bestaand
  }

  /* Een dossier op hetzelfde e-mailadres bestaat al: dan is dit dezelfde
     persoon die eerder is aangenomen, en een tweede dossier maken is de
     zekerste manier om zijn uren over twee dossiers te verdelen. */
  const opEmail = (await db.users.toArray())
    .find((u) => u.email.toLowerCase() === sollicitatie.email.toLowerCase())
  if (opEmail) {
    await sollicitaties.bijwerken(sollicitatie.id, { profileId: opEmail.id })
    return opEmail
  }

  const notities = [
    sollicitatie.vacatureTitel ? `Aangenomen op: ${sollicitatie.vacatureTitel}` : null,
    sollicitatie.geboortedatum ? `Geboortedatum: ${sollicitatie.geboortedatum}` : null,
    sollicitatie.woonplaats ? `Woonplaats: ${sollicitatie.woonplaats}` : null,
    sollicitatie.vervoer ? `Vervoer: ${sollicitatie.vervoer}` : null,
    sollicitatie.rijbewijs === true ? 'Heeft rijbewijs' : null,
    sollicitatie.opleiding ? `Opleiding: ${sollicitatie.opleiding}` : null,
    beschikbaarheidTekst(sollicitatie),
    '',
    'Nog aanleveren: ' + NOG_NODIG.join(', ') + '.',
  ].filter(Boolean).join('\n')

  const medewerker = await userRepo.create({
    name: sollicitatie.naam,
    email: sollicitatie.email,
    roles: ['employee'],
    phone: sollicitatie.telefoon,
    startDate: Date.now(),
    notes: notities,
  })

  /* De vestiging staat niet in create(); die wordt er los bij gezet zodat de
     nieuwe medewerker meteen op de goede plek staat. */
  if (sollicitatie.locationId) {
    await userRepo.update(medewerker.id, { locationId: sollicitatie.locationId })
  }

  await sollicitaties.bijwerken(sollicitatie.id, {
    profileId: medewerker.id,
    status: 'aangenomen',
  }, door)

  return medewerker
}

/** De beschikbaarheid als één regel, voor in de notities van het dossier. */
export function beschikbaarheidTekst(s: Sollicitatie): string | null {
  const gevuld = (s.beschikbaarheid ?? []).filter((b) => b.van || b.tot || b.opmerking)
  if (!gevuld.length) return null
  return 'Beschikbaar: ' + gevuld
    .map((b) => `${b.dag} ${[b.van, b.tot].filter(Boolean).join('-') || 'in overleg'}` +
                (b.opmerking ? ` (${b.opmerking})` : ''))
    .join('; ')
}
