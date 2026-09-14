/* ------------------------------------------------------------------ *
 *  Een document laten voorlezen door de AI
 *
 *  Casper: "De ai, kan je die niet gebruiken bij inscannen arbeidsovereenkomst
 *  en id ect? gezien de ocr niet echt lekker werkt."
 *
 *  Dit staat NAAST scannen.ts, niet ervoor in de plaats. Die leesmotor draait
 *  op het toestel zelf; dat is de enige weg waarbij er zeker geen foto weggaat,
 *  en hij kost niets. Hij is alleen kieskeurig over de foto: een scherpe,
 *  rechte scan leest hij prima, een kiek onder tl-licht niet.
 *
 *  Dus: eerst de motor, en lukt dat niet, dan dit.
 *
 *  Waar de foto heen gaat staat in de instelling ai_documenten en in migratie
 *  0080. Kort: standaard naar de eigen machine, nooit vanzelf naar buiten.
 *
 *  Wat hier het belangrijkste is
 *  ----------------------------
 *
 *  Niet het versturen -- dat is een paar regels. Het narekenen.
 *
 *  Een model dat een cijfer verkeerd leest geeft een antwoord dat er precies
 *  zo uitziet als een goed antwoord. Bij OCR wist je dat al, en daarom gaat
 *  alles wat eruit komt langs dezelfde drie controles als wat een mens intikt:
 *  het BSN door de elfproef, het IBAN door de mod-97, en de MRZ door zijn
 *  eigen controlecijfers. Wat daar niet doorheen komt wordt geen voorstel maar
 *  een opmerking.
 *
 *  Die MRZ is de reden dat het prompt de twee regels letterlijk opvraagt in
 *  plaats van alleen de naam en de geboortedatum: daarmee is er iets om na te
 *  rekenen. Zonder die regels is een lezing een bewering.
 * ------------------------------------------------------------------ */

import { supabase, supabaseUrl } from './api/supabaseApi'
import { bsnGeldig, ibanGeldig, leesMrz, type MrzResultaat } from './identiteit'

export type DocumentSoort = 'identiteitsbewijs' | 'arbeidsovereenkomst'

/** Wat het model van een identiteitsbewijs maakte, ongecontroleerd. */
export interface RuweIdLezing {
  soortDocument?: string
  mrzRegels: string[]
  bsn?: string
  documentnummer?: string
  achternaam?: string
  voornamen?: string
  geboortedatum?: string
  geboorteplaats?: string
  nationaliteit?: string
  geslacht?: string
  geldigTot?: string
  twijfel: string[]
}

export interface RuweContractLezing {
  werknemer?: string
  werkgever?: string
  functie?: string
  soortContract?: string
  inDienst?: string
  uitDienst?: string
  uren?: number
  uurloon?: number
  maandloon?: number
  proeftijd?: string
  bsn?: string
  iban?: string
  twijfel: string[]
}

/** Wat er na het narekenen overblijft. */
export interface IdUitAi {
  /** Alleen gevuld als de twee regels onderaan te lezen én na te rekenen waren. */
  mrz?: MrzResultaat
  /** Alleen als hij door de elfproef komt. */
  bsn?: string
  ruw: RuweIdLezing
  /** Wat er niet klopte of ontbrak, in gewone woorden. */
  opmerkingen: string[]
  /** Wie het gelezen heeft: 'claude' of 'lokaal: <model>'. */
  door: string
}

export interface ContractUitAi {
  lezing: RuweContractLezing
  /** Alleen als hij door de mod-97 komt. */
  iban?: string
  /** Alleen als hij door de elfproef komt. */
  bsn?: string
  opmerkingen: string[]
  door: string
}

/* ------------------------------------------------------------------ *
 *  De foto klein maken
 *
 *  Een telefoonfoto is zo twaalf megapixel, en als base64 wordt dat een reeks
 *  van een paar megabyte. Dat is drie keer zonde: het verzoek wordt traag, de
 *  rij in de database wordt groot, en het model ziet er niets extra's aan --
 *  een machineleesbare strook is bij 1600 pixels breed prima te lezen.
 *
 *  JPEG en geen PNG. Een scan van een pasje is een foto, en PNG maakt daar een
 *  bestand van dat vijf keer zo groot is zonder dat er iets beter leesbaar
 *  wordt.
 * ------------------------------------------------------------------ */

export async function naarBase64(bestand: File | Blob, maxBreedte = 1600): Promise<{
  data: string
  mime: string
}> {
  const bitmap = await createImageBitmap(bestand)
  const schaal = Math.min(1, maxBreedte / bitmap.width)
  const breed = Math.round(bitmap.width * schaal)
  const hoog = Math.round(bitmap.height * schaal)

  const doek = document.createElement('canvas')
  doek.width = breed
  doek.height = hoog
  const ctx = doek.getContext('2d')
  if (!ctx) throw new Error('Deze browser kan de foto niet verkleinen.')
  ctx.drawImage(bitmap, 0, 0, breed, hoog)
  bitmap.close?.()

  const uri = doek.toDataURL('image/jpeg', 0.85)
  /* De kop "data:image/jpeg;base64," gaat eraf: de server wil de reeks zelf. */
  return { data: uri.slice(uri.indexOf(',') + 1), mime: 'image/jpeg' }
}

/* ------------------------------------------------------------------ *
 *  Het versturen
 * ------------------------------------------------------------------ */

async function roep(soort: DocumentSoort, bestanden: (File | Blob)[]) {
  const { data: sessie } = await supabase().auth.getSession()
  const token = sessie.session?.access_token
  if (!token) throw new Error('Je sessie is verlopen. Log opnieuw in.')

  const stukken = await Promise.all(bestanden.map((b) => naarBase64(b)))

  const res = await fetch(`${supabaseUrl()}/functions/v1/document-lezen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      soort,
      plaatjes: stukken.map((s) => s.data),
      mimes: stukken.map((s) => s.mime),
    }),
  })

  const uit = await res.json().catch(() => null) as
    ({ ok?: boolean; reden?: string; door?: string; lezing?: unknown }) | null

  if (!res.ok || !uit || uit.ok === false) {
    throw new Error(uit?.reden ?? `De leesdienst gaf ${res.status} terug.`)
  }
  return { lezing: uit.lezing, door: String(uit.door ?? 'onbekend') }
}

/* ------------------------------------------------------------------ *
 *  Een identiteitsbewijs
 * ------------------------------------------------------------------ */

export async function leesIdMetAi(
  voorkant: File,
  achterkant?: File,
): Promise<IdUitAi> {
  const bestanden = achterkant ? [voorkant, achterkant] : [voorkant]
  const { lezing, door } = await roep('identiteitsbewijs', bestanden)
  const ruw = (lezing ?? { mrzRegels: [], twijfel: [] }) as RuweIdLezing

  return { ...naarIdUitkomst(ruw), door }
}

/**
 * Het narekenen, los van het versturen.
 *
 * Apart zodat het zonder netwerk te controleren is -- en dat is precies het
 * stuk dat je wilt kunnen controleren.
 */
export function naarIdUitkomst(ruw: RuweIdLezing): Omit<IdUitAi, 'door'> {
  const opmerkingen: string[] = [...(ruw.twijfel ?? [])]

  /* --- de twee regels onderaan --- */
  const regels = (ruw.mrzRegels ?? []).filter((r) => r.length > 0)
  let mrz: MrzResultaat | undefined

  if (regels.length >= 2) {
    mrz = leesMrz(regels.join('\n')) ?? undefined
    if (!mrz) {
      opmerkingen.push(
        'De twee regels onderaan zijn wel overgenomen maar niet te ontcijferen. '
        + 'Kijk ze na op het document zelf.')
    } else if (!mrz.betrouwbaar) {
      /*
       * Dit is waarvoor die regels worden opgevraagd. Een naam die verkeerd is
       * gelezen merk je nooit; een controlecijfer dat niet uitkomt wel.
       */
      opmerkingen.push(
        'De controlecijfers in de onderste regels kloppen niet'
        + (mrz.twijfel.length ? ` (${mrz.twijfel.join(', ')})` : '')
        + '. Er is dus iets verkeerd gelezen -- neem het over van het document.')
    }
  } else {
    opmerkingen.push('De twee regels onderaan het document zijn niet gelezen.')
  }

  /* --- het burgerservicenummer --- */
  const bsnKaal = (ruw.bsn ?? '').replace(/\D/g, '')
  let bsn: string | undefined
  if (bsnKaal) {
    if (bsnGeldig(bsnKaal)) {
      bsn = bsnKaal
    } else {
      opmerkingen.push(
        `Het gelezen burgerservicenummer (${bsnKaal}) komt niet door de elfproef `
        + 'en is dus verkeerd gelezen. Het staat op de achterkant.')
    }
  }

  return { mrz, bsn, ruw, opmerkingen }
}

/* ------------------------------------------------------------------ *
 *  Een arbeidsovereenkomst
 * ------------------------------------------------------------------ */

export async function leesContractMetAi(bladen: File[]): Promise<ContractUitAi> {
  const { lezing, door } = await roep('arbeidsovereenkomst', bladen)
  const ruw = (lezing ?? { twijfel: [] }) as RuweContractLezing
  return { ...naarContractUitkomst(ruw), door }
}

export function naarContractUitkomst(ruw: RuweContractLezing): Omit<ContractUitAi, 'door'> {
  const opmerkingen: string[] = [...(ruw.twijfel ?? [])]

  const ibanKaal = (ruw.iban ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  let iban: string | undefined
  if (ibanKaal) {
    if (ibanGeldig(ibanKaal)) {
      iban = ibanKaal
    } else {
      opmerkingen.push(
        `Het gelezen rekeningnummer (${ibanKaal}) komt niet door de controle. `
        + 'Neem het over van het contract.')
    }
  }

  const bsnKaal = (ruw.bsn ?? '').replace(/\D/g, '')
  let bsn: string | undefined
  if (bsnKaal) {
    if (bsnGeldig(bsnKaal)) {
      bsn = bsnKaal
    } else {
      opmerkingen.push(
        `Het gelezen burgerservicenummer (${bsnKaal}) komt niet door de elfproef.`)
    }
  }

  /*
   * Een maandloon zonder uurloon is geen fout; terugrekenen wél. Het prompt
   * verbiedt het, dit zegt het nog een keer aan de kant waar het terechtkomt:
   * wat er niet staat blijft leeg, en dat ziet degene die het invult.
   */
  if (ruw.maandloon && !ruw.uurloon) {
    opmerkingen.push(
      'Er staat een maandloon en geen uurloon. Het uurloon is niet uitgerekend '
      + '-- dat hangt van de contracturen af en hoort niet geraden te worden.')
  }

  return { lezing: ruw, iban, bsn, opmerkingen }
}
