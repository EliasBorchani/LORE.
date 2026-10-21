// Writes content/srd/sources.json: the D&D 3.5 books an entry can come from, as `source` entries with their English
// title only (owner's choice). Rulesets add their own with « Nouveau livre ». Run again after adding a line.
import { writeFileSync } from 'node:fs'

const BOOKS = [
  ['srd', 'System Reference Document (SRD)'],
  ['players_handbook', 'Player’s Handbook'],
  ['dungeon_masters_guide', 'Dungeon Master’s Guide'],
  ['monster_manual', 'Monster Manual'],
  ['epic_level_handbook', 'Epic Level Handbook'],
  ['players_handbook_2', 'Player’s Handbook II'],
  ['dungeon_masters_guide_2', 'Dungeon Master’s Guide II'],
  ['complete_adventurer', 'Complete Adventurer'],
  ['complete_arcane', 'Complete Arcane'],
  ['complete_champion', 'Complete Champion'],
  ['complete_divine', 'Complete Divine'],
  ['complete_mage', 'Complete Mage'],
  ['complete_scoundrel', 'Complete Scoundrel'],
  ['complete_warrior', 'Complete Warrior'],
  ['tome_of_battle', 'Tome of Battle: The Book of Nine Swords'],
  ['spell_compendium', 'Spell Compendium'],
  ['magic_item_compendium', 'Magic Item Compendium'],
  ['expanded_psionics_handbook', 'Expanded Psionics Handbook'],
  ['unearthed_arcana', 'Unearthed Arcana'],
  ['libris_mortis', 'Libris Mortis'],
  ['draconomicon', 'Draconomicon'],
  ['book_of_exalted_deeds', 'Book of Exalted Deeds'],
  ['book_of_vile_darkness', 'Book of Vile Darkness'],
  ['races_of_stone', 'Races of Stone'],
  ['races_of_the_wild', 'Races of the Wild'],
  ['races_of_destiny', 'Races of Destiny'],
  ['races_of_the_dragon', 'Races of the Dragon'],
  ['eberron_campaign_setting', 'Eberron Campaign Setting'],
  ['forgotten_realms_campaign_setting', 'Forgotten Realms Campaign Setting'],
]

const entities = BOOKS.map(([id, en]) => ({ id: `source.${id}`, type: 'source', name: { en }, provenance: 'official' }))
const out = new URL('../../srd/sources.json', import.meta.url)
writeFileSync(out, `${JSON.stringify({ entities }, null, 2)}\n`)
console.log(`${entities.length} books`)
