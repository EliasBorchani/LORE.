package dndtools.engine.formula

import dndtools.engine.math.Fraction
import dndtools.engine.math.addExact
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Result of a formula: a number, a test result, a word, or described dice. */
@Serializable
sealed interface Value {
    @Serializable @SerialName("number")
    data class Num(val value: Fraction) : Value

    @Serializable @SerialName("bool")
    data class Bool(val value: Boolean) : Value

    @Serializable @SerialName("text")
    data class Text(val value: String) : Value

    @Serializable @SerialName("dice")
    data class Dice(val value: DiceValue) : Value
}

/**
 * Dice are described, never rolled: `3 × 20d6 electricity + 12`.
 *
 * Terms with the same size, type and multiplier merge (`3d6 + 2d6` is `5d6`). A multiplier is kept apart from the
 * count, so `3 × 20d6` stays three rays of 20d6 and does not become 60d6.
 */
@Serializable
data class DiceValue(
    val terms: List<DiceTerm>,
    val flat: Fraction = Fraction.ZERO,
) {
    val average: Fraction
        get() = terms.fold(flat) { sum, t -> sum + t.average }

    operator fun plus(other: DiceValue): DiceValue = DiceValue(merge(terms + other.terms), flat + other.flat)

    operator fun plus(number: Fraction): DiceValue = copy(flat = flat + number)

    operator fun times(factor: Fraction): DiceValue {
        if (factor.signum() < 0) throw ArithmeticException("Dice cannot be multiplied by a negative number")
        if (factor.signum() == 0) return DiceValue(emptyList(), Fraction.ZERO)
        return DiceValue(merge(terms.map { it.copy(times = it.times * factor) }), flat * factor)
    }

    /**
     * Average per damage type, multi types split evenly between their parts (from the catalog's damage types).
     * Untyped dice and the flat part are under the `null` key.
     */
    fun averageByType(multiTypeParts: Map<String, List<String>>): Map<String?, Fraction> {
        val result = LinkedHashMap<String?, Fraction>()
        fun add(type: String?, amount: Fraction) {
            result[type] = (result[type] ?: Fraction.ZERO) + amount
        }
        for (term in terms) {
            val parts = term.type?.let { multiTypeParts[it] }.orEmpty()
            if (parts.isEmpty()) {
                add(term.type, term.average)
            } else {
                val share = term.average / parts.size.toLong()
                parts.forEach { add(it, share) }
            }
        }
        if (flat.signum() != 0) add(null, flat)
        return result
    }

    /** `3 × 20d6 electricity + 12 (~222)`: the expression, then its average rounded down. */
    fun describe(): String {
        val parts = terms.map { it.describe() }.toMutableList()
        val text = buildString {
            append(parts.joinToString(" + "))
            when {
                parts.isEmpty() -> append(flat)
                flat.signum() > 0 -> append(" + ").append(flat)
                flat.signum() < 0 -> append(" - ").append(-flat)
            }
        }
        return "$text (~${average.floor()})"
    }

    companion object {
        fun of(count: Long, size: Long, type: String? = null): DiceValue {
            if (count < 0) throw ArithmeticException("Dice count cannot be negative: $count")
            if (count == 0L) return DiceValue(emptyList())
            return DiceValue(listOf(DiceTerm(count, size, type)))
        }

        private fun merge(terms: List<DiceTerm>): List<DiceTerm> =
            terms.groupBy { Triple(it.size, it.type, it.times) }
                .map { (_, group) -> group.reduce { a, b -> a.copy(count = addExact(a.count, b.count)) } }
    }
}

@Serializable
data class DiceTerm(
    val count: Long,
    val size: Long,
    val type: String? = null,
    val times: Fraction = Fraction.ONE,
) {
    /** A die of size n averages (n + 1) / 2. */
    val average: Fraction
        get() = Fraction.of(size + 1, 2) * count * times

    fun describe(): String {
        val dice = "${count}d$size" + (type?.let { " $it" } ?: "")
        return if (times == Fraction.ONE) dice else "${times.toDecimalString() ?: times} × $dice"
    }
}
