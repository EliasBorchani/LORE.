import { Link, useNavigate } from 'react-router'
import { api } from '../api/client'
import { ErrorNotice, Loading, StatBlock } from '../components/grimoire'
import { fr } from '../i18n/fr'
import { useTheme, type ThemeChoice } from '../theme/theme'
import { useLoad } from '../useLoad'

export function AccountScreen() {
  const navigate = useNavigate()
  const { data: me, error, reload } = useLoad(api.me, 'me')
  const [theme, setTheme] = useTheme()
  const { data: rulesets } = useLoad(api.rulesets, 'rulesets')

  return (
    <>
      <h1 className="type-display-l">{fr.account.title}</h1>
      {error && <ErrorNotice message={error} onRetry={reload} />}
      {me ? <p>{fr.account.signedInAs(me.login)}</p> : !error && <Loading />}
      <StatBlock title={fr.account.rulesets}>
        {rulesets?.length === 0 && <p className="muted">{fr.account.noRulesets}</p>}
        {rulesets?.map((r) => (
          <Link key={r.slug} className="list-row" to={`/rulesets/${r.slug}`}>
            <span className="list-row-text">
              <span className="list-row-title">{r.name}</span>
              <span className="list-row-sub">{r.slug} · {r.access === 'own' ? fr.account.owner : fr.account.editor}</span>
            </span>
          </Link>
        ))}
      </StatBlock>
      <StatBlock title={fr.account.theme}>
        <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          <legend className="visually-hidden">{fr.account.theme}</legend>
          {(['auto', 'light', 'dark'] as ThemeChoice[]).map((choice) => (
            <label key={choice} className={`toggle-row${theme === choice ? ' on' : ''}`} style={{ flex: '1 1 140px' }}>
              <span className="toggle-name">{fr.account.themes[choice]}</span>
              <input type="radio" name="theme" checked={theme === choice} onChange={() => setTheme(choice)} />
            </label>
          ))}
        </fieldset>
      </StatBlock>
      <button
        className="btn btn-secondary"
        onClick={async () => {
          await api.logout()
          navigate('/login', { replace: true })
        }}
      >
        {fr.account.logout}
      </button>
    </>
  )
}
