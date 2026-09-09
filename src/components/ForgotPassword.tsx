import { useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import {
  AlertCircle, ArrowLeft, Eye, EyeOff, KeyRound, Loader2, Mail, ShieldCheck,
} from 'lucide-react'
import { api, backendError } from '../lib/api'
import Logo from './Logo'
import { emailLooksValid, passwordProblem } from '../lib/signups'

/* ------------------------------------------------------------------ *
 *  Wachtwoord vergeten -- een code, geen link
 *
 *  Dit scherm stuurde een verzoek naar Supabase en zei daarna "E-mail
 *  verzonden. Controleer uw inbox." Dat was op drie manieren onwaar:
 *
 *   1. De mail kwam van Supabase en niet van Resend, dus hij stond nergens
 *      in email_log en niemand kon nakijken of er iets was verstuurd.
 *   2. Er ging geen redirectTo mee, dus de link in die mail wees naar de
 *      Site URL van het project, en die staat op localhost.
 *   3. En zelfs met een goed adres was het dood. De client staat op
 *      detectSessionInUrl: false en er luistert nergens iets op
 *      PASSWORD_RECOVERY -- die link kon in geen enkele bouw (Electron,
 *      Android, browser) een sessie opleveren.
 *
 *  Casper: "het vergeten wachtwoord knop zit nu aan supabase, en stuurt je
 *  naar een localhost, wat niet kan?"
 *
 *  Nu komt er een code van acht tekens per mail, en die tik je hieronder in.
 *  Geen link betekent geen adres dat verkeerd kan staan, en het werkt op een
 *  tablet in de wasstraat net zo goed als in een browser.
 *
 *  Twee stappen in één scherm en niet in twee. Wie de mail leest is de app
 *  intussen kwijt als hij eerst iets moet wegklikken; zo staat het veld waar
 *  de code in moet al open op het moment dat de mail binnenkomt.
 * ------------------------------------------------------------------ */

type Stap = 'adres' | 'code' | 'klaar'

export default function ForgotPassword({ onBack }: { onBack: () => void }) {
  const [stap, setStap] = useState<Stap>('adres')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [nieuw, setNieuw] = useState('')
  const [toon, setToon] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const probleem = nieuw ? passwordProblem(nieuw) : null

  async function vraagCode(e: FormEvent) {
    e.preventDefault()
    if (!emailLooksValid(email)) {
      setError('Vul een geldig e-mailadres in.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.forgotPassword(email)
      /*
       * Doorgaan zonder te weten of het adres bestaat. Dat is geen slordigheid
       * maar de bedoeling: zou dit scherm "dat adres kennen we niet" zeggen,
       * dan is het een manier om uit te vinden wie hier werkt.
       */
      setStap('code')
    } catch (err: any) {
      setError(err?.message ?? 'De aanvraag is niet verstuurd.')
    } finally {
      setBusy(false)
    }
  }

  async function wisselIn(e: FormEvent) {
    e.preventDefault()
    if (code.trim().length < 6) return setError('Vul de code uit de e-mail in.')
    if (probleem) return setError(probleem)

    setBusy(true)
    setError(null)
    try {
      const uit = await api.resetPassword(email, code, nieuw)
      if (!uit.ok) return setError(uit.reden ?? 'Het is niet gelukt.')
      setStap('klaar')
    } catch (err: any) {
      setError(err?.message ?? 'Het is niet gelukt.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen">
      <motion.form
        className="auth-card"
        onSubmit={stap === 'code' ? wisselIn : stap === 'adres' ? vraagCode : (e) => { e.preventDefault(); onBack() }}
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: .32, ease: [.22, .61, .36, 1] }}
      >
        <div className="auth-logo">
          <Logo width={190} />
          <div className="sub">Wachtwoord herstellen</div>
        </div>

        {backendError && (
          <div className="auth-error">
            <AlertCircle size={16} style={{ flex: 'none', marginTop: 1 }} />
            <span><strong>Instellingsfout.</strong> {backendError}</span>
          </div>
        )}

        {error && (
          <div className="auth-error">
            <AlertCircle size={16} style={{ flex: 'none', marginTop: 1 }} />
            <span>{error}</span>
          </div>
        )}

        {stap === 'adres' && (
          <div className="field">
            <label htmlFor="email">E-mailadres</label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="username"
              placeholder="naam@truckwash1group.nl"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
          </div>
        )}

        {stap === 'code' && (
          <>
            <div
              className="auth-error"
              style={{ background: '#eafaf1', borderColor: '#b8e6c4', color: '#2c662d' }}
            >
              <Mail size={16} style={{ flex: 'none', marginTop: 1 }} />
              <span>
                Staat er een account op <strong>{email}</strong>, dan is er een code
                onderweg. Die werkt tien minuten. Je huidige wachtwoord blijft
                gewoon werken tot je hieronder een nieuw instelt.
              </span>
            </div>

            <div className="field">
              <label htmlFor="code">Code uit de e-mail</label>
              <input
                id="code"
                className="input"
                type="text"
                inputMode="text"
                autoComplete="one-time-code"
                autoFocus
                maxLength={8}
                placeholder="ABCD2345"
                /* Overtypen van een telefoonscherm gaat vaak in kleine letters;
                   de server kijkt toch hoofdletterloos, maar zo ziet het er
                   hetzelfde uit als in de mail. */
                style={{ textTransform: 'uppercase', letterSpacing: '.18em', fontFamily: 'ui-monospace,Menlo,Consolas,monospace' }}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                disabled={busy}
              />
            </div>

            <div className="field">
              <label htmlFor="nieuw">Nieuw wachtwoord</label>
              {/* Dezelfde opbouw als WachtwoordWijzigen.tsx: dit is voor wie het
                  invult hetzelfde moment, dus het hoort er hetzelfde uit te zien. */}
              <div style={{ position: 'relative' }}>
                <input
                  id="nieuw"
                  className={`input ${nieuw && probleem ? 'fout' : ''}`}
                  type={toon ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={nieuw}
                  onChange={(e) => setNieuw(e.target.value)}
                  disabled={busy}
                  style={{ paddingRight: 42 }}
                />
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => setToon((v) => !v)}
                  style={{ position: 'absolute', right: 4, top: 4 }}
                  aria-label={toon ? 'Verbergen' : 'Tonen'}
                >
                  {toon ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <span className="help">
                {probleem ?? 'Minstens tien tekens, met letters én cijfers.'}
              </span>
            </div>
          </>
        )}

        {stap === 'klaar' && (
          <div
            className="auth-error"
            style={{ background: '#eafaf1', borderColor: '#b8e6c4', color: '#2c662d' }}
          >
            <ShieldCheck size={16} style={{ flex: 'none', marginTop: 1 }} />
            <span>Gelukt. Je kunt nu inloggen met je nieuwe wachtwoord.</span>
          </div>
        )}

        <button
          className="btn primary block lg"
          type="submit"
          disabled={busy || (stap === 'code' && (!code.trim() || !!probleem || !nieuw))}
        >
          {busy
            ? <Loader2 size={17} className="spin" />
            : stap === 'adres' ? <Mail size={17} />
            : stap === 'code' ? <KeyRound size={17} />
            : <ArrowLeft size={17} />}
          {busy
            ? 'Even bezig…'
            : stap === 'adres' ? 'Stuur mij een code'
            : stap === 'code' ? 'Wachtwoord instellen'
            : 'Naar het inlogscherm'}
        </button>

        {stap !== 'klaar' && (
          <div className="auth-alt">
            <button type="button" className="btn sm" onClick={onBack} disabled={busy}>
              <ArrowLeft size={14} /> Terug naar inloggen
            </button>
            {stap === 'code' && (
              <button
                type="button"
                className="btn sm"
                onClick={() => { setStap('adres'); setCode(''); setError(null) }}
                disabled={busy}
              >
                Ander adres
              </button>
            )}
          </div>
        )}
      </motion.form>
    </div>
  )
}
