/** Book names stored as text before books were catalog entries (`content/srd/sources.json`): read as that entry. */
const ALIASES: Record<string, string> = {
  SRD: 'source.srd',
  'Epic (SRD)': 'source.srd',
  'SRD (épique)': 'source.srd',
  'Complete Arcane': 'source.complete_arcane',
  'Complete Mage': 'source.complete_mage',
  'Book of Nine Swords': 'source.tome_of_battle',
}

/** The book entry an entry's `source` names: its id, or the entry an old text stands for. */
export function sourceId(stored: string): string {
  return ALIASES[stored] ?? stored
}
