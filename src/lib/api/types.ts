import type { EntityName, SyncOp } from '../types'

export interface PushChange {
  entity: EntityName
  op: SyncOp
  recordId: string
  payload: unknown
}

export interface PullResult {
  /** Per entiteit alle records die na `since` zijn gewijzigd */
  changes: Partial<Record<EntityName, unknown[]>>
  serverTime: number
}

/**
 * Elke backend (mock, Supabase, eigen Node-server) implementeert dit.
 * De rest van de app kent alleen deze interface.
 */
export interface ApiAdapter {
  readonly name: string
  /**
   * Retourneert null bij foute inloggegevens.
   *
   * `profile` is het personeelsdossier van deze gebruiker. Door dat meteen
   * mee te geven kan de app direct doorlopen, in plaats van te wachten tot
   * de volledige synchronisatie klaar is.
   */
  login(email: string, password: string): Promise<{
    userId: string
    token: string
    profile?: Record<string, unknown>
  } | null>
  /** Duwt lokale wijzigingen naar de server. Gooit bij netwerkfout. */
  push(changes: PushChange[]): Promise<void>
  /** Haalt serverwijzigingen op sinds timestamp */
  pull(since: number): Promise<PullResult>
  /**
   * Vraagt een herstelcode aan en laat die per mail versturen.
   *
   * Geeft met opzet niets terug over het adres. Of er een account op staat,
   * of dat account actief is, of de mail is aangekomen -- niets daarvan komt
   * hier langs. Anders is deze aanroep een manier om uit te vinden wie er bij
   * Truckwash1 werkt.
   *
   * Gooit alleen als het verzoek de server niet eens heeft gehaald.
   */
  forgotPassword(email: string): Promise<void>
  /**
   * Wisselt de code in voor een nieuw wachtwoord.
   *
   * Geeft de reden terug als het misging, zodat het scherm iets kan zeggen.
   * Elke manier waarop het mis kan gaan -- verkeerde code, verlopen, al
   * gebruikt, te vaak geprobeerd -- levert dezelfde reden op; dat is aan de
   * serverkant zo bedoeld.
   */
  resetPassword(email: string, code: string, wachtwoord: string):
    Promise<{ ok: boolean; reden?: string }>
  /** Snelle bereikbaarheidscheck */
  ping(): Promise<boolean>
}
