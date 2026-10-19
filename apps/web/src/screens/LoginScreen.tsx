import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { api, ApiError } from '../api/client'
import { fr } from '../i18n/fr'

export function LoginScreen() {
  const navigate = useNavigate()
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/'
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.login(login, password)
      navigate(from, { replace: true })
    } catch (e) {
      setError(e instanceof ApiError && e.status === 429 ? fr.login.blocked : e instanceof ApiError && e.status === 401 ? fr.login.failed : fr.errors.generic)
      setBusy(false)
    }
  }

  return (
    <main className="login">
      <div className="login-brand">
        <div className="rule" />
        <h1>{fr.app}</h1>
        <p>{fr.tagline}</p>
        <div className="rule" />
      </div>
      <form onSubmit={submit}>
        <label className="field">
          <span>{fr.login.login}</span>
          <input className="input" autoComplete="username" autoCapitalize="none" required value={login}
            onChange={(e) => setLogin(e.target.value)} />
        </label>
        <label className="field">
          <span>{fr.login.password}</span>
          <input className="input" type="password" autoComplete="current-password" required value={password}
            onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="warning" role="alert">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? fr.login.busy : fr.login.submit}
        </button>
        <p className="muted" style={{ textAlign: 'center' }}>{fr.login.invite}</p>
      </form>
    </main>
  )
}
