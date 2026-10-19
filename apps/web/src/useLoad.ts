import { useCallback, useEffect, useState } from 'react'
import { ApiError } from './api/client'
import { fr } from './i18n/fr'

export interface Loaded<T> {
  data: T | null
  error: string | null
  reload: () => void
}

/** Runs [load] when [key] changes; a newer load replaces an older one still running. */
export function useLoad<T>(load: () => Promise<T>, key: string): Loaded<T> {
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null }>({ key, data: null, error: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let current = true
    load().then(
      (data) => current && setState({ key, data, error: null }),
      (error) => current && setState({ key, data: null, error: messageOf(error) }),
    )
    return () => {
      current = false
    }
    // `load` is a new closure on every render; `key` says when it reads something else.
  }, [key, attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  const fresh = state.key === key
  return { data: fresh ? state.data : null, error: fresh ? state.error : null, reload }
}

export function messageOf(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fr.errors.generic
}
