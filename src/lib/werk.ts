import { db, uid } from './db'
import { enqueue } from './sync'
import type {
  Role, Taak, TaakBron, TaakPrioriteit, TaakProject, TaakReactie, TaakStatus, User,
} from './types'

/* ------------------------------------------------------------------ *
 *  Werk: taken, projecten en het bord
 *
 *  Casper: "Ik wil voor leidinggevende, management en ontwikkelaar een
 *  volledige workflow, met todo's, projectmanagement, kanban board ect."
 *
 *  Er stond van alles in de app dat om aandacht vraagt -- een factuur die
 *  wacht, een storing, een wijzigingsverzoek, een aanmelding -- elk met zijn
 *  eigen tabblad en zijn eigen tellertje. Wie 's ochtends wil weten wat er op
 *  zijn bord ligt moest acht schermen langs, en wat in geen van die acht past
 *  (een gesprek voeren, een monteur bellen) stond nergens.
 *
 *  Dit is die ene lijst. Zie migratie 0067 voor waarom de kolommen vast staan
 *  en waarom een taak aan een rol kan hangen in plaats van aan een persoon.
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
 *  De kolommen
 * ------------------------------------------------------------------ */

export const KOLOMMEN: { key: TaakStatus; label: string; hint: string }[] = [
  { key: 'te_doen', label: 'Te doen', hint: 'Ligt klaar, nog niet begonnen' },
  { key: 'bezig', label: 'Bezig', hint: 'Iemand is ermee aan de slag' },
  /* "Wacht" is de stand waarin het meeste werk hier verkeert: je wacht op
     iemand anders. Zonder eigen kolom blijft dat werk in "bezig" staan en
     lijkt het alsof er aan gewerkt wordt. */
  { key: 'wacht', label: 'Wacht', hint: 'Ligt bij iemand anders' },
  { key: 'klaar', label: 'Klaar', hint: 'Af' },
]

export const PRIORITEITEN: { key: TaakPrioriteit; label: string; tint: string }[] = [
  { key: 'laag', label: 'Laag', tint: 'neutraal' },
  { key: 'normaal', label: 'Normaal', tint: 'info' },
  { key: 'hoog', label: 'Hoog', tint: 'oranje' },
  { key: 'urgent', label: 'Urgent', tint: 'danger' },
]

export const BRON_LABEL: Record<TaakBron, string> = {
  handmatig: 'Zelf toegevoegd',
  sollicitatie: 'Sollicitatie',
  factuur: 'Factuur',
  storing: 'Storing',
  wijziging: 'Wijzigingsverzoek',
  aanmelding: 'Aanmelding',
}

/* ------------------------------------------------------------------ *
 *  Wat ligt er bij mij?
 *
 *  Twee vragen, en het antwoord is de optelsom: wat op mijn naam staat, plus
 *  wat bij mijn rol ligt op een vestiging waar ik bij mag. Dat tweede is werk
 *  dat nog door niemand is opgepakt -- laat je dat weg, dan ziet niemand het
 *  tot iemand er toevallig op klikt.
 * ------------------------------------------------------------------ */

export function isVanMij(t: Taak, wie: User): boolean {
  if (t.toegewezenAan === wie.id) return true
  if (!t.toegewezenRol) return false
  if (!wie.roles.includes(t.toegewezenRol)) return false
  return magBijLocatie(t.locationId, wie)
}

/** Mag deze persoon bij werk van deze vestiging? Zonder vestiging: iedereen. */
export function magBijLocatie(locationId: string | undefined, wie: User): boolean {
  if (!locationId) return true
  if (wie.allLocations) return true
  if (wie.locationId === locationId) return true
  return (wie.manages ?? []).includes(locationId)
}

/** De vestigingen waar iemand werk voor mag zien. Leeg = alles. */
export function mijnLocaties(wie: User): string[] | null {
  if (wie.allLocations) return null
  const uit = new Set<string>()
  if (wie.locationId) uit.add(wie.locationId)
  for (const l of wie.manages ?? []) uit.add(l)
  return [...uit]
}

/* ------------------------------------------------------------------ *
 *  Sorteren
 *
 *  Binnen een kolom telt eerst de handmatige volgorde (slepen), en pas
 *  daarna de rest. Anders springt een kaart die je net verplaatst hebt terug
 *  zodra iemand de prioriteit wijzigt, en dan vertrouwt niemand het bord meer.
 * ------------------------------------------------------------------ */

const PRIO_RANG: Record<TaakPrioriteit, number> = {
  urgent: 0, hoog: 1, normaal: 2, laag: 3,
}

export function opBord(a: Taak, b: Taak): number {
  if (a.volgorde !== b.volgorde) return a.volgorde - b.volgorde
  if (a.prioriteit !== b.prioriteit) return PRIO_RANG[a.prioriteit] - PRIO_RANG[b.prioriteit]
  return a.createdAt - b.createdAt
}

/**
 * Voor een lijst: het dringendst bovenaan.
 *
 * Hier telt de deadline wél zwaarder dan de handmatige volgorde, want een
 * lijst is geen bord -- daar sleept niemand aan, en "wat moet er vandaag af"
 * is de enige vraag die hij beantwoordt. Een taak zonder deadline komt na de
 * taken die er wel een hebben.
 */
export function opDringendheid(a: Taak, b: Taak): number {
  if (a.prioriteit !== b.prioriteit) return PRIO_RANG[a.prioriteit] - PRIO_RANG[b.prioriteit]
  const ad = a.deadline ?? Number.MAX_SAFE_INTEGER
  const bd = b.deadline ?? Number.MAX_SAFE_INTEGER
  if (ad !== bd) return ad - bd
  return a.createdAt - b.createdAt
}

/** Staat de deadline in het verleden, en is hij nog niet af? */
export function isTeLaat(t: Taak, nu = Date.now()): boolean {
  return t.status !== 'klaar' && !!t.deadline && t.deadline < nu
}

/* ------------------------------------------------------------------ *
 *  Taken
 * ------------------------------------------------------------------ */

export const taken = {
  async aanmaken(input: {
    titel: string
    omschrijving?: string
    status?: TaakStatus
    prioriteit?: TaakPrioriteit
    projectId?: string
    locationId?: string
    toegewezenAan?: string
    toegewezenNaam?: string
    toegewezenRol?: Role
    deadline?: number
    bron?: TaakBron
    bronId?: string
    door: Pick<User, 'id' | 'name'>
  }): Promise<Taak> {
    const status = input.status ?? 'te_doen'
    const taak: Taak = {
      id: uid('taak'),
      titel: input.titel.trim(),
      omschrijving: input.omschrijving?.trim() || undefined,
      status,
      prioriteit: input.prioriteit ?? 'normaal',
      projectId: input.projectId,
      locationId: input.locationId,
      toegewezenAan: input.toegewezenAan,
      toegewezenNaam: input.toegewezenNaam,
      toegewezenRol: input.toegewezenRol,
      deadline: input.deadline,
      volgorde: await volgendeVolgorde(status),
      bron: input.bron ?? 'handmatig',
      bronId: input.bronId,
      door: input.door.id,
      doorNaam: input.door.name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    return put('taken', db.taken, taak)
  },

  async bijwerken(id: string, wijziging: Partial<Taak>): Promise<Taak | null> {
    const bestaand = await db.taken.get(id)
    if (!bestaand) return null
    return put('taken', db.taken, { ...bestaand, ...wijziging, id })
  },

  /**
   * Verplaatsen naar een andere kolom, of binnen dezelfde.
   *
   * De volgorde wordt hier opnieuw genummerd voor de hele doelkolom, en niet
   * met een tussenwaarde. Dat kost een paar schrijfacties meer, maar met
   * tussenwaarden lopen de getallen na genoeg verschuivingen tegen elkaar aan
   * en klapt de volgorde om zonder dat iemand iets deed.
   */
  async verplaatsen(id: string, naar: TaakStatus, plek: number, wie: Pick<User, 'id' | 'name'>) {
    const taak = await db.taken.get(id)
    if (!taak) return null

    const kolom = (await db.taken.where('status').equals(naar).toArray())
      .filter((t) => t.id !== id)
      .sort(opBord)

    const grens = Math.max(0, Math.min(plek, kolom.length))
    kolom.splice(grens, 0, { ...taak, status: naar })

    const klaarNu = naar === 'klaar' && taak.status !== 'klaar'
    for (let i = 0; i < kolom.length; i++) {
      const t = kolom[i]
      const nieuw: Taak = {
        ...t,
        status: t.id === id ? naar : t.status,
        volgorde: i,
        ...(t.id === id && klaarNu
          ? { klaarDoor: wie.id, klaarDoorNaam: wie.name, klaarAt: Date.now() }
          : {}),
        ...(t.id === id && naar !== 'klaar'
          ? { klaarDoor: undefined, klaarDoorNaam: undefined, klaarAt: undefined }
          : {}),
      }
      /* Alleen wegschrijven wat werkelijk verandert. Anders duwt één sleep de
         hele kolom door de wachtrij naar de server. */
      if (nieuw.volgorde !== t.volgorde || nieuw.status !== t.status || t.id === id) {
        await put('taken', db.taken, nieuw)
      }
    }
    return db.taken.get(id)
  },

  /** Op je eigen naam zetten. Dit is wat een taak bij een rol persoonlijk maakt. */
  async oppakken(id: string, wie: Pick<User, 'id' | 'name'>) {
    return taken.bijwerken(id, {
      toegewezenAan: wie.id,
      toegewezenNaam: wie.name,
      status: 'bezig',
    })
  },

  async afvinken(id: string, wie: Pick<User, 'id' | 'name'>) {
    return taken.bijwerken(id, {
      status: 'klaar',
      klaarAt: Date.now(),
      klaarDoor: wie.id,
      klaarDoorNaam: wie.name,
    })
  },

  /* Alleen eigen werk mag weg. Een taak die uit het systeem komt hoort
     afgevinkt te worden en niet gewist: anders is de sollicitatie waar hij bij
     hoorde straks door niemand behandeld, en staat nergens meer dat het is
     blijven liggen. De database weigert het ook (0067). */
  async verwijderen(id: string) {
    const taak = await db.taken.get(id)
    if (taak && taak.bron !== 'handmatig') {
      throw new Error('Werk dat uit het systeem komt kun je afvinken, niet weggooien.')
    }
    await db.taken.delete(id)
    await enqueue('taken', 'delete', id, null)
  },
}

async function volgendeVolgorde(status: TaakStatus): Promise<number> {
  const kolom = await db.taken.where('status').equals(status).toArray()
  return kolom.reduce((m, t) => Math.max(m, t.volgorde), -1) + 1
}

/* ------------------------------------------------------------------ *
 *  Werk dat uit het systeem komt
 *
 *  Eén ingang, met opzet. Elk scherm dat zelf een taak aanmaakt zou zijn
 *  eigen manier verzinnen om te kijken of hij er al stond, en dan staat er
 *  na een tweede synchronisatie twee keer hetzelfde op het bord.
 *
 *  De database bewaakt het ook (unieke index op bron + bron_id + van wie),
 *  maar dat levert een foutmelding op in de wachtrij en niet hier. Vandaar
 *  eerst zelf kijken.
 * ------------------------------------------------------------------ */

export async function taakUitSysteem(input: {
  bron: Exclude<TaakBron, 'handmatig'>
  bronId: string
  titel: string
  omschrijving?: string
  prioriteit?: TaakPrioriteit
  locationId?: string
  /** Aan wie: een rol (het gewone geval) of een persoon. */
  toegewezenRol?: Role
  toegewezenAan?: string
  toegewezenNaam?: string
  deadline?: number
  door: Pick<User, 'id' | 'name'>
}): Promise<Taak | null> {
  const bestaat = (await db.taken.where('status').notEqual('__geen__').toArray())
    .some((t) =>
      t.bron === input.bron &&
      t.bronId === input.bronId &&
      (t.toegewezenAan ?? '') === (input.toegewezenAan ?? '') &&
      (t.toegewezenRol ?? '') === (input.toegewezenRol ?? ''))
  if (bestaat) return null

  return taken.aanmaken({ ...input })
}

/* ------------------------------------------------------------------ *
 *  Projecten
 * ------------------------------------------------------------------ */

export const projecten = {
  async aanmaken(input: {
    naam: string
    omschrijving?: string
    kleur?: string
    locationId?: string
    door: Pick<User, 'id' | 'name'>
  }): Promise<TaakProject> {
    const alles = await db.taakProjecten.toArray()
    const project: TaakProject = {
      id: uid('prj'),
      naam: input.naam.trim(),
      omschrijving: input.omschrijving?.trim() || undefined,
      kleur: input.kleur ?? 'brand',
      locationId: input.locationId,
      archief: false,
      volgorde: alles.reduce((m, p) => Math.max(m, p.volgorde), -1) + 1,
      door: input.door.id,
      doorNaam: input.door.name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    return put('taakProjecten', db.taakProjecten, project)
  },

  async bijwerken(id: string, wijziging: Partial<TaakProject>) {
    const bestaand = await db.taakProjecten.get(id)
    if (!bestaand) return null
    return put('taakProjecten', db.taakProjecten, { ...bestaand, ...wijziging, id })
  },

  /* Archiveren en niet weggooien: aan een project hangen taken, en die zijn
     de geschiedenis van wat er is gebeurd. */
  async archiveren(id: string) {
    return projecten.bijwerken(id, { archief: true })
  },
}

/* ------------------------------------------------------------------ *
 *  Reacties
 * ------------------------------------------------------------------ */

export const reacties = {
  async plaatsen(taakId: string, tekst: string, door: Pick<User, 'id' | 'name'>) {
    const reactie: TaakReactie = {
      id: uid('trc'),
      taakId,
      tekst: tekst.trim(),
      door: door.id,
      doorNaam: door.name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    return put('taakReacties', db.taakReacties, reactie)
  },
}
