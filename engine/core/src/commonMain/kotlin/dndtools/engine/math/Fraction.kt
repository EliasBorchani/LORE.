package dndtools.engine.math

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.KSerializer
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
import kotlinx.serialization.json.JsonUnquotedLiteral

/**
 * Exact rational number with a 64-bit numerator and denominator.
 *
 * Always normalized: the denominator is positive and the fraction is reduced, so structural equality is value
 * equality. Every operation throws [ArithmeticException] on overflow instead of wrapping around.
 */
@Serializable(with = FractionSerializer::class)
class Fraction private constructor(val numerator: Long, val denominator: Long) : Comparable<Fraction> {

    val isInteger: Boolean get() = denominator == 1L

    operator fun plus(other: Fraction): Fraction {
        if (denominator == other.denominator) return of(addExact(numerator, other.numerator), denominator)
        val g = gcd(denominator, other.denominator)
        val left = mulExact(numerator, other.denominator / g)
        val right = mulExact(other.numerator, denominator / g)
        return of(addExact(left, right), mulExact(denominator / g, other.denominator))
    }

    operator fun minus(other: Fraction): Fraction = this + (-other)

    operator fun unaryMinus(): Fraction = Fraction(negateExact(numerator), denominator)

    operator fun times(other: Fraction): Fraction {
        // Cross-reduce first so intermediate products stay as small as possible.
        val g1 = gcd(numerator, other.denominator)
        val g2 = gcd(other.numerator, denominator)
        return of(
            mulExact(numerator / g1, other.numerator / g2),
            mulExact(denominator / g2, other.denominator / g1),
        )
    }

    operator fun div(other: Fraction): Fraction {
        if (other.numerator == 0L) throw ArithmeticException("Division by zero")
        return this * Fraction(other.denominator, other.numerator).normalized()
    }

    operator fun plus(other: Long): Fraction = this + of(other)
    operator fun minus(other: Long): Fraction = this - of(other)
    operator fun times(other: Long): Fraction = this * of(other)
    operator fun div(other: Long): Fraction = this / of(other)

    fun floor(): Long = numerator.floorDiv(denominator)

    fun ceil(): Long = negateExact(negateExact(numerator).floorDiv(denominator))

    fun signum(): Int = numerator.compareTo(0L)

    fun abs(): Fraction = if (numerator < 0) -this else this

    override fun compareTo(other: Fraction): Int = (this - other).signum()

    /** Integer value; throws if the fraction is not an integer. Use [floor] when rounding is intended. */
    fun toLongExact(): Long {
        if (!isInteger) throw ArithmeticException("$this is not an integer")
        return numerator
    }

    override fun equals(other: Any?): Boolean =
        other is Fraction && numerator == other.numerator && denominator == other.denominator

    override fun hashCode(): Int = 31 * numerator.hashCode() + denominator.hashCode()

    /** `7`, `-3/2`. [parse] reads this format back. */
    override fun toString(): String = if (isInteger) "$numerator" else "$numerator/$denominator"

    /** Exact decimal text (`1.5`, `-0.75`), or null when the decimal does not terminate (`1/3`). */
    fun toDecimalString(): String? {
        var rest = denominator
        var twos = 0
        var fives = 0
        while (rest % 2 == 0L) { rest /= 2; twos++ }
        while (rest % 5 == 0L) { rest /= 5; fives++ }
        if (rest != 1L) return null
        val scale = maxOf(twos, fives)
        if (scale == 0) return numerator.toString()
        var factor = 1L
        repeat(scale - twos) { factor = mulExact(factor, 2) }
        repeat(scale - fives) { factor = mulExact(factor, 5) }
        val digits = kotlin.math.abs(mulExact(numerator, factor)).toString().padStart(scale + 1, '0')
        val sign = if (numerator < 0) "-" else ""
        return "$sign${digits.dropLast(scale)}.${digits.takeLast(scale)}"
    }

    private fun normalized(): Fraction = of(numerator, denominator)

    companion object {
        val ZERO = Fraction(0, 1)
        val ONE = Fraction(1, 1)

        fun of(value: Long): Fraction = of(value, 1)

        fun of(value: Int): Fraction = of(value.toLong(), 1)

        fun of(numerator: Long, denominator: Long): Fraction {
            if (denominator == 0L) throw ArithmeticException("Zero denominator")
            // Long.MIN_VALUE has no positive counterpart, so it cannot be normalized safely.
            if (numerator == Long.MIN_VALUE || denominator == Long.MIN_VALUE) {
                throw ArithmeticException("Fraction out of 64-bit range")
            }
            if (numerator == 0L) return ZERO
            val g = gcd(numerator, denominator)
            val sign = if (denominator < 0) -1 else 1
            return Fraction(sign * numerator / g, sign * denominator / g)
        }

        /**
         * Parses an integer (`-12`), an exact decimal (`0.75`, as written in JSON) or a fraction (`3/2`).
         * Decimals are read digit by digit, never through floating point.
         */
        fun parse(text: String): Fraction {
            val s = text.trim()
            val slash = s.indexOf('/')
            if (slash >= 0) {
                return of(parseInteger(s.substring(0, slash), text), parseInteger(s.substring(slash + 1), text))
            }
            val dot = s.indexOf('.')
            if (dot < 0) return of(parseInteger(s, text))
            val digits = s.substring(dot + 1)
            if (digits.isEmpty() || !digits.all { it in '0'..'9' }) throw NumberFormatException("Not a number: '$text'")
            var scale = 1L
            repeat(digits.length) { scale = mulExact(scale, 10) }
            val intText = s.substring(0, dot)
            val negative = intText.startsWith('-')
            val intPart = if (intText == "-" || intText == "+" || intText.isEmpty()) 0L else parseInteger(intText, text)
            val magnitude = addExact(mulExact(kotlin.math.abs(intPart), scale), parseInteger(digits, text))
            return of(if (negative) -magnitude else magnitude, scale)
        }

        private fun parseInteger(s: String, original: String): Long =
            s.trim().toLongOrNull() ?: throw NumberFormatException("Not a number: '$original'")
    }
}

/**
 * JSON form: a JSON number when the decimal is exact (`7`, `1.5`), otherwise a string `"n/d"` (`"1/3"`).
 * Reads JSON numbers from their literal text, so `0.5` is exactly one half.
 */
object FractionSerializer : KSerializer<Fraction> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("dndtools.Fraction", PrimitiveKind.STRING)

    @OptIn(ExperimentalSerializationApi::class)
    override fun serialize(encoder: Encoder, value: Fraction) {
        val decimal = value.toDecimalString()
        if (encoder is JsonEncoder && decimal != null) {
            // Written as a raw literal: going through Double would lose exactness for long decimals.
            encoder.encodeJsonElement(JsonUnquotedLiteral(decimal))
        } else {
            encoder.encodeString(value.toString())
        }
    }

    override fun deserialize(decoder: Decoder): Fraction {
        val text = if (decoder is JsonDecoder) {
            val element = decoder.decodeJsonElement()
            if (element !is JsonPrimitive || element is JsonNull) {
                throw SerializationException("Expected a number, got $element")
            }
            element.content
        } else {
            decoder.decodeString()
        }
        return try {
            Fraction.parse(text)
        } catch (e: NumberFormatException) {
            throw SerializationException(e.message)
        }
    }
}

internal fun gcd(a: Long, b: Long): Long {
    var x = kotlin.math.abs(a)
    var y = kotlin.math.abs(b)
    while (y != 0L) {
        val t = x % y
        x = y
        y = t
    }
    return if (x == 0L) 1L else x
}

internal fun addExact(a: Long, b: Long): Long {
    val r = a + b
    if ((a xor r) and (b xor r) < 0) throw ArithmeticException("Long overflow: $a + $b")
    return r
}

internal fun mulExact(a: Long, b: Long): Long {
    if (a == 0L || b == 0L) return 0L
    val r = a * b
    if (r / b != a || (a == -1L && b == Long.MIN_VALUE) || (b == -1L && a == Long.MIN_VALUE)) {
        throw ArithmeticException("Long overflow: $a * $b")
    }
    return r
}

internal fun negateExact(a: Long): Long {
    if (a == Long.MIN_VALUE) throw ArithmeticException("Long overflow: -$a")
    return -a
}
