import { useEffect, useState } from 'react'
import { browserStore } from '../api/client'

export type ThemeChoice = 'auto' | 'light' | 'dark'

const KEY = 'lore.theme'

/** `auto` follows the system setting (tokens.css reads prefers-color-scheme); the others force a theme. */
export function applyTheme(choice: ThemeChoice) {
  if (choice === 'auto') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = choice
}

export function savedTheme(): ThemeChoice {
  const saved = browserStore.get(KEY)
  return saved === 'light' || saved === 'dark' ? saved : 'auto'
}

export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState(savedTheme)
  useEffect(() => {
    applyTheme(choice)
    browserStore.set(KEY, choice === 'auto' ? null : choice)
  }, [choice])
  return [choice, setChoice]
}
