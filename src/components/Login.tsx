import { useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import { AlertCircle, ArrowLeft, Eye, EyeOff, Loader2, LogIn, UserPlus, WifiOff, Mail } from 'lucide-react'
import { useAuth } from '../store/useAuth'
import { useSync } from '../lib/sync'
import { useUpdates } from '../lib/updates'
import { backendError } from '../lib/api'
import Logo from './Logo'
import Aanmelden from './Aanmelden'
import ForgotPassword from './ForgotPassword'
import { useBeweegt } from '../lib/theme'
/*
 * Uit src/ en niet uit public/.
 *
 * Vite kent mp4 als asset-type, dus een import belandt met een hash in de
 * naam in dist/app/assets/ -- en dat is de enige map met een cache-kopregel
 * (uitrol/_headers). Uit public/ zou hij op /app/inlog.mp4 staan, buiten dat
 * blok, en dan haalt elke tablet bij elk bezoek een megabyte opnieuw op
 * zonder dat iets een fout meldt.
 */
import inlogVideo from '../assets/inlog.mp4'
import inlogBeeld from '../assets/inlog.jpg'

export default function Login({ terugNaarSite = false }: { terugNaarSite?: boolean }) {
  const { login, busy, error } = useAuth()
  const online = useSync((s) => s.online)
  const { version, channel } = useUpdates()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [aanmelden, setAanmelden] = useState(false)
  const [forgot, setForgot] = useState(false)
  /*
   * Mag het bewegen?
   *
   * De CSS-vangnet voor "rustige beweging" zet alleen animation-duration en
   * transition-duration op nul, en MotionConfig raakt alleen framer-motion.
   * Een video is geen van beide en zou dus gewoon doordraaien voor precies de
   * mensen die hebben gezegd dat ze dat niet willen. useBeweegt() bestond al
   * en werd nergens gebruikt; hier wel.
   */
  const beweegt = useBeweegt()

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!email || !password) return
    await login(email, password)
  }

  if (aanmelden) return <Aanmelden onBack={() => setAanmelden(false)} />
  if (forgot) return <ForgotPassword onBack={() => setForgot(false)} />

  return (
    <div className="auth-screen inlogscherm">
      {/*
        De sfeerbeelden achter het inlogscherm.

        Alleen hier, en niet op de vier andere schermen die .auth-screen
        gebruiken (aanmelden, wachtwoord vergeten, wachtwoord wijzigen) --
        vandaar de extra klasse. Wie net is uitgenodigd en verplicht een
        wachtwoord moet kiezen, hoort geen filmpje te krijgen.

        muted en playsInline zijn geen nettigheid maar noodzaak. Electron
        staat standaard op no-user-gesture-required en Capacitor zet
        setMediaPlaybackRequiresUserGesture(false); zonder muted klinkt er op
        achttien vestigingen geluid zodra iemand het scherm opent -- ook om
        zes uur 's ochtends. In een gewone browser gebeurt het omgekeerde:
        die weigert te starten en dan staat er een stilstaand beeld.

        Het kleurverloop van .auth-screen blijft eronder staan. Laadt de video
        niet -- geen verbinding, en dat is nou juist het scherm waar iemand
        zonder verbinding landt -- dan is er niets stuk, alleen niets extra's.
      */}
      {beweegt && (
        <video
          className="inlog-video"
          src={inlogVideo}
          poster={inlogBeeld}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden="true"
          tabIndex={-1}
        />
      )}

      <motion.form
        className="auth-card"
        onSubmit={submit}
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: .32, ease: [.22, .61, .36, 1] }}
      >
        <div className="auth-logo">
          <Logo width={190} />
          <div className="sub">Dashboard</div>
        </div>

        {/*
          * De weg terug naar de website.
          *
          * De app staat op /app/ en de site op de wortel van hetzelfde domein.
          * Zonder deze link is de browserknop "terug" de enige uitweg, en die
          * werkt niet voor wie het adres rechtstreeks heeft ingetikt of uit
          * een bladwijzer komt. Een gewone link naar "/" en geen router: die
          * is er niet, en dit is een sprong naar een andere site.
          */}
        {terugNaarSite && (
          <a className="auth-terug" href="/">
            <ArrowLeft size={13} /> Terug naar de website
          </a>
        )}

        {!online && (
          <div className="auth-error" style={{ background: 'rgba(245,181,68,.1)', borderColor: 'rgba(245,181,68,.32)', color: '#ffd894' }}>
            <WifiOff size={16} style={{ flex: 'none', marginTop: 1 }} />
            <span>
              Geen verbinding. Je kunt inloggen met een account dat eerder op dit
              apparaat is gebruikt.
            </span>
          </div>
        )}

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

        <div className="field">
          <label htmlFor="email">E-mailadres</label>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="username"
            inputMode="email"
            placeholder="naam@truckwash1group.nl"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
        </div>

        <div className="field">
          <label htmlFor="password">Wachtwoord</label>
          <div style={{ position: 'relative' }}>
            <input
              id="password"
              className="input"
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              style={{ paddingRight: 42 }}
            />
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => setShow((v) => !v)}
              style={{ position: 'absolute', right: 4, top: 4 }}
              aria-label={show ? 'Wachtwoord verbergen' : 'Wachtwoord tonen'}
            >
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        <motion.button
          className="btn primary block lg"
          type="submit"
          disabled={busy || !email || !password || !!backendError}
          whileHover={{ scale: 1.03, transition: { duration: 0.15 } }}
          whileTap={{ scale: 0.97, transition: { duration: 0.1 } }}
        >
          {busy ? <Loader2 size={17} className="spin" /> : <LogIn size={17} />}
          {busy ? 'Bezig met inloggen…' : 'Inloggen'}
        </motion.button>

        <div className="auth-alt">
          <span>Nog geen account?</span>
          <button type="button" className="btn sm" onClick={() => setAanmelden(true)} disabled={busy}>
            <UserPlus size={14} /> Aanmelden
          </button>
        </div>
        <div className="auth-alt">
          <button type="button" className="btn sm" onClick={() => setForgot(true)} disabled={busy}>
            <Mail size={14} /> Forgot password?
          </button>
        </div>

        <div className="auth-meta">
          <span>Versie {version}</span>
          <span>·</span>
          <span>
            {channel === 'windows' ? 'Windows' : channel === 'mobile' ? 'Mobiel' : 'Web'}
          </span>
          <span>·</span>
          <span>{online ? 'Online' : 'Offline'}</span>
        </div>
      </motion.form>
    </div>
  )
}
