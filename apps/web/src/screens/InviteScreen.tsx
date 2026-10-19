import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { api, ApiError } from '../api/client'
import type { Invitation } from '../api/types'
import { fr } from '../i18n/fr'

const MIN_PASSWORD = 12

/** The link of an invitation mail: `/invite#<token>`. The token sits after `#` so it never reaches server logs. */
export function InviteScreen() {
  const navigate = useNavigate()
  const [token] = useState(() => window.location.hash.slice(1))
  const [invitation, setInvitation] = useState<Invitation | null>(null)
  const [invalid, setInvalid] = useState(token === '')
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    api.invitation(token).then(setInvitation, () => setInvalid(true))
  }, [token])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if ([...password].length < MIN_PASSWORD) return setError(fr.invite.short)
    if (password !== again) return setError(fr.invite.differ)
    setBusy(true)
    setError(null)
    try {
      await api.acceptInvitation(token, password)
      navigate('/', { replace: true })
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setInvalid(true)
      else setError(e instanceof ApiError && e.status === 409 ? fr.invite.exists : fr.errors.generic)
      setBusy(false)
    }
  }

  return (
    <main className="login">
      <div className="login-brand">
        <div className="rule" />
        <h1>{fr.app}</h1>
        <p>{fr.invite.title}</p>
        <div className="rule" />
      </div>
      {invalid ? (
        <div className="login-message">
          <p className="warning" role="alert">{fr.invite.invalid}</p>
          <Link className="btn" to="/login">{fr.invite.toLogin}</Link>
        </div>
      ) : !invitation ? (
        <p className="muted" style={{ textAlign: 'center' }}>{fr.invite.loading}</p>
      ) : (
        <form onSubmit={submit}>
          <p><strong>{fr.invite.account(invitation.email)}</strong></p>
          <p className="muted">{fr.invite.hint}</p>
          {/* Lets password managers save the new password with the right login. */}
          <input type="email" autoComplete="username" value={invitation.email} readOnly hidden />
          <label className="field">
            <span>{fr.invite.password}</span>
            <input className="input" type="password" autoComplete="new-password" required value={password}
              onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label className="field">
            <span>{fr.invite.again}</span>
            <input className="input" type="password" autoComplete="new-password" required value={again}
              onChange={(e) => setAgain(e.target.value)} />
          </label>
          {error && <p className="warning" role="alert">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? fr.invite.busy : fr.invite.submit}
          </button>
        </form>
      )}
    </main>
  )
}
