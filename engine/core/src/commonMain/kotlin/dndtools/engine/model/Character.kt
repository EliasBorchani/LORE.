package dndtools.engine.model

import dndtools.engine.math.Fraction
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** A character is only its choices; every value on the sheet is recomputed from them and the catalog. */
@Serializable
data class Character(
    val id: String,
    val name: String,
    val xp: Long = 0,
    val race: String? = null,
    /** Alignment entity id (`alignment.lawful_good`). */
    val alignment: String? = null,
    val baseAbilities: Map<Ability, Long>,
    /** Level-up records in order; the engine replays 1..N to get the sheet at level N. */
    val levels: List<LevelRecord> = emptyList(),
    val items: List<ItemChoice> = emptyList(),
    /** Class id to how that class casts. */
    val spellcasting: Map<String, SpellcastingChoice> = emptyMap(),
    val activeToggles: List<ToggleChoice> = emptyList(),
    /**
     * Entity id to the option the player picked for it, e.g. the class Spell Improvement applies to. Effects read it
     * through `{choice}` in their target. One choice per entity for the spike.
     */
    val choices: Map<String, String> = emptyMap(),
    /** Saved spell variants (a spell and the metamagic applied to it), cast from the sheet. */
    val variants: List<SpellVariant> = emptyList(),
    /**
     * Skill id to ranks, for the whole character (the player grows the skills they want, not level by level). Ranks
     * written in level records add to these.
     */
    val skillRanks: Map<String, Long> = emptyMap(),
)

/** A spell prepared with metamagic. Its statistics are `variant[<id>].<target>` (slot level, damage, DC…). */
@Serializable
data class SpellVariant(
    /** Unique among the character's variants and different from any spell id. */
    val id: String,
    val spell: String,
    /** Class casting it: its caster level, casting ability and spell list apply. */
    val casterClass: String,
    val metamagic: List<String> = emptyList(),
    /**
     * Levels added by Heighten Spell. The spell really is that level (slot, DC), so it is not a modifier in
     * [metamagic]: the « at least +1 » rule and Improved Metamagic do not touch it.
     */
    val heighten: Int = 0,
)

@Serializable
enum class Ability {
    @SerialName("str") STR,
    @SerialName("dex") DEX,
    @SerialName("con") CON,
    @SerialName("int") INT,
    @SerialName("wis") WIS,
    @SerialName("cha") CHA,
}

@Serializable
data class LevelRecord(
    /** Character level reached with this record. */
    val level: Int,
    val classId: String,
    /** Level in [classId] reached with this record. Redundant with the order of records, kept as a check. */
    val classLevel: Int,
    val feats: List<FeatChoice> = emptyList(),
    val abilityIncrease: Ability? = null,
    /** Skill id to ranks bought at this level. */
    val skillRanks: Map<String, Long> = emptyMap(),
    /** Spellcasting classes this prestige level advances. */
    val spellcastingAdvances: List<String> = emptyList(),
    /** Entities gained at this level outside of feats (templates, special feats). */
    val gained: List<String> = emptyList(),
)

@Serializable
data class FeatChoice(
    val id: String,
    /** Which feat slot pays for it: `general`, `epic`, `warblade_bonus`... */
    val slot: String? = null,
)

@Serializable
data class ItemChoice(
    val id: String,
    val equipped: Boolean = true,
)

@Serializable
data class SpellcastingChoice(
    val mode: SpellcastingMode,
    /** Spells known (spontaneous) or in the spellbook (prepared). Free-slot casters use the whole class list. */
    val known: List<String> = emptyList(),
)

@Serializable
enum class SpellcastingMode {
    @SerialName("prepared") PREPARED,
    @SerialName("spontaneous") SPONTANEOUS,

    /** Campaign rule: any spell of the class list at that slot level. */
    @SerialName("free_slots") FREE_SLOTS,
}

/** A toggle the player switched on, optionally pointing to a spell variant or carrying a chosen value. */
@Serializable
data class ToggleChoice(
    val toggle: String,
    /** A saved variant this toggle casts; it then gives the spell, the caster class and the metamagic. */
    val variant: String? = null,
    val spell: String? = null,
    val entity: String? = null,
    /** Class casting [spell]; its caster level is the spell's `@spell.caster_level`. */
    val casterClass: String? = null,
    /** Metamagic feats applied to [spell]: the toggle uses the computed spell variant. */
    val metamagic: List<String> = emptyList(),
    /** Value picked by the player, read by formulas as `@toggle.<id>.value` (Power Attack). */
    val value: Fraction? = null,
)
