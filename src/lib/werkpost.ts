/* ------------------------------------------------------------------ *
 *  Het postvak
 *
 *  Casper: "Vervolgens krijgen ze ook toegang tot een soort outlook
 *  omgeving."
 *
 *  De post staat in public.werkmail en komt via de gewone synchronisatie mee
 *  naar dit toestel. Dat betekent twee dingen die je van een mailprogramma
 *  niet gewend bent, en allebei in ons voordeel: je post is er ook zonder
 *  verbinding, en zoeken gebeurt hier en niet op een server.
 *
 *  Wat er NIET in zit, en waarom
 *  -----------------------------
 *
 *  Geen IMAP en geen POP. De post staat in onze database, niet op een
 *  mailserver; Outlook of de Mail-app van je telefoon kunnen er dus niet bij.
 *  Dat is de prijs van deze weg, en hij staat hier opgeschreven zodat niemand
 *  er een halve dag naar zoekt.
 *
 *  Wie mag wat
 *  -----------
 *
 *  Alleen jijzelf, en dat zit in de database (0082). Dit bestand rekent daar
 *  niet op maar leunt erop: er is hier geen enkele controle op eigenaarschap,
 *  want de enige rijen die dit toestel heeft zijn die van deze gebruiker.
 * ------------------------------------------------------------------ */

import { db } from './db'
import { enqueue } from './sync'
import { supabase, supabaseUrl } from './api/supabaseApi'
import type { MailMap, WerkMail } from './types'

export const MAPPEN: { sleutel: MailMap; label: string; uitleg: string }[] = [
  { sleutel: 'postvak', label: 'Postvak IN', uitleg: 'Wat er binnenkwam.' },
  { sleutel: 'verzonden', label: 'Verzonden', uitleg: 'Wat je hebt verstuurd.' },
  { sleutel: 'concept', label: 'Concepten', uitleg: 'Begonnen, nog niet weg.' },
  { sleutel: 'archief', label: 'Archief', uitleg: 'Afgehandeld, maar bewaard.' },
  { sleutel: 'prullenbak', label: 'Prullenbak', uitleg: 'Weggegooid.' },
]

/* ------------------------------------------------------------------ *
 *  Versturen
 * ------------------------------------------------------------------ */

export interface NieuwBericht {
  aan: string[]
  cc?: string[]
  onderwerp: string
  tekst: string
  /** De Message-ID waarop dit een antwoord is, zodat het in de draad valt. */
  antwoordOp?: string
}

/**
 * Versturen gaat via de server, en met opzet niet via de wachtrij.
 *
 * De rest van deze app schrijft eerst lokaal en duwt het daarna naar de
 * server; dat is precies goed voor een bon die je invult. Voor een mail niet:
 * "verstuurd" moet betekenen dat hij de deur uit is, en niet dat hij in een
 * wachtrij staat die morgen misschien afloopt. Een mail die een dag later
 * alsnog vertrekt is erger dan een mail die nu niet vertrekt.
 *
 * Het adres van de afzender gaat hier NIET mee. Dat haalt de server uit het
 * dossier van degene die belt -- anders kan iedereen post sturen namens de
 * directeur, op het echte domein, met een geldige handtekening eronder.
 */
export async function versturen(bericht: NieuwBericht): Promise<string> {
  const { data: sessie } = await supabase().auth.getSession()
  const token = sessie.session?.access_token
  if (!token) throw new Error('Je sessie is verlopen. Log opnieuw in.')

  const res = await fetch(`${supabaseUrl()}/functions/v1/werkmail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ actie: 'versturen', ...bericht }),
  })

  const uit = await res.json().catch(() => null) as
    ({ ok?: boolean; reden?: string; id?: string }) | null

  if (!res.ok || !uit || uit.ok === false) {
    throw new Error(uit?.reden ?? `De server gaf ${res.status} terug.`)
  }
  return String(uit.id ?? '')
}

/* ------------------------------------------------------------------ *
 *  Wat je zelf aan je post mag doen
 *
 *  Verplaatsen, lezen, een ster. De inhoud van een ontvangen bericht ligt
 *  vast -- dat bewaakt de database, hier staat het alleen niet in de weg.
 * ------------------------------------------------------------------ */

async function bewaar(mail: WerkMail, velden: Partial<WerkMail>): Promise<WerkMail> {
  const nieuw: WerkMail = { ...mail, ...velden, updatedAt: Date.now() }
  await db.werkmail.put(nieuw)
  await enqueue('werkmail', 'put', nieuw.id, nieuw)
  return nieuw
}

export const naarMap = (mail: WerkMail, map: MailMap) => bewaar(mail, { map })
export const zetSter = (mail: WerkMail, ster: boolean) => bewaar(mail, { ster })

/** Als gelezen melden. Doet niets als hij dat al is -- anders gaat er bij elk
    openen een regel de wachtrij in voor een wijziging die er geen is. */
export async function markeerGelezen(mail: WerkMail): Promise<WerkMail> {
  if (mail.gelezenAt) return mail
  return bewaar(mail, { gelezenAt: Date.now() })
}

/* ------------------------------------------------------------------ *
 *  Lezen en ordenen
 * ------------------------------------------------------------------ */

export function ongelezen(post: WerkMail[]): number {
  return post.filter((m) => m.map === 'postvak' && !m.gelezenAt).length
}

/**
 * De post van één map, nieuwste bovenaan.
 *
 * De prullenbak en het archief blijven bestaan naast de map waar iets
 * vandaan kwam: een bericht staat in precies één map, en dat is wat mensen
 * van een postvak verwachten.
 */
export function inMap(post: WerkMail[], map: MailMap): WerkMail[] {
  return post.filter((m) => m.map === map).sort((a, b) => b.at - a.at)
}

/**
 * Zoeken.
 *
 * Over de afzender, de ontvangers, het onderwerp en de tekst tegelijk -- want
 * dat is hoe mensen zoeken: ze typen wat ze zich herinneren en weten niet
 * meer in welk veld het stond.
 */
export function zoekIn(post: WerkMail[], term: string): WerkMail[] {
  const t = term.trim().toLowerCase()
  if (!t) return post
  return post.filter((m) =>
    m.onderwerp.toLowerCase().includes(t)
    || m.tekst.toLowerCase().includes(t)
    || m.van.toLowerCase().includes(t)
    || (m.vanNaam ?? '').toLowerCase().includes(t)
    || m.aan.some((a) => a.toLowerCase().includes(t)))
}

/**
 * De berichten die bij dit gesprek horen, oudste eerst.
 *
 * Over alle mappen heen: een antwoord dat jij stuurde staat in Verzonden en
 * hoort in het gesprek thuis. Een draad die alleen laat zien wat er binnenkwam
 * is een half gesprek.
 */
export function draadVan(post: WerkMail[], mail: WerkMail): WerkMail[] {
  if (!mail.draad) return [mail]
  return post
    .filter((m) => m.draad === mail.draad && m.map !== 'prullenbak')
    .sort((a, b) => a.at - b.at)
}

/**
 * Het antwoord voorbereiden.
 *
 * Het onderwerp krijgt "Re: " als het er nog niet staat, en de oorspronkelijke
 * tekst komt eronder met een streepje ervoor. Geen HTML-citaat met kleurtjes:
 * dit is platte tekst, en dan is een regel met > ervoor de enige vorm die
 * overal hetzelfde aankomt.
 */
export function antwoordOp(mail: WerkMail, allen = false): NieuwBericht {
  const kop = /^re\s*:/i.test(mail.onderwerp) ? mail.onderwerp : `Re: ${mail.onderwerp}`
  const wanneer = new Date(mail.at).toLocaleString('nl-NL')
  const citaat = mail.tekst.split('\n').map((r) => '> ' + r).join('\n')

  return {
    /* Antwoorden gaat naar de afzender. Bij een bericht dat je zelf stuurde
       (vanuit Verzonden) naar de oorspronkelijke ontvanger -- anders mail je
       jezelf. */
    aan: mail.richting === 'uit' ? mail.aan : [mail.van],
    cc: allen
      ? [...mail.aan, ...mail.cc].filter((a) => a !== mail.van)
      : undefined,
    onderwerp: kop,
    tekst: `\n\nOp ${wanneer} schreef ${mail.vanNaam || mail.van}:\n${citaat}`,
    antwoordOp: mail.berichtId,
  }
}

/** Doorsturen: de tekst blijft, de ontvanger niet. */
export function doorsturen(mail: WerkMail): NieuwBericht {
  const kop = /^(fwd?|doorgestuurd)\s*:/i.test(mail.onderwerp)
    ? mail.onderwerp
    : `Fwd: ${mail.onderwerp}`
  const wanneer = new Date(mail.at).toLocaleString('nl-NL')
  return {
    aan: [],
    onderwerp: kop,
    tekst: `\n\n---------- Doorgestuurd bericht ----------\n`
      + `Van: ${mail.vanNaam || mail.van}\nDatum: ${wanneer}\n`
      + `Aan: ${mail.aan.join(', ')}\nOnderwerp: ${mail.onderwerp}\n\n${mail.tekst}`,
  }
}

/* ------------------------------------------------------------------ *
 *  Een bijlage openen
 *
 *  Met een ondertekend adres van een minuut. De emmer staat dicht en het pad
 *  begint met het id van de eigenaar; die twee samen maken dat een bijlage
 *  van een collega niet op te halen is door het pad te raden.
 * ------------------------------------------------------------------ */

export async function bijlageAdres(pad: string): Promise<string> {
  const { data, error } = await supabase().storage.from('werkmail').createSignedUrl(pad, 60)
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? 'De bijlage is niet op te halen.')
  }
  return data.signedUrl
}
