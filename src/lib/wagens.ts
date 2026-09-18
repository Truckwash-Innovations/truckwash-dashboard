import { db, uid } from './db'
import { enqueue } from './sync'
import type { User, Wagen, WagenSoort } from './types'

/* ------------------------------------------------------------------ *
 *  Het wagenpark van een bedrijf
 *
 *  Waarom dit bestaat: een kenteken lag op vijf plekken als vrije tekst en
 *  er waren drie schrijfwijzen in omloop. De kassa maakt er hoofdletters van,
 *  het zoeken haalt de streepjes weg. Daardoor waren BX-JT-42 en BXJT42 twee
 *  verschillende wagens, en zou een kenteken dat een camera leest nooit
 *  matchen met wat een bedrijf intikte.
 *
 *  Eén schrijfwijze dus, en die staat in de database: kenteken_kaal() uit
 *  migratie 0114, gezet door een trigger. De app vult dat veld niet in.
 *
 *  `kaal()` hieronder is een kopie van diezelfde regel, en dat is bewust een
 *  kopie en geen tweede waarheid: hij is er om lokaal te kunnen zoeken en om
 *  een dubbele wagen te herkennen vóórdat de server het zegt. Wat er
 *  uiteindelijk staat bepaalt de database. Wijkt deze functie ooit af, dan
 *  zie je hooguit een verkeerde melding -- nooit verkeerde gegevens.
 * ------------------------------------------------------------------ */

/** Hoofdletters, alleen letters en cijfers. Gelijk aan kenteken_kaal() (0114). */
export function kaal(kenteken: string): string {
  return (kenteken ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** BX-JT-42 uit BXJT42, voor zover we het patroon herkennen. */
export function netjes(kenteken: string): string {
  return (kenteken ?? '').trim().toUpperCase()
}

async function put(record: Wagen) {
  const stamped = { ...record, updatedAt: Date.now() }
  await db.wagens.put(stamped)
  await enqueue('wagens', 'put', record.id, stamped)
  return stamped
}

export const wagens = {
  /**
   * Het wagenpark van een bedrijf.
   *
   * Een wagen hangt aan de werkgever óf aan de facturatieklant, dus je geeft
   * er één van beide mee. In dit bedrijf is dat dezelfde partij; welke van de
   * twee gebruikt wordt hing bij het bouwen nog in de lucht.
   */
  async lijst(van: { werkgeverId?: string; companyId?: string }): Promise<Wagen[]> {
    const alles = await db.wagens.toArray()
    return alles
      .filter((w) =>
        (van.werkgeverId !== undefined && w.werkgeverId === van.werkgeverId)
        || (van.companyId !== undefined && w.companyId === van.companyId))
      .sort((a, b) => a.kenteken.localeCompare(b.kenteken))
  },

  /**
   * Zoeken op kenteken, ongeacht hoe iemand het opschrijft.
   *
   * Dit is het hele punt van de kale vorm: wat de kassa intikte, wat een
   * chauffeur doorgeeft en wat een camera leest komen hier bij elkaar.
   */
  async zoek(kenteken: string): Promise<Wagen[]> {
    const k = kaal(kenteken)
    if (!k) return []
    return db.wagens.where('kentekenKaal').equals(k).toArray()
  },

  async toevoegen(input: {
    werkgeverId?: string
    companyId?: string
    kenteken: string
    soort?: WagenSoort
    omschrijving?: string
    chauffeurLinkId?: string
    chauffeurNaam?: string
    notitie?: string
    door: Pick<User, 'id'>
  }): Promise<Wagen> {
    const kenteken = netjes(input.kenteken)
    if (!kaal(kenteken)) {
      throw new Error('Een wagen heeft een kenteken nodig.')
    }
    if (!input.werkgeverId && !input.companyId) {
      throw new Error('Een wagen hoort bij een bedrijf.')
    }

    /* Vooraf kijken scheelt een foutmelding uit de database die niemand
       leest. De database houdt de echte wacht; dit is de vriendelijke. */
    const bestaat = (await this.zoek(kenteken)).find((w) =>
      (input.werkgeverId && w.werkgeverId === input.werkgeverId)
      || (input.companyId && w.companyId === input.companyId))
    if (bestaat) {
      throw new Error(`${bestaat.kenteken} staat al in het wagenpark.`)
    }

    const nu = Date.now()
    return put({
      id: uid('wgn'),
      werkgeverId: input.werkgeverId,
      companyId: input.companyId,
      kenteken,
      /* De trigger in 0114 zet dit veld; wat hier staat wordt overschreven.
         We vullen het alvast zodat zoeken werkt voordat de synchronisatie
         is geweest. */
      kentekenKaal: kaal(kenteken),
      soort: input.soort,
      omschrijving: input.omschrijving?.trim() || undefined,
      chauffeurLinkId: input.chauffeurLinkId,
      chauffeurNaam: input.chauffeurNaam?.trim() ?? '',
      actief: true,
      notitie: input.notitie?.trim() || undefined,
      door: input.door.id,
      createdAt: nu,
      updatedAt: nu,
    })
  },

  async bijwerken(id: string, velden: Partial<Omit<Wagen,
    'id' | 'werkgeverId' | 'companyId' | 'kentekenKaal' | 'createdAt' | 'updatedAt'>>) {
    const huidig = await db.wagens.get(id)
    if (!huidig) throw new Error('Die wagen bestaat niet (meer).')

    const kenteken = velden.kenteken !== undefined
      ? netjes(velden.kenteken)
      : huidig.kenteken
    if (!kaal(kenteken)) throw new Error('Een wagen heeft een kenteken nodig.')

    return put({
      ...huidig,
      ...velden,
      kenteken,
      kentekenKaal: kaal(kenteken),
      /* werkgeverId en companyId staan bewust niet in het type hierboven:
         een bedrijf verzet zijn wagens niet naar een ander bedrijf. De
         trigger wagen_bewaak() in 0114 draait ze sowieso terug. */
      werkgeverId: huidig.werkgeverId,
      companyId: huidig.companyId,
    })
  },

  /** Uit dienst halen zonder de historie kwijt te raken. */
  async opZijSchuiven(id: string) {
    return this.bijwerken(id, { actief: false })
  },

  async verwijderen(id: string) {
    await db.wagens.delete(id)
    await enqueue('wagens', 'delete', id, null)
  },
}
