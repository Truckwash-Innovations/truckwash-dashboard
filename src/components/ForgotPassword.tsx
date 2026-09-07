import { useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import { AlertCircle, ArrowLeft, Mail, Loader2 } from 'lucide-react'
import { api, backendError } from '../lib/api'
import Logo from './Logo'
import { emailLooksValid } from '../lib/signups'

export default function ForgotPassword({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!emailLooksValid(email)) {
      setError('Vul een geldig e-mailadres in.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.forgotPassword(email)
      setSent(true)
    } catch (err: any) {
      setError(err?.message ?? 'Onbekende fout')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen">
      <motion.form
        className="auth-card"
        onSubmit={submit}
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

        {sent ? (
          <div className="auth-error" style={{ background: '#eafaf1', borderColor: '#b8e6c4', color: '#2c662d' }}>
            <Mail size={16} style={{ flex: 'none', marginTop: 1 }} />
            <span>E‑mail verzonden. Controleer uw inbox.</span>
          </div>
        ) : (
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

        <button
          className="btn primary block lg"
          type="submit"
          disabled={busy || sent}
        >
          {busy ? <Loader2 size={17} className="spin" /> : <Mail size={17} />}
          {busy ? 'Bezig met versturen…' : 'Verstuur herstelmail'}
        </button>

        <div className="auth-alt">
          <button type="button" className="btn sm" onClick={onBack} disabled={busy}>
            <ArrowLeft size={14} /> Terug naar inloggen
          </button>
        </div>
      </motion.form>
    </div>
  )
}
