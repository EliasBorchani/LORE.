package dndtools.engine.resolve

import dndtools.engine.formula.Value
import dndtools.engine.model.MultMode
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Every statistic of a character at one level. Statistics with an error are missing from [values], see [issues]. */
@Serializable
data class Sheet(
    val atLevel: Int,
    val values: Map<String, Value>,
    val issues: List<SheetIssue>,
    /** Prerequisites of what the character has that are not met (or cannot be checked). The choice is kept. */
    val prerequisites: List<PrerequisiteResult> = emptyList(),
)

@Serializable
data class PrerequisiteResult(
    val entity: String,
    /** Parts of the prerequisite that are false, as formula text: `@ability.str.score >= 13`. */
    val failed: List<String> = emptyList(),
    /** Parts that could not be checked, with the reason (a statistic the catalog does not define yet). */
    val unknown: List<String> = emptyList(),
)

/** Result of [Session.update]: the new sheet, which values changed, and which statistics were recomputed. */
@Serializable
data class SheetUpdate(
    val sheet: Sheet,
    val changed: Set<String>,
    val recomputed: Set<String>,
)

@Serializable
data class SheetIssue(
    val code: Code,
    val statistic: String? = null,
    /** Effect or definition at fault: `spell.divine_favor/effects[0]`, `definition`. */
    val source: String? = null,
    val message: String,
) {
    @Serializable
    enum class Code {
        @SerialName("cycle") CYCLE,
        @SerialName("formula_error") FORMULA_ERROR,
        @SerialName("invalid_value") INVALID_VALUE,
        @SerialName("statistic_error") STATISTIC_ERROR,
    }
}

/** How one statistic got its value: every source, including the ones that did not count and why. */
@Serializable
data class Breakdown(
    val statistic: String,
    val value: Value? = null,
    val error: String? = null,
    val lines: List<BreakdownLine>,
)

@Serializable
data class BreakdownLine(
    val step: Step,
    /** Entity id, `definition` for the base value, or the key of a component. */
    val source: String,
    val value: Value,
    val status: Status = Status.APPLIED,
    val bonusType: String? = null,
    val multMode: MultMode? = null,
    /** The source that won instead of this line. */
    val suppressedBy: String? = null,
    val situation: String? = null,
    /** Metamagic applied to the spell this line comes from (Superspell: the value is already x4). */
    val modifiers: List<String> = emptyList(),
) {
    /** Steps in the order they are applied. */
    @Serializable
    enum class Step {
        @SerialName("base") BASE,
        @SerialName("component") COMPONENT,
        @SerialName("set_base") SET_BASE,

        /** Base dice moved by size categories ([dndtools.engine.model.StatisticDef.diceSteps]). */
        @SerialName("size") SIZE,
        @SerialName("add") ADD,
        @SerialName("dice") DICE,
        @SerialName("multiply") MULTIPLY,
        @SerialName("set_final") SET_FINAL,
        @SerialName("min") MIN,
        @SerialName("max") MAX,
    }

    @Serializable
    enum class Status {
        @SerialName("applied") APPLIED,

        /** A higher bonus of the same non-stacking type won. */
        @SerialName("not_stacking") NOT_STACKING,

        /** A higher multiplier of the same exclusive group won. */
        @SerialName("exclusive_lower") EXCLUSIVE_LOWER,

        /** A higher `set` on the same layer won. */
        @SerialName("set_lower") SET_LOWER,

        /** Counted, then replaced by a later `set`. */
        @SerialName("replaced") REPLACED,

        /** A floor or cap that did not change the value. */
        @SerialName("not_binding") NOT_BINDING,

        /** Applies only in a situation; shown, never added. */
        @SerialName("situational") SITUATIONAL,
    }
}
