import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { api } from '../api/client'
import type { EntitySummary } from '../api/types'
import { ErrorNotice, StatBlock } from '../components/grimoire'
import { abilities, fr } from '../i18n/fr'
import { allOfType } from '../sheet/catalogLists'
import { localized } from '../sheet/names'
import { messageOf } from '../useLoad'
import { useGroup } from '../group/GroupContext'

/**
 * Name, race, alignment and the six scores typed by hand (owner's choice). The character starts with no level: the
 * level-up screen then adds level 1 with its class and feats.
 */
export function NewCharacterScreen() {
  const { group, catalog: groupApi, path: groupPath } = useGroup()
  const navigate = useNavigate()
  const [races, setRaces] = useState<EntitySummary[]>([])
  const [alignments, setAlignments] = useState<EntitySummary[]>([])
  const [name, setName] = useState('')
  const [race, setRace] = useState('')
  const [alignment, setAlignment] = useState('')
  const [scores, setScores] = useState<Record<string, string>>(() => Object.fromEntries(abilities.map((a) => [a.id, '10'])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    allOfType(groupApi, 'race').then(setRaces, (e) => setError(messageOf(e)))
    allOfType(groupApi, 'alignment').then(setAlignments, (e) => setError(messageOf(e)))
  }, [])

  const valid = name.trim() !== '' && abilities.every((a) => /^\d+$/.test(scores[a.id] ?? ''))

  async function create() {
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      const record = await api.createCharacter(group.id, {
        id: '',
        name: name.trim(),
        ...(race ? { race } : {}),
        ...(alignment ? { alignment } : {}),
        baseAbilities: Object.fromEntries(abilities.map((a) => [a.id, Number(scores[a.id])])),
        levels: [],
      })
      navigate(groupPath(`/characters/${record.id}/level-up`))
    } catch (e) {
      setError(messageOf(e))
      setBusy(false)
    }
  }

  const options = (list: EntitySummary[]) =>
    [...list]
      .map((e) => ({ id: e.id, name: localized(e.name) ?? e.id }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
      .map((e) => <option key={e.id} value={e.id}>{e.name}</option>)

  return (
    <>
      <h1 className="type-display-l">{fr.editor.newCharacter}</h1>
      {error && <ErrorNotice message={error} />}
      <form onSubmit={(e) => { e.preventDefault(); void create() }}>
        <StatBlock title={fr.editor.newCharacter}>
          <label className="field">
            <span>{fr.editor.name}</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </label>
          <label className="field">
            <span>{fr.editor.race}</span>
            <select className="input" value={race} onChange={(e) => setRace(e.target.value)}>
              <option value="">{fr.editor.pick}</option>
              {options(races)}
            </select>
          </label>
          <label className="field">
            <span>{fr.editor.alignment}</span>
            <select className="input" value={alignment} onChange={(e) => setAlignment(e.target.value)}>
              <option value="">{fr.editor.pick}</option>
              {options(alignments)}
            </select>
          </label>
        </StatBlock>
        <StatBlock title={fr.editor.abilities}>
          <p className="muted">{fr.editor.abilitiesHint}</p>
          <div className="form-grid">
            {abilities.map((a) => (
              <label key={a.id} className="field">
                <span>{a.name}</span>
                <input className="input" type="number" inputMode="numeric" min="1" value={scores[a.id]}
                  onChange={(e) => setScores((s) => ({ ...s, [a.id]: e.target.value }))} />
              </label>
            ))}
          </div>
        </StatBlock>
        {!name.trim() && <p className="muted">{fr.editor.nameNeeded}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy || !valid}>
          {busy ? fr.editor.creating : fr.editor.create}
        </button>
      </form>
    </>
  )
}
