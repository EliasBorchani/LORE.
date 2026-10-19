package dndtools.engine.resolve

import dndtools.engine.formula.DiceTerm
import dndtools.engine.formula.DiceValue
import dndtools.engine.math.Fraction
import dndtools.engine.model.DiceSteps
import kotlin.math.absoluteValue

/** Moves damage dice along the catalog's size steps, one category at a time (`1d8` one size up is `2d6`). */
object SizeDice {
    private val DICE = Regex("(\\d+)d(\\d+)")
    private val NUMBER = Regex("\\d+")

    /** A step: dice, or a plain number for the smallest ones (`1d2` one size down is `1`). */
    sealed interface Step {
        data class Dice(val count: Long, val size: Long) : Step
        data class Flat(val value: Long) : Step
    }

    fun parse(text: String): Step? {
        DICE.matchEntire(text)?.let { return Step.Dice(it.groupValues[1].toLong(), it.groupValues[2].toLong()) }
        NUMBER.matchEntire(text)?.let { return Step.Flat(text.toLong()) }
        return null
    }

    /** [missing] names the first die the table could not move further; that term stops where it got. */
    class Result(val dice: DiceValue, val missing: String?)

    /** Scales each die term (its type and multiplier kept); the flat part does not change with size. */
    fun scale(dice: DiceValue, steps: Int, table: DiceSteps): Result {
        val moves = if (steps > 0) table.up else table.down
        var result = DiceValue(emptyList(), dice.flat)
        var missing: String? = null
        for (term in dice.terms) {
            var key = "${term.count}d${term.size}"
            for (i in 0 until steps.absoluteValue) {
                val next = moves[key]
                if (next == null || parse(next) == null) {
                    missing = missing ?: key
                    break
                }
                key = next
            }
            result += when (val step = parse(key)!!) {
                is Step.Dice -> DiceValue(listOf(DiceTerm(step.count, step.size, term.type, term.times)))
                is Step.Flat -> DiceValue(emptyList(), Fraction.of(step.value) * term.times)
            }
        }
        return Result(result, missing)
    }
}
