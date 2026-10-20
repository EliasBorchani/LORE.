// Shapes of the server's JSON (server/src/**/routes.rs).

export type Role = 'member' | 'admin'

export interface TokenPair {
  accessToken: string
  refreshToken: string
  tokenType: 'Bearer'
  expiresIn: number
}

export interface Invitation {
  email: string
  role: 'member' | 'admin'
  expiresAt: string
  /** The group the link leads into. */
  group?: { id: string; name: string }
  /** The email has an account already: its owner logs in, then joins. */
  account: boolean
}

export interface Me {
  id: number
  login: string
  role: Role
}

export type Localized = Partial<Record<'fr' | 'en', string>>

/** A toggle in the engine's character format. */
export interface ToggleChoice {
  toggle: string
  spell?: string
  entity?: string
  casterClass?: string
  metamagic?: string[]
  /** Exact number, as text or JSON number. */
  value?: string | number
}

export interface LevelRecord {
  level: number
  classId: string
  classLevel: number
  feats?: { id: string; slot?: string }[]
  abilityIncrease?: string
  skillRanks?: Record<string, number>
  spellcastingAdvances?: string[]
  gained?: string[]
}

/** The engine's character JSON (engine/.../model/Character.kt); unknown fields are kept as they are. */
export interface Character {
  id: string
  name: string
  xp?: number
  race?: string
  alignment?: string
  /** Entity id to the option picked for it (the class Spell Improvement applies to). */
  choices?: Record<string, string>
  baseAbilities: Record<string, number>
  levels?: LevelRecord[]
  items?: { id: string; equipped?: boolean }[]
  activeToggles?: ToggleChoice[]
  /** Class id to how it casts and the spells it knows (or its spellbook). */
  spellcasting?: Record<string, { mode: string; known?: string[] }>
  variants?: SpellVariant[]
  /** Skill id to ranks, for the whole character. */
  skillRanks?: Record<string, number>
  [field: string]: unknown
}

/** A spell saved with its metamagic, cast from the Magic tab. */
export interface SpellVariant {
  id: string
  spell: string
  casterClass: string
  metamagic?: string[]
  /** Levels added by Heighten Spell: the spell really is that level (slot, DC). */
  heighten?: number
}

export interface CharacterSummary {
  id: string
  ownerId: number
  groupId: string | null
  name: string
  level: number
  archived: boolean
  updatedAt: string
  playUpdatedAt: string
}

export interface CharacterRecord {
  id: string
  ownerId: number
  groupId: string | null
  version: number
  updatedAt: string
  archived: boolean
  character: Character
  play: { state: Record<string, unknown>; updatedAt: string }
}

export interface Entity {
  id: string
  type: string
  name: Localized
  description?: Localized
  provenance?: string
  source?: string
  labels?: string[]
  prerequisite?: string
  usesPerDay?: string | number
  effects?: Effect[]
  [field: string]: unknown
}

export interface Effect {
  target: string
  op: string
  value: string | number
  bonusType?: string
  condition?: string
  situation?: string
  layer?: 'base' | 'final'
  multMode?: string
  scope?: 'item' | 'spell'
}

/** One row of a class table: base attack and saves as running totals (exact numbers), features gained at that level. */
export interface ProgressionRow {
  classId: string
  level: number
  bab?: number | string
  fort?: number | string
  ref?: number | string
  will?: number | string
  grants?: string[]
  /** By spell level from 0; null = « — ». */
  spellsPerDay?: (number | null)[]
  spellsKnown?: (number | null)[]
}

export interface Relation {
  from: string
  relation: string
  to: string
  level?: number
}

export interface CatalogJson {
  entities: Entity[]
  progressions?: ProgressionRow[]
  relations?: Relation[]
  [section: string]: unknown
}

export interface Closure {
  catalog: CatalogJson
  versions: Record<string, number>
  missing: string[]
  /** Entities sent whose content is a house rule of the group, by official id. */
  houseRules?: Record<string, HouseRule>
}

/** A ruleset entity that replaces an official one in the group (« règle maison »). */
export interface HouseRule {
  /** The override's own id, the one to edit. */
  id: string
  ruleset: string
  rulesetName: string
  version: number
}

export interface EntitySummary {
  id: string
  type: string
  name: Localized | null
  labels?: string[] | null
  houseRule?: HouseRule
}

export interface SpellListEntry {
  id: string
  level: number | null
  name: Localized | null
}

export interface EntityPage {
  items: EntitySummary[]
  next?: string
}

/** The search filters; their values come from the content (`server/migrations/0007_search_filters.sql`). */
export const FACETS = ['school', 'descriptor', 'list', 'level', 'affects'] as const
export type Facet = (typeof FACETS)[number]
export type SearchFilters = Partial<Record<Facet, string[]>>

export interface SearchItem extends EntitySummary {
  /** Present when the words are only in the description. */
  matchedIn?: 'description'
}

export interface FacetValue {
  value: string | number
  /** Results with this value, the other filters applied. */
  count: number
  /** When the value is an entity id (a spell list, a skill). */
  name?: Localized
}

export interface SearchPage {
  items: SearchItem[]
  /** The `offset` of the next page. */
  next?: number
  facets?: Record<Facet, FacetValue[]>
}

export interface EntityDetail {
  id: string
  type: string
  version: number
  content: Entity
  /** The entity a team copy started from (before rulesets). */
  variantOf?: string
  /** The official entity this house rule replaces in the group. */
  overrides?: string
  /** The ruleset it belongs to; absent for official content. */
  ruleset?: { slug: string; name: string }
  /** The caller may change it. */
  editable: boolean
  /** Outgoing relations, each with the target's name (null when the target is not in the catalog). */
  relations?: EntityRelation[]
  /** The entities its content names (`has('feat.power_attack')`). */
  references?: EntityReference[]
}

export interface EntityReference {
  id: string
  type: string
  name: Localized | null
}

export interface EntityRelation {
  relation: string
  to: string
  extra: { level?: number; [field: string]: unknown }
  name: Localized | null
}

/** The core rule sections (`GET /catalog/core`): bonus types, statistics… */
export interface CoreSections {
  bonusTypes?: { id: string; name?: Localized }[]
  statistics?: { key: string }[]
  targetGroups?: { key: string }[]
  [section: string]: unknown
}

export interface EntityVersion {
  version: number
  author: string
  createdAt: string
  note: string | null
  /** A spell's levels as they were at this version (absent for imports). */
  relations?: { on_spell_list?: SpellLevel[] }
}

/** A spell's place on a class or domain list. */
export interface SpellLevel {
  to: string
  level: number
}

export type Permission = 'see_characters' | 'edit_characters' | 'edit_content' | 'invite' | 'moderator' | 'admin'

export interface GroupSummary {
  id: string
  name: string
  rpg: string
  archived: boolean
  /** The caller's permissions. */
  permissions: Permission[]
}

export interface GroupRuleset {
  slug: string
  name: string
  visibility: 'private' | 'public'
  archived: boolean
  /** The caller may change its content. */
  editable: boolean
}

/** Two rulesets of the group override the same entity: `winner` (the last in order) applies. */
export interface RulesetConflict {
  id: string
  rulesets: string[]
  winner: string
}

export interface GroupDetail extends GroupSummary {
  rulesets: GroupRuleset[]
  conflicts: RulesetConflict[]
}

export interface Member {
  userId: number
  login: string
  permissions: Permission[]
  joinedAt: string
}

export interface InviteReply {
  email: string
  sent: boolean
  /** Only when the mail could not be sent: pass it on another way. */
  link?: string
  expiresAt: string
}

export type RulesetAccess = 'read' | 'edit' | 'own'

export interface RulesetSummary {
  slug: string
  name: string
  rpg: string
  visibility: 'private' | 'public'
  archived: boolean
  access: 'own' | 'edit'
}

export interface Person {
  id: number
  login: string
}

export interface RulesetDetail {
  slug: string
  name: string
  rpg: string
  visibility: 'private' | 'public'
  archived: boolean
  access: RulesetAccess
  createdAt: string
  /** Only for its owner and editors (logins are emails). */
  owner?: Person
  editors?: Person[]
  entities: number
}

export interface RulesetEntity {
  id: string
  type: string
  name: Localized | null
  labels?: string[] | null
  overrides?: string
  version: number
}
