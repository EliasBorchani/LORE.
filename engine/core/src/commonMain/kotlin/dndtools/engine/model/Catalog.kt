package dndtools.engine.model

import dndtools.engine.math.Fraction
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive

/** Language code to text, e.g. `{"fr": "Maître des lames", "en": "Warblade"}`. */
typealias LocalizedText = Map<String, String>

@Serializable
data class Catalog(
    val version: String,
    val bonusTypes: List<BonusType>,
    val damageTypes: List<DamageType> = emptyList(),
    val statistics: List<StatisticDef> = emptyList(),
    val targetGroups: List<TargetGroup> = emptyList(),
    val entities: List<Entity>,
    val progressions: List<ProgressionRow> = emptyList(),
    val progressionRules: ProgressionRules = ProgressionRules(),
    val rules: List<Rule> = emptyList(),
    val relations: List<Relation> = emptyList(),
    val diceSteps: DiceSteps = DiceSteps(),
)

/**
 * Damage dice one size category up and one down (`"1d8": "2d6"`), for statistics with [StatisticDef.diceSteps].
 * Keys and values are `<count>d<size>`, or a plain number for the smallest steps (`"1d2": "1"`).
 */
@Serializable
data class DiceSteps(
    val up: Map<String, String> = emptyMap(),
    val down: Map<String, String> = emptyMap(),
)

/**
 * How a statistic starts before effects apply. A statistic that is only targeted by effects needs no definition:
 * it starts at 0.
 *
 * A family member (`dc.school[abjuration]`) uses the definition keyed with `[*]` (`dc.school[*]`).
 */
@Serializable
data class StatisticDef(
    val key: String,
    /** Starting value, a number or a formula: `floor((@ability.str.score - 10) / 2)`. Default 0. */
    val base: EffectValue? = null,
    /** Statistics summed into the base, shown as named parts: `damage.melee.ability`. */
    val components: List<String> = emptyList(),
    /** Round down at the end. False only for intermediate values summed elsewhere before one final rounding. */
    val round: Boolean = true,
    val name: LocalizedText = emptyMap(),
    /**
     * Size steps applied to the dice after the base-layer `set`, before bonuses: `@weapon.size_steps` (1 = one size
     * category larger, -1 smaller). Each die term moves along [Catalog.diceSteps].
     */
    val diceSteps: EffectValue? = null,
)

/** A target that stands for several statistics: an effect on `save.all` applies to each save. */
@Serializable
data class TargetGroup(
    val key: String,
    val members: List<String>,
)

/** A damage type for dice. A multi type (`bludgeoning_fire`) splits its dice evenly between its [parts]. */
@Serializable
data class DamageType(
    val id: String,
    val parts: List<String> = emptyList(),
)

@Serializable
data class BonusType(
    val id: String,
    val stacks: Boolean,
)

@Serializable
data class Entity(
    val id: String,
    val type: String,
    /** Hit die of a class (12 for d12). Hit points per level are a house rule formula on it. */
    val hitDie: Int? = null,
    val name: LocalizedText,
    val provenance: String? = null,
    val source: String? = null,
    val labels: List<String> = emptyList(),
    val description: LocalizedText = emptyMap(),
    /** Formula that must hold to take the entity. */
    val prerequisite: String? = null,
    /** Maximum uses per day, a number or a formula. Shown for reference, never tracked. */
    val usesPerDay: EffectValue? = null,
    val effects: List<Effect> = emptyList(),
    /** How a class casts spells; its slots and spells known are columns of its table. */
    val spellcasting: SpellcastingDef? = null,
    /** A spell's display data. Its numbers are effects scoped to `spell`. */
    val spell: SpellInfo? = null,
    /** An item's display data. Its numbers are effects (weapon dice scoped to `item`, armor on `ac.armor`). */
    val item: ItemInfo? = null,
    /** How a skill is computed; the skill's statistic key is its entity id. */
    val skill: SkillInfo? = null,
    /** Skill points a class gives per level, before the Intelligence modifier (×4 at character level 1). */
    val skillPoints: Long? = null,
)

/** A skill: its ability, and whether armor hinders it (2 for Swim) or it needs ranks to be used. */
@Serializable
data class SkillInfo(
    val ability: Ability,
    /** Times the armor check penalty applies: 0, 1, or 2 (Swim). */
    val armorCheckPenalty: Long = 0,
    val trainedOnly: Boolean = false,
)

/** Equipment table columns, shown as written; nothing here is computed. */
@Serializable
data class ItemInfo(
    /** Informative body slot: `weapon`, `armor`, `shield`, `body`, `gear`... */
    val slot: String? = null,
    val cost: String? = null,
    val weight: String? = null,
    /** Weapon damage for a size M wielder, and for size P. */
    val damage: String? = null,
    val damageSmall: String? = null,
    val critical: String? = null,
    val range: String? = null,
    val damageType: String? = null,
    val armorBonus: String? = null,
    val maxDex: String? = null,
    val checkPenalty: String? = null,
    val spellFailure: String? = null,
    /** Speed in armor for a 9 m and a 6 m base speed. */
    val speed: String? = null,
)

@Serializable
data class SpellcastingDef(
    /** Ability whose modifier gives bonus spells and save DCs: `int`, `wis`, `cha`. */
    val ability: Ability,
    /** `arcane` or `divine`: which `caster_level.<kind>` bonuses apply. */
    val kind: String,
    /** How the class casts when the character does not say otherwise. */
    val mode: SpellcastingMode = SpellcastingMode.PREPARED,
)

/** Rules text of a spell, shown as written; nothing here is computed. */
@Serializable
data class SpellInfo(
    val school: String? = null,
    val subschool: String? = null,
    val descriptors: List<String> = emptyList(),
    val components: String? = null,
    val castingTime: String? = null,
    val range: String? = null,
    val target: String? = null,
    val area: String? = null,
    val effect: String? = null,
    val duration: String? = null,
    val savingThrow: String? = null,
    val spellResistance: String? = null,
)

@Serializable
data class Effect(
    /** Statistic key, or a component of it: `ability.str.score`, `damage.melee.ability`, `dc.school[abjuration]`. */
    val target: String,
    val op: Op,
    val value: EffectValue,
    val bonusType: String? = null,
    /** Formula that must hold for the effect to count, e.g. `active('toggle.rage')`. */
    val condition: String? = null,
    /** Situation id (`situation.vs_evil`): the effect is shown as a conditional line, never added to the total. */
    val situation: String? = null,
    val layer: Layer? = null,
    val multMode: MultMode? = null,
    val scope: EffectScope? = null,
)

@Serializable
enum class Op {
    @SerialName("add") ADD,
    @SerialName("multiply") MULTIPLY,
    @SerialName("set") SET,
    @SerialName("min") MIN,
    @SerialName("max") MAX,
    @SerialName("dice") DICE,
    @SerialName("grant") GRANT,
}

/** Which `set` step an effect belongs to: before bonuses (`base`) or after everything (`final`). */
@Serializable
enum class Layer {
    @SerialName("base") BASE,
    @SerialName("final") FINAL,
}

/** The statistic belongs to an equipped item (weapon attack) or to a spell variant (`spell.damage`). */
@Serializable
enum class EffectScope {
    @SerialName("item") ITEM,
    @SerialName("spell") SPELL,
}

/**
 * Effect value as written in the catalog: an exact number, or text that the formula stage parses
 * (a formula, a dice expression, or a word such as `swift`).
 */
@Serializable(with = EffectValueSerializer::class)
sealed interface EffectValue {
    data class Number(val value: Fraction) : EffectValue
    data class Text(val text: String) : EffectValue
}

object EffectValueSerializer : KSerializer<EffectValue> {
    private val PLAIN_FRACTION = Regex("-?\\d+/\\d+")

    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("dndtools.EffectValue", PrimitiveKind.STRING)

    override fun serialize(encoder: Encoder, value: EffectValue) {
        when (value) {
            is EffectValue.Number -> encoder.encodeSerializableValue(Fraction.serializer(), value.value)
            is EffectValue.Text -> encoder.encodeString(value.text)
        }
    }

    override fun deserialize(decoder: Decoder): EffectValue {
        val json = decoder as? JsonDecoder ?: return EffectValue.Text(decoder.decodeString())
        val element = json.decodeJsonElement()
        if (element !is JsonPrimitive || element is JsonNull) {
            throw SerializationException("Effect value must be a number or a string, got $element")
        }
        // "1/3" is how a non-decimal number is written, so it reads back as a number, not as formula text.
        if (element.isString) {
            return if (PLAIN_FRACTION.matches(element.content)) {
                EffectValue.Number(Fraction.parse(element.content))
            } else {
                EffectValue.Text(element.content)
            }
        }
        if (element.content == "true" || element.content == "false") {
            throw SerializationException("Effect value must be a number or a string, got ${element.content}")
        }
        return try {
            EffectValue.Number(Fraction.parse(element.content))
        } catch (e: NumberFormatException) {
            throw SerializationException(e.message)
        }
    }
}

/** How a multiplier combines with others on the same statistic. Always explicit on a `multiply` effect. */
@Serializable(with = MultModeSerializer::class)
sealed interface MultMode {
    /** Only the highest multiplier of the group applies. */
    data class Exclusive(val group: String) : MultMode

    /** Extra parts add, as in 3.5: ×2 and ×2 give ×3. */
    data object Additive : MultMode

    /** Multipliers multiply: ×3 and ×2 give ×6. */
    data object Multiplicative : MultMode
}

/** JSON form: `"additive"`, `"multiplicative"` or `"exclusive: <group>"`. */
object MultModeSerializer : KSerializer<MultMode> {
    private const val EXCLUSIVE = "exclusive:"

    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("dndtools.MultMode", PrimitiveKind.STRING)

    override fun serialize(encoder: Encoder, value: MultMode) {
        encoder.encodeString(
            when (value) {
                is MultMode.Exclusive -> "$EXCLUSIVE ${value.group}"
                MultMode.Additive -> "additive"
                MultMode.Multiplicative -> "multiplicative"
            }
        )
    }

    override fun deserialize(decoder: Decoder): MultMode {
        val text = decoder.decodeString().trim()
        return when {
            text == "additive" -> MultMode.Additive
            text == "multiplicative" -> MultMode.Multiplicative
            text.startsWith(EXCLUSIVE) -> {
                val group = text.removePrefix(EXCLUSIVE).trim()
                if (group.isEmpty()) throw SerializationException("Exclusive multiplier needs a group: '$text'")
                MultMode.Exclusive(group)
            }
            else -> throw SerializationException("Unknown multiplier mode: '$text'")
        }
    }
}

/**
 * One written row of a class table. `bab` and saves are the class's total at that class level, as in the book
 * tables (fractions allowed); null means the row has no value and the epic rule decides.
 */
@Serializable
data class ProgressionRow(
    val classId: String,
    val level: Int,
    val bab: Fraction? = null,
    val fort: Fraction? = null,
    val ref: Fraction? = null,
    val will: Fraction? = null,
    /** Entities the class gives at this class level. */
    val grants: List<String> = emptyList(),
    /** Spells per day by spell level from 0; null = « — » (cannot cast that level), 0 = bonus spells only. */
    val spellsPerDay: List<Int?> = emptyList(),
    /** Spells known by spell level from 0, for spontaneous casters; null = « — ». */
    val spellsKnown: List<Int?> = emptyList(),
)

/**
 * How class tables turn into base attack and saves.
 *
 * A class level gained at character level <= [epicAfterLevel] uses the class table (running totals; past the last
 * written row, the last value holds). A level gained after it gives [epicPerLevel] instead, whatever the table says.
 */
@Serializable
data class ProgressionRules(
    val epicAfterLevel: Int? = null,
    /** `bab`, `fort`, `ref`, `will` to the gain per epic level. */
    val epicPerLevel: Map<String, Fraction> = emptyMap(),
)

/** A house rule in words. The rule itself is encoded as data elsewhere; this is the reference text. */
@Serializable
data class Rule(
    val id: String,
    val appliesTo: String? = null,
    val text: String? = null,
    val formula: String? = null,
)

@Serializable
data class Relation(
    val from: String,
    val relation: String,
    val to: String,
    val level: Int? = null,
)
