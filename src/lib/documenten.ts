import { db, uid } from './db'
import { enqueue } from './sync'
import { supabase, supabaseConfigured } from './api/supabaseApi'
import type {
  DocBestand, DocMap, DocToegang, DocZichtbaarheid, Role, TaakDocument, User,
} from './types'

/* ------------------------------------------------------------------ *
 *  Documentbeheer
 *
 *  Casper: "Je moet dingen kunnen afschermen, zichtbaar voor jezelf hebben,
 *  dingen zoals documenten erin kunnen zien, downloaden ect. Ook een soort
 *  verkenner idee erin."
 *
 *  De afscherming zit in de database (migratie 0071, mag_document()) en ook
 *  hier. Dat is met opzet dubbel: de database is de waarheid, maar wat in de
 *  browser ligt is wat er ooit is opgehaald -- en een leidinggevende die van
 *  vestiging wisselt heeft de documenten van zijn vorige vestiging nog in
 *  zijn kast staan.
 * ------------------------------------------------------------------ */

export const EMMER = 'documenten'

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
 *  Wie mag wat
 * ------------------------------------------------------------------ */

export function magDocumentbeheer(wie: User): boolean {
  return wie.roles.some((r) => r === 'supervisor' || r === 'management' || r === 'developer')
}

function bijLocatie(locationId: string | undefined, wie: User): boolean {
  if (!locationId) return true
  if (wie.allLocations) return true
  if (wie.locationId === locationId) return true
  return (wie.manages ?? []).includes(locationId)
}

/**
 * Mag deze persoon dit document zien?
 *
 * Dezelfde regel als mag_document() in 0071, in dezelfde volgorde. Wijkt deze
 * af, dan ziet iemand in de app iets anders dan de database hem geeft -- en
 * dat is bij een afgeschermd document de verkeerde kant op.
 */
export function magZien(
  doc: DocBestand,
  wie: User,
  delingen: DocToegang[] = [],
): boolean {
  if (doc.eigenaar === wie.id) return true
  if (doc.toegewezenAan === wie.id) return true
  if (delingen.some((t) => t.documentId === doc.id && t.profileId === wie.id)) return true

  if (!magDocumentbeheer(wie)) return false

  switch (doc.zichtbaarheid) {
    case 'iedereen': return true
    case 'rollen': return (doc.rollen ?? []).some((r) => wie.roles.includes(r))
    case 'vestiging': return bijLocatie(doc.locationId, wie)
    /* prive en personen zijn hierboven al afgehandeld: wie er niet bij de
       eigenaar, de ontvanger of de delingen stond, mag er niet bij. */
    default: return false
  }
}

/** Mag deze persoon deze map zien? */
export function magMap(map: DocMap, wie: User): boolean {
  if (map.eigenaar) return map.eigenaar === wie.id
  return magDocumentbeheer(wie) && bijLocatie(map.locationId, wie)
}

/**
 * De vestigingen die deze persoon mag kiezen.
 *
 * Dit bestond niet, en dat was de fout: het documentvenster bood ALLE
 * vestigingen aan. Koos een leidinggevende er een waar hij niet over gaat, dan
 * schreef de app het lokaal weg en weigerde de server het met "new row
 * violates row-level security policy" -- waarna het record in de wachtrij
 * bleef staan. Een keuzelijst die iets aanbiedt wat de server terugstuurt is
 * geen keuzelijst maar een val.
 */
export function mijnVestigingen<T extends { id: string }>(alle: T[], wie: User): T[] {
  if (wie.allLocations) return alle
  const mijne = new Set([...(wie.manages ?? []), ...(wie.locationId ? [wie.locationId] : [])])
  return alle.filter((l) => mijne.has(l.id))
}

/**
 * Mag deze persoon iets op deze vestiging zetten?
 *
 * Dezelfde vraag als in_my_locations() op de server. Staat hier omdat een
 * scherm het moet kunnen vragen vóórdat het iets wegschrijft.
 */
export function magVestigingKiezen(locationId: string | undefined, wie: User): boolean {
  return bijLocatie(locationId, wie)
}

export const ZICHTBAARHEID: { key: DocZichtbaarheid; label: string; uitleg: string }[] = [
  { key: 'prive', label: 'Alleen ik', uitleg: 'Niemand anders ziet dit, ook het management niet.' },
  { key: 'personen', label: 'Alleen wie ik kies', uitleg: 'Je wijst er zelf mensen bij aan.' },
  { key: 'vestiging', label: 'De vestiging', uitleg: 'Iedereen met documentrechten op die vestiging.' },
  { key: 'rollen', label: 'Bepaalde rollen', uitleg: 'Bijvoorbeeld alleen het management.' },
  { key: 'iedereen', label: 'Iedereen', uitleg: 'Iedereen die bij het documentbeheer mag.' },
]

/* ------------------------------------------------------------------ *
 *  De verkenner
 * ------------------------------------------------------------------ */

/** Het pad van boven naar deze map, voor de kruimels bovenin. */
export function padNaar(mapId: string | undefined, mappen: DocMap[]): DocMap[] {
  const uit: DocMap[] = []
  let nu = mappen.find((m) => m.id === mapId)
  /* Een grens, want een map die (door een fout) zijn eigen voorouder is zou
     hier voor altijd blijven lopen en het scherm laten vastlopen. */
  for (let i = 0; nu && i < 32; i++) {
    uit.unshift(nu)
    nu = nu.ouderId ? mappen.find((m) => m.id === nu!.ouderId) : undefined
  }
  return uit
}

export const mappen = {
  async aanmaken(input: {
    naam: string
    ouderId?: string
    locationId?: string
    /** Waar = een privémap van deze persoon. */
    prive?: boolean
    door: Pick<User, 'id' | 'name'>
  }): Promise<DocMap> {
    const alle = await db.docMappen.toArray()
    const map: DocMap = {
      id: uid('dmap'),
      naam: input.naam.trim(),
      ouderId: input.ouderId,
      locationId: input.locationId,
      eigenaar: input.prive ? input.door.id : undefined,
      volgorde: alle.filter((m) => m.ouderId === input.ouderId)
        .reduce((m, x) => Math.max(m, x.volgorde), -1) + 1,
      door: input.door.id,
      doorNaam: input.door.name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    return put('docMappen', db.docMappen, map)
  },

  async hernoemen(id: string, naam: string) {
    const bestaand = await db.docMappen.get(id)
    if (!bestaand) return null
    return put('docMappen', db.docMappen, { ...bestaand, naam: naam.trim() })
  },

  /**
   * Weggooien.
   *
   * De mappen eronder gaan mee (dat doet de database), de documenten niet:
   * die vallen terug naar het postvak. Een document dat verdwijnt omdat
   * iemand een map opruimde is precies wat een documentsysteem niet mag doen.
   */
  async verwijderen(id: string) {
    const erin = await db.docBestanden.where('mapId').equals(id).toArray()
    for (const doc of erin) {
      await put('docBestanden', db.docBestanden, { ...doc, mapId: undefined })
    }
    const eronder = await db.docMappen.where('ouderId').equals(id).toArray()
    for (const m of eronder) await mappen.verwijderen(m.id)

    await db.docMappen.delete(id)
    await enqueue('docMappen', 'delete', id, null)
    return erin.length
  },
}

/* ------------------------------------------------------------------ *
 *  Documenten
 * ------------------------------------------------------------------ */

/**
 * Een pad in de emmer.
 *
 * Jaar en maand ervoor, zodat de emmer na een paar duizend documenten nog te
 * doorzoeken is met een gewone bestandsbrowser. De id erin, zodat twee
 * bestanden met dezelfde naam elkaar niet overschrijven -- en dat gebeurt:
 * "factuur.pdf" komt elke maand langs.
 */
export function maakPad(naam: string, id: string): string {
  const nu = new Date()
  const maand = `${nu.getFullYear()}-${String(nu.getMonth() + 1).padStart(2, '0')}`
  const kaal = naam
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(-80)
  return `${maand}/${id}-${kaal || 'bestand'}`
}

export const documenten = {
  /**
   * Een bestand uploaden.
   *
   * Eerst naar de opslag, dan pas de rij. Andersom zou er een document in de
   * lijst staan waar geen bestand bij hoort, en dat is erger: dan klikt
   * iemand op iets dat er niet is en weet hij niet of het kwijt is of nooit
   * is aangekomen. Mislukt de rij, dan blijft er een bestand liggen dat de
   * opruiming weghaalt.
   */
  async uploaden(input: {
    bestand: File
    mapId?: string
    locationId?: string
    zichtbaarheid?: DocZichtbaarheid
    rollen?: Role[]
    toegewezenAan?: string
    toegewezenNaam?: string
    omschrijving?: string
    door: Pick<User, 'id' | 'name'>
  }): Promise<DocBestand> {
    if (!supabaseConfigured) {
      throw new Error('Uploaden kan alleen met verbinding.')
    }
    const id = uid('doc')
    const pad = maakPad(input.bestand.name, id)

    const { error } = await supabase().storage.from(EMMER).upload(pad, input.bestand, {
      contentType: input.bestand.type || 'application/octet-stream',
      upsert: false,
    })
    if (error) throw new Error(`Uploaden lukte niet: ${error.message}`)

    const doc: DocBestand = {
      id,
      naam: input.bestand.name,
      omschrijving: input.omschrijving?.trim() || undefined,
      mapId: input.mapId,
      opslag: 'supabase',
      emmer: EMMER,
      pad,
      mime: input.bestand.type || undefined,
      grootte: input.bestand.size,
      bron: 'upload',
      zichtbaarheid: input.zichtbaarheid ?? 'vestiging',
      eigenaar: input.door.id,
      locationId: input.locationId,
      rollen: input.rollen ?? [],
      toegewezenAan: input.toegewezenAan,
      toegewezenNaam: input.toegewezenNaam,
      door: input.door.id,
      doorNaam: input.door.name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    return put('docBestanden', db.docBestanden, doc)
  },

  /**
   * Bijwerken.
   *
   * `wie` is optioneel maar hoort meegegeven te worden zodra er een vestiging
   * in de wijziging zit: dan wordt hier geweigerd wat de server ook zou
   * weigeren, mét een melding op het scherm in plaats van een record dat
   * onzichtbaar in de wachtrij blijft hangen.
   */
  async bijwerken(id: string, wijziging: Partial<DocBestand>, wie?: User) {
    const bestaand = await db.docBestanden.get(id)
    if (!bestaand) return null
    if (wie && 'locationId' in wijziging && !magVestigingKiezen(wijziging.locationId, wie)) {
      throw new Error('Je kunt een document niet op een vestiging zetten waar je niet over gaat.')
    }
    return put('docBestanden', db.docBestanden, { ...bestaand, ...wijziging, id })
  },

  /** Ergens neerzetten: in een map, bij een persoon, of op een vestiging. */
  async opbergen(id: string, waar: {
    mapId?: string
    locationId?: string
    toegewezenAan?: string
    toegewezenNaam?: string
    zichtbaarheid?: DocZichtbaarheid
  }, wie?: User) {
    return documenten.bijwerken(id, waar, wie)
  },

  /**
   * Een ondertekende link van zestig seconden.
   *
   * Nooit een openbaar adres: de emmer staat dicht en de leesregel in 0071
   * hangt aan mag_document(). Een link die blijft werken is een afscherming
   * die niet afschermt.
   */
  async link(doc: DocBestand): Promise<string | null> {
    if (!supabaseConfigured) return null
    if (doc.opslag !== 'supabase') return null
    const { data, error } = await supabase().storage.from(doc.emmer)
      .createSignedUrl(doc.pad, 60)
    if (error) return null
    return data?.signedUrl ?? null
  },

  /**
   * Weggooien: eerst de rij, dan het bestand.
   *
   * Andersom zou er een rij overblijven die naar niets wijst als het tweede
   * deel mislukt. Nu blijft er hooguit een bestand liggen dat niemand meer
   * kan opvragen -- de leesregel vindt geen rij.
   */
  async verwijderen(id: string) {
    const doc = await db.docBestanden.get(id)
    if (!doc) return
    await db.docBestanden.delete(id)
    await enqueue('docBestanden', 'delete', id, null)
    if (supabaseConfigured && doc.opslag === 'supabase') {
      await supabase().storage.from(doc.emmer).remove([doc.pad]).catch(() => undefined)
    }
  },
}

/* ------------------------------------------------------------------ *
 *  Delen met losse personen
 * ------------------------------------------------------------------ */

export const delen = {
  async met(documentId: string, profileId: string, door: Pick<User, 'id' | 'name'>) {
    const al = (await db.docToegang.where('documentId').equals(documentId).toArray())
      .find((t) => t.profileId === profileId)
    if (al) return al

    const rij: DocToegang = {
      id: uid('dtg'),
      documentId,
      profileId,
      door: door.id,
      doorNaam: door.name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    return put('docToegang', db.docToegang, rij)
  },

  async intrekken(id: string) {
    await db.docToegang.delete(id)
    await enqueue('docToegang', 'delete', id, null)
  },
}

/* ------------------------------------------------------------------ *
 *  Aan een taak hangen
 * ------------------------------------------------------------------ */

export const aanTaak = {
  async hangen(taakId: string, documentId: string, door: Pick<User, 'id'>) {
    const al = (await db.taakDocumenten.where('taakId').equals(taakId).toArray())
      .find((t) => t.documentId === documentId)
    if (al) return al

    const rij: TaakDocument = {
      id: uid('tdoc'),
      taakId,
      documentId,
      door: door.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    return put('taakDocumenten', db.taakDocumenten, rij)
  },

  async loshalen(id: string) {
    await db.taakDocumenten.delete(id)
    await enqueue('taakDocumenten', 'delete', id, null)
  },
}

/* ------------------------------------------------------------------ *
 *  Kleine dingen
 * ------------------------------------------------------------------ */

export function leesbaarFormaat(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Een grove soort voor het icoontje. Niet meer dan dat. */
export function soortVan(doc: DocBestand): 'pdf' | 'beeld' | 'blad' | 'tekst' | 'overig' {
  const m = (doc.mime ?? '').toLowerCase()
  const n = doc.naam.toLowerCase()
  if (m === 'application/pdf' || n.endsWith('.pdf')) return 'pdf'
  if (m.startsWith('image/')) return 'beeld'
  if (/sheet|excel|csv/.test(m) || /\.(xlsx?|csv)$/.test(n)) return 'blad'
  if (/word|text/.test(m) || /\.(docx?|txt)$/.test(n)) return 'tekst'
  return 'overig'
}
