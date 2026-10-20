import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { api } from '../api/client'
import type { EntityDetail } from '../api/types'
import { fr, typeName } from '../i18n/fr'
import { EntitySummary } from '../screens/EntitySummary'
import { entityName } from '../sheet/names'
import { useLoad } from '../useLoad'
import { Badge, ErrorNotice, Icon, Loading } from './grimoire'

const INFO = 'info'
const cache = new Map<string, Promise<EntityDetail>>()

function load(id: string): Promise<EntityDetail> {
  let detail = cache.get(id)
  if (!detail) {
    detail = api.entity(id)
    detail.catch(() => cache.delete(id))
    cache.set(id, detail)
  }
  return detail
}

/** After an edit, the panel must not show the old version. */
export function forgetEntityInfo(id: string) {
  cache.delete(id)
}

/**
 * Opens the panel on an entity. `?info=<id>` is pushed to the history, so the phone's back button closes the panel
 * and the screen under it stays where it was.
 */
export function useEntityInfo(): (id: string) => void {
  const [, setParams] = useSearchParams()
  return useCallback(
    (id: string) => setParams((current) => {
      const next = new URLSearchParams(current)
      next.set(INFO, id)
      return next
    }, { state: { infoPushed: true } }),
    [setParams],
  )
}

/** An entity's name that opens its panel. */
export function EntityName({ id, children }: { id: string; children: ReactNode }) {
  const open = useEntityInfo()
  return <button type="button" className="entity-name" onClick={() => open(id)}>{children}</button>
}

/** ⓘ next to a name that is already a toggle or a pick button: a button inside those would steal their tap. */
export function InfoButton({ id, name }: { id: string; name: string }) {
  const open = useEntityInfo()
  return (
    <button type="button" className="info-button" aria-label={fr.panel.info(name)} onClick={() => open(id)}>
      <Icon name="info" />
    </button>
  )
}

/** The panel itself, once in the shell: a bottom sheet on phones, a side column on wide screens. */
export function EntityPanel() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const id = params.get(INFO)
  const dialog = useRef<HTMLDialogElement>(null)

  const close = () => {
    if ((location.state as { infoPushed?: boolean } | null)?.infoPushed) navigate(-1)
    else setParams((current) => {
      const next = new URLSearchParams(current)
      next.delete(INFO)
      return next
    }, { replace: true })
  }

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (id && !element.open) element.showModal()
    if (!id && element.open) element.close()
  }, [id])

  return (
    <dialog ref={dialog} className="entity-panel" aria-label={fr.panel.title}
      onCancel={(e) => { e.preventDefault(); close() }}
      onClick={(e) => e.target === e.currentTarget && close()}>
      {id && <PanelBody key={id} id={id} close={close} />}
    </dialog>
  )
}

function PanelBody({ id, close }: { id: string; close: () => void }) {
  const { data, error, reload } = useLoad(() => load(id), id)
  return (
    <div className="entity-panel-body">
      <header className="entity-panel-head">
        <span className="entity-panel-title">
          {data && <span className="muted">{typeName(data.type)}</span>}
          <h2 className="block-title">{entityName(data?.content, id)}</h2>
        </span>
        {data && <Badge provenance={data.content.provenance} />}
        <button type="button" className="info-button" aria-label={fr.panel.close} onClick={close}>
          <Icon name="close" />
        </button>
      </header>
      {error && <ErrorNotice message={error} onRetry={reload} />}
      {!data && !error && <Loading />}
      {data && (
        <>
          <EntitySummary detail={data} />
          <Link className="btn btn-secondary" to={`/catalog/entity/${encodeURIComponent(id)}`}>{fr.panel.open}</Link>
        </>
      )}
    </div>
  )
}
