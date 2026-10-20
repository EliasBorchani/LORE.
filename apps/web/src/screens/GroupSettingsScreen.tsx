import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { api } from '../api/client'
import type { InviteReply, Member, Permission } from '../api/types'
import { ErrorNotice, Loading, StatBlock } from '../components/grimoire'
import { useGroup } from '../group/GroupContext'
import { fr } from '../i18n/fr'
import { messageOf, useLoad } from '../useLoad'

const PERMISSIONS: Permission[] = ['see_characters', 'edit_characters', 'edit_content', 'invite', 'moderator', 'admin']

/** `eberron` or a pasted page link (`https://…/rulesets/eberron`): both name the same ruleset. */
export function slugOf(text: string): string {
  const trimmed = text.trim()
  const fromLink = /\/rulesets\/([a-z][a-z0-9_]*)/.exec(trimmed)?.[1]
  return (fromLink ?? trimmed).toLowerCase()
}

/** The group's members, invitations and rulesets. Every member reads it; permissions decide what changes. */
export function GroupSettingsScreen() {
  const { group, can, reload } = useGroup()
  const isAdmin = group.permissions.includes('admin')
  return (
    <>
      <h1 className="type-display-l">{group.name}</h1>
      {group.archived && <p className="warning">{fr.groups.archivedNotice}</p>}
      {isAdmin && <GroupName />}
      <Members />
      {can('invite') && !group.archived && <Invite />}
      <Rulesets />
      <NewRuleset />
      <Leave />
      {isAdmin && (
        <button className="btn btn-secondary" onClick={() => api.updateGroup(group.id, { archived: !group.archived }).then(reload)}>
          {group.archived ? fr.groups.unarchive : fr.groups.archive}
        </button>
      )}
    </>
  )
}

function GroupName() {
  const { group, reload } = useGroup()
  const [name, setName] = useState(group.name)
  const [error, setError] = useState<string | null>(null)
  async function save(event: FormEvent) {
    event.preventDefault()
    try {
      await api.updateGroup(group.id, { name })
      reload()
    } catch (e) {
      setError(messageOf(e))
    }
  }
  return (
    <form onSubmit={save} className="search-row">
      <label className="field">
        <span>{fr.groups.name}</span>
        <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </label>
      <button className="btn btn-secondary btn-small" type="submit" disabled={!name.trim() || name === group.name}>{fr.groups.rename}</button>
      {error && <p className="warning" role="alert">{error}</p>}
    </form>
  )
}

function Members() {
  const { group } = useGroup()
  const { data: members, error, reload } = useLoad(() => api.members(group.id), `members/${group.id}`)
  const manages = group.permissions.includes('admin') || group.permissions.includes('moderator')
  return (
    <StatBlock title={fr.groups.members}>
      {error && <ErrorNotice message={error} onRetry={reload} />}
      {!members && !error && <Loading />}
      {members?.map((m) => <MemberRow key={m.userId} member={m} manages={manages} reload={reload} />)}
    </StatBlock>
  )
}

/** A moderator changes permissions and removes members, never an admin; only an admin names one. */
function MemberRow({ member, manages, reload }: { member: Member; manages: boolean; reload: () => void }) {
  const { group } = useGroup()
  const isAdmin = group.permissions.includes('admin')
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const touchable = manages && (isAdmin || !member.permissions.includes('admin'))

  async function toggle(permission: Permission) {
    const next = member.permissions.includes(permission)
      ? member.permissions.filter((p) => p !== permission)
      : [...member.permissions, permission]
    try {
      await api.setPermissions(group.id, member.userId, next)
      setError(null)
      reload()
    } catch (e) {
      setError(messageOf(e))
    }
  }

  async function remove() {
    try {
      await api.removeMember(group.id, member.userId)
      reload()
    } catch (e) {
      setError(messageOf(e))
    }
  }

  return (
    <div className="member">
      <p className="list-row-title">{member.login}</p>
      <div className="chips">
        {PERMISSIONS.map((p) => {
          const on = member.permissions.includes(p)
          if (!touchable) return on ? <span key={p} className="chip" aria-pressed="true">{fr.groups.permissions[p]}</span> : null
          return (
            <button key={p} type="button" className="chip" aria-pressed={on}
              disabled={p === 'admin' && !isAdmin} onClick={() => toggle(p)}>
              {fr.groups.permissions[p]}
            </button>
          )
        })}
      </div>
      {touchable && (
        <button type="button" className="btn btn-secondary btn-small" onClick={() => (confirm ? remove() : setConfirm(true))}>
          {confirm ? fr.groups.removeConfirm(member.login) : fr.groups.remove}
        </button>
      )}
      {error && <p className="warning" role="alert">{error}</p>}
    </div>
  )
}

function Invite() {
  const { group } = useGroup()
  const manages = group.permissions.includes('admin') || group.permissions.includes('moderator')
  const [email, setEmail] = useState('')
  const [permissions, setPermissions] = useState<Permission[]>(['see_characters'])
  const [reply, setReply] = useState<InviteReply | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function send(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setReply(null)
    try {
      setReply(await api.invite(group.id, email.trim(), manages ? permissions : undefined))
      setEmail('')
    } catch (e) {
      setError(messageOf(e))
    }
    setBusy(false)
  }

  return (
    <StatBlock title={fr.groups.invite}>
      <form onSubmit={send}>
        <label className="field">
          <span>{fr.groups.email}</span>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {manages && (
          <div className="chips" role="group" aria-label={fr.groups.invitePermissions}>
            {PERMISSIONS.filter((p) => p !== 'admin' || group.permissions.includes('admin')).map((p) => (
              <button key={p} type="button" className="chip" aria-pressed={permissions.includes(p)}
                onClick={() => setPermissions((ps) => (ps.includes(p) ? ps.filter((x) => x !== p) : [...ps, p]))}>
                {fr.groups.permissions[p]}
              </button>
            ))}
          </div>
        )}
        <p className="field-hint">{fr.groups.inviteHint}</p>
        <button className="btn btn-primary" type="submit" disabled={busy || !email.trim()}>{fr.groups.inviteButton}</button>
      </form>
      {error && <p className="warning" role="alert">{error}</p>}
      {reply?.sent && <p>{fr.groups.inviteSent(reply.email)}</p>}
      {reply && !reply.sent && reply.link && (
        <p>
          {fr.groups.inviteLink(reply.email)}
          <br />
          <code className="invite-link">{reply.link}</code>
        </p>
      )}
    </StatBlock>
  )
}

/** In order: the last ruleset wins when two change the same entity. */
function Rulesets() {
  const { group, reload } = useGroup()
  const isAdmin = group.permissions.includes('admin')
  const [adding, setAdding] = useState('')
  const [error, setError] = useState<string | null>(null)
  const slugs = group.rulesets.map((r) => r.slug)

  async function save(next: string[]) {
    try {
      await api.setGroupRulesets(group.id, next)
      setError(null)
      setAdding('')
      reload()
    } catch (e) {
      setError(messageOf(e))
    }
  }
  const move = (i: number, by: number) => {
    const next = [...slugs]
    ;[next[i], next[i + by]] = [next[i + by], next[i]]
    void save(next)
  }

  return (
    <StatBlock title={fr.groups.rulesets}>
      <p className="field-hint">{fr.groups.rulesetsHint}</p>
      {group.rulesets.length === 0 && <p className="muted">{fr.groups.noRulesets}</p>}
      {group.rulesets.map((r, i) => (
        <div key={r.slug} className="list-row">
          <span className="list-row-text">
            <Link className="list-row-title" to={`/rulesets/${r.slug}`}>{r.name}</Link>
            <span className="list-row-sub">
              {r.slug} · {fr.rulesets.visibility[r.visibility]}{r.archived ? ` · ${fr.groups.archived}` : ''}
            </span>
          </span>
          {isAdmin && (
            <span className="button-row">
              <button type="button" className="btn btn-secondary btn-small" disabled={i === 0} aria-label={fr.groups.up(r.name)} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="btn btn-secondary btn-small" disabled={i === slugs.length - 1} aria-label={fr.groups.down(r.name)} onClick={() => move(i, 1)}>↓</button>
              <button type="button" className="btn btn-secondary btn-small" aria-label={fr.groups.drop(r.name)} onClick={() => save(slugs.filter((s) => s !== r.slug))}>×</button>
            </span>
          )}
        </div>
      ))}
      {group.conflicts.map((c) => (
        <p key={c.id} className="warning">{fr.groups.conflict(c.id, c.rulesets.join(', '), c.winner)}</p>
      ))}
      {isAdmin && (
        <form className="search-row" onSubmit={(e) => { e.preventDefault(); void save([...slugs, slugOf(adding)]) }}>
          <label className="field">
            <span>{fr.groups.addRuleset}</span>
            <input className="input" value={adding} placeholder="eberron" autoComplete="off" spellCheck={false}
              onChange={(e) => setAdding(e.target.value)} />
          </label>
          <button className="btn btn-secondary btn-small" type="submit" disabled={!adding.trim()}>{fr.groups.add}</button>
        </form>
      )}
      {error && <p className="warning" role="alert">{error}</p>}
    </StatBlock>
  )
}

/** Any account creates rulesets; a group admin gets the new one added to the group at once. */
function NewRuleset() {
  const { group, reload } = useGroup()
  const isAdmin = group.permissions.includes('admin')
  const [open, setOpen] = useState(false)
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [visibility, setVisibility] = useState<'private' | 'public'>('private')
  const [error, setError] = useState<string | null>(null)

  async function create(event: FormEvent) {
    event.preventDefault()
    try {
      await api.createRuleset(slug, name.trim(), visibility, group.rpg)
      if (isAdmin) await api.setGroupRulesets(group.id, [...group.rulesets.map((r) => r.slug), slug])
      setOpen(false)
      reload()
    } catch (e) {
      setError(messageOf(e))
    }
  }

  if (!open) return <button className="btn btn-secondary" onClick={() => setOpen(true)}>{fr.rulesets.create}</button>
  return (
    <StatBlock title={fr.rulesets.create}>
      <form onSubmit={create}>
        <label className="field">
          <span>{fr.rulesets.name}</span>
          <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>{fr.rulesets.slug}</span>
          <input className="input" value={slug} autoComplete="off" spellCheck={false} maxLength={31}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} />
          <span className="field-hint">{fr.rulesets.slugHint}</span>
        </label>
        <label className="field">
          <span>{fr.rulesets.visibilityLabel}</span>
          <select className="input" value={visibility} onChange={(e) => setVisibility(e.target.value as 'private' | 'public')}>
            <option value="private">{fr.rulesets.visibility.private}</option>
            <option value="public">{fr.rulesets.visibility.public}</option>
          </select>
        </label>
        {error && <p className="warning" role="alert">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={!name.trim() || slug.length < 3}>{fr.rulesets.createButton}</button>
      </form>
    </StatBlock>
  )
}

/** Two taps: the characters stay in the group, archived. */
function Leave() {
  const { group } = useGroup()
  const navigate = useNavigate()
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function leave() {
    try {
      await api.leaveGroup(group.id)
      navigate('/?all', { replace: true })
    } catch (e) {
      setError(messageOf(e))
    }
  }
  return (
    <>
      <button className="btn btn-secondary" onClick={() => (confirm ? leave() : setConfirm(true))}>
        {confirm ? fr.groups.leaveConfirm : fr.groups.leave}
      </button>
      {error && <p className="warning" role="alert">{error}</p>}
    </>
  )
}
