// Number formats from the Grimoire README: signed modifiers with a true minus, a narrow space for thousands,
// a decimal comma, dice with their average apart.

const NARROW_SPACE = ' '
const MINUS = '−'

/** `2480` → `2 480`, `25.5` → `25,5`, `-3` → `−3`. Fractions (`1/3`) stay as they are. */
export function formatNumber(text: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text.trim())
  if (!match) return text
  const [, sign, whole, decimals] = match
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, NARROW_SPACE)
  return (sign ? MINUS : '') + grouped + (decimals ? ',' + decimals : '')
}

/** A modifier is always signed: `145` → `+145`, `-2` → `−2`, `0` → `+0`. */
/**
 * A threat range is stored as how many d20 numbers threaten (19–20 is 2): shown as « 19–20 », or « 20 ». An en dash
 * between the numbers, as in the rule books.
 */
export function formatThreatRange(width: string): string {
  const n = Math.floor(Number(width))
  if (!Number.isFinite(n) || n < 1) return width
  const low = Math.max(21 - n, 1)
  return low >= 20 ? '20' : `${low}–20`
}

export function formatModifier(text: string): string {
  const formatted = formatNumber(text)
  return formatted.startsWith(MINUS) || !/^\d/.test(formatted) ? formatted : '+' + formatted
}

export interface DiceText {
  /** `3d6 + 138`, with large numbers grouped. */
  expression: string
  /** Floor of the average, `148`, or null when the text has none. */
  average: string | null
}

/** The engine writes dice as `3d6 + 138 (~148)`; the average is shown apart, in gilt. */
export function splitDice(text: string): DiceText {
  const match = /^(.*?)\s*\(~(-?\d+)\)$/.exec(text.trim())
  const expression = (match ? match[1] : text).replace(/\b\d{4,}\b/g, formatNumber)
  return { expression, average: match ? formatNumber(match[2]) : null }
}

/** Whole number of an exact engine value, or null (dice, fractions, text). */
export function toInteger(text: string | null | undefined): number | null {
  if (text == null || !/^-?\d+$/.test(text.trim())) return null
  return Number(text)
}
