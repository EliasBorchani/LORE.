package dndtools.engine.math

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class FractionTest {
    private fun f(n: Long, d: Long = 1) = Fraction.of(n, d)

    @Test
    fun normalizesSignAndReduces() {
        assertEquals(f(1, 2), f(2, 4))
        assertEquals(f(-1, 2), f(1, -2))
        assertEquals("-1/2", f(3, -6).toString())
        assertEquals(Fraction.ZERO, f(0, -7))
    }

    @Test
    fun arithmetic() {
        assertEquals(f(5, 6), f(1, 2) + f(1, 3))
        assertEquals(f(1, 6), f(1, 2) - f(1, 3))
        assertEquals(f(75), f(3, 2) * f(50))
        assertEquals(f(3, 2), f(3) / f(2))
        assertEquals(f(-3), -f(3))
    }

    @Test
    fun floorAndCeilRoundTowardTheRightSide() {
        assertEquals(39, f(79, 2).floor())
        assertEquals(40, f(79, 2).ceil())
        assertEquals(-2, f(-3, 2).floor())
        assertEquals(-1, f(-3, 2).ceil())
        assertEquals(4, f(4).floor())
        assertEquals(4, f(4).ceil())
    }

    @Test
    fun parsesDecimalsExactly() {
        assertEquals(f(1, 2), Fraction.parse("0.5"))
        assertEquals(f(3, 4), Fraction.parse("0.75"))
        assertEquals(f(7, 2), Fraction.parse("3.5"))
        assertEquals(f(-1, 2), Fraction.parse("-0.5"))
        assertEquals(f(1, 10), Fraction.parse("0.1"))
        assertEquals(f(-12), Fraction.parse("-12"))
        assertEquals(f(3, 2), Fraction.parse("3/2"))
        assertFailsWith<NumberFormatException> { Fraction.parse("1e3") }
        assertFailsWith<NumberFormatException> { Fraction.parse("abc") }
        assertFailsWith<NumberFormatException> { Fraction.parse("1.") }
    }

    @Test
    fun tenthsAddUpExactly() {
        // 0.1 summed ten times is exactly 1, which floating point does not give.
        var sum = Fraction.ZERO
        repeat(10) { sum += Fraction.parse("0.1") }
        assertEquals(Fraction.ONE, sum)
    }

    @Test
    fun overflowThrowsInsteadOfWrapping() {
        val big = f(Long.MAX_VALUE)
        assertFailsWith<ArithmeticException> { big + Fraction.ONE }
        assertFailsWith<ArithmeticException> { big * f(2) }
        assertFailsWith<ArithmeticException> { f(1, Long.MAX_VALUE) + f(1, Long.MAX_VALUE - 1) }
        assertFailsWith<ArithmeticException> { Fraction.ONE / Fraction.ZERO }
        assertFailsWith<ArithmeticException> { f(Long.MIN_VALUE) }
    }

    @Test
    fun compares() {
        assertTrue(f(1, 3) < f(1, 2))
        assertTrue(f(-1, 2) < Fraction.ZERO)
        assertEquals(f(3, 2), listOf(f(1), f(3, 2), f(-4)).max())
    }

    @Test
    fun houseRuleExamplesFromDanalieth() {
        // Base attack: Warblade 20, then +1/2 for each of the 39 epic levels, rounded once.
        var bab = f(20)
        repeat(39) { bab += f(1, 2) }
        assertEquals(f(79, 2), bab)
        assertEquals(39, bab.floor())

        // Divine Power: 20 + floor(0.75 x 39) = 49.
        assertEquals(49, 20 + (Fraction.parse("0.75") * f(39)).floor())

        // Two-handed Strength: 50 x 1.5 = 75, no rounding needed.
        assertEquals(f(75), f(50) * Fraction.parse("1.5"))
    }
}
