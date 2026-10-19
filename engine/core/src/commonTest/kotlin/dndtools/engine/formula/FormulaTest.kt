package dndtools.engine.formula

import dndtools.engine.math.Fraction
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.test.fail

private class MapEnv(
    val stats: Map<String, Value> = emptyMap(),
    val characterLevel: Long = 0,
    val classLevels: Map<String, Long> = emptyMap(),
    val entities: Set<String> = emptySet(),
    val toggles: Set<String> = emptySet(),
) : FormulaEnv {
    override fun stat(key: String) = stats[key]
    override fun level(classId: String?) = if (classId == null) characterLevel else classLevels[classId] ?: 0
    override fun has(entityId: String) = entityId in entities
    override fun active(toggleId: String) = toggleId in toggles
}

private fun num(n: Long, d: Long = 1): Value = Value.Num(Fraction.of(n, d))

class FormulaTest {
    private val danalieth = MapEnv(
        stats = mapOf(
            "caster_level" to num(60),
            "ability.int.mod" to num(27),
            "hp.max" to num(2480),
            "toggle.power_attack.value" to num(10),
            "dc.school[abjuration]" to num(2),
            "spell.range" to Value.Text("touch"),
        ),
        characterLevel = 59,
        classLevels = mapOf("class.ultimate_magus" to 20, "class.vt_will_of_death" to 3),
        entities = setOf("feat.power_attack"),
        toggles = setOf("toggle.power_attack"),
    )

    private fun parse(source: String): Formula = when (val r = Formula.parse(source)) {
        is ParseResult.Ok -> r.formula
        is ParseResult.Error -> fail("'$source' should parse: ${r.message} at ${r.position}")
    }

    private fun eval(source: String, env: FormulaEnv = danalieth): Value =
        when (val r = parse(source).evaluate(env)) {
            is EvalResult.Ok -> r.value
            is EvalResult.Error -> fail("'$source' should evaluate: ${r.message} at ${r.position}")
        }

    private fun parseError(source: String): ParseResult.Error =
        Formula.parse(source) as? ParseResult.Error ?: fail("'$source' should not parse")

    private fun evalError(source: String, env: FormulaEnv = danalieth): EvalResult.Error =
        parse(source).evaluate(env) as? EvalResult.Error ?: fail("'$source' should fail to evaluate")

    private fun dice(source: String): DiceValue = (eval(source) as? Value.Dice)?.value ?: fail("'$source' is not dice")

    @Test
    fun arithmeticAndPrecedence() {
        assertEquals(num(14), eval("2 + 3 * 4"))
        assertEquals(num(20), eval("(2 + 3) * 4"))
        assertEquals(num(-1), eval("2 - 3"))
        assertEquals(num(7, 2), eval("7 / 2"), "division keeps the fraction")
        assertEquals(num(1), eval("1 - 2 - -2"), "left-associative, unary minus")
        assertEquals(num(6), eval("3 × 2"), "the × sign is multiplication")
        assertEquals(num(3, 4), eval("0.75"))
    }

    @Test
    fun roundingOnlyWhereWritten() {
        assertEquals(num(3), eval("floor(7 / 2)"))
        assertEquals(num(4), eval("ceil(7 / 2)"))
        assertEquals(num(-4), eval("floor(-7 / 2)"))
        assertEquals(num(29), eval("floor(0.75 * 39)"))
    }

    @Test
    fun statisticsAndFamilies() {
        assertEquals(num(-10), eval("-@toggle.power_attack.value"))
        assertEquals(num(20), eval("@toggle.power_attack.value * 2"))
        assertEquals(num(3), eval("@dc.school[abjuration] + 1"))
        assertEquals("Unknown statistic '@ability.str.mod'", evalError("@ability.str.mod + 1").message)
    }

    @Test
    fun testsAndChoices() {
        assertEquals(Value.Bool(true), eval("has('feat.power_attack') and active('toggle.power_attack')"))
        assertEquals(Value.Bool(true), eval("not has('feat.cleave')"))
        assertEquals(Value.Bool(true), eval("@spell.range == 'touch'"))
        assertEquals(Value.Bool(true), eval("level() > 20 or 1 / 0 > 0"), "or stops at the first true")
        assertEquals(num(1), eval("if(true, 1, 1 / 0)"), "only the chosen branch runs")
        assertEquals(num(6), eval("max(min(floor(@caster_level / 3), 6), 1)"))
        assertEquals(num(5), eval("min(9, 5, 7)"))
    }

    @Test
    fun danaliethFormulas() {
        // Divine Power, house rule: 20 + floor(0.75 x 39) at level 59.
        assertEquals(num(49), eval("if(level() <= 20, level(), 20 + floor(0.75 * (level() - 20)))"))
        // Ultimate Magus arcane spell power at class level 20.
        assertEquals(
            num(8),
            eval(
                "if(level('class.ultimate_magus') >= 20, 8, if(level('class.ultimate_magus') >= 18, 7, " +
                    "if(level('class.ultimate_magus') >= 15, 6, 1)))"
            ),
        )
        // Regeneration, a percentage of a statistic, with no Grip of Death levels.
        assertEquals(
            num(124),
            eval("floor(@hp.max * if(level('class.vt_grip_of_death') >= 8, 15, if(level('class.vt_grip_of_death') >= 5, 10, 5)) / 100)"),
        )
    }

    @Test
    fun diceAreDescribedNotRolled() {
        assertEquals("20d6 electricity (~70)", dice("(floor(@caster_level / 3))d6 electricity").describe())
        assertEquals("3 × 20d6 electricity (~210)", dice("3 × 20d6 electricity").describe())
        assertEquals("15 × 8d6 (~420)", dice("15 × 8d6").describe())
        assertEquals("5d6 + 12 (~29)", dice("3d6 + 2d6 + 12").describe())
        assertEquals("3d6 + 138 (~148)", dice("3d6 + 138").describe(), "average 148.5 shown rounded down")
        assertEquals("2d6 fire + 1d6 (~10)", dice("2d6 fire + 1d6").describe(), "different types do not merge")
        // Superspell on the Meteorite: ×4, then Primum incantatum ×3.
        assertEquals(Fraction.of(5040), dice("15 × 8d6 * 4 * 3").average)
    }

    @Test
    fun multiTypeDiceSplitTheirAverage() {
        val meteorite = dice("15 × 8d6 bludgeoning_fire + 3d6 fire + 2")
        assertEquals("15 × 8d6 bludgeoning_fire + 3d6 fire + 2 (~432)", meteorite.describe())
        assertEquals(
            mapOf("bludgeoning" to Fraction.of(210), "fire" to Fraction.of(441, 2), null to Fraction.of(2)),
            meteorite.averageByType(mapOf("bludgeoning_fire" to listOf("bludgeoning", "fire"))),
        )
        assertEquals(setOf("bludgeoning_fire", "fire"), parse("15 × 8d6 bludgeoning_fire + 3d6 fire").diceTypes)
    }

    @Test
    fun diceMistakesAreReported() {
        assertEquals("Dice count must be a whole number, got 20/3 (use floor)", evalError("(@caster_level / 9)d6").message)
        assertEquals("Dice cannot be divided", evalError("3d6 / 2").message)
        assertEquals("Cannot negate dice", evalError("-3d6").message)
        assertEquals("Cannot compute dice * dice", evalError("3d6 * 2d6").message)
    }

    @Test
    fun typeMistakesAreReported() {
        assertEquals("Cannot compare text with a number", evalError("@spell.range == 3").message)
        assertEquals("Expected a test (true or false), got a number", evalError("if(1, 2, 3)").message)
        assertEquals("Cannot compute a test + a number", evalError("true + 1").message)
        assertEquals("Division by zero", evalError("1 / (2 - 2)").message)
    }

    @Test
    fun parseErrorsPointAtTheProblem() {
        assertEquals(ParseResult.Error("Expected a value, found the end of the formula", 3), parseError("1 +"))
        assertEquals(ParseResult.Error("Unknown function 'sqrt'", 0), parseError("sqrt(4)"))
        assertEquals(
            ParseResult.Error("Unknown name 'spell.range' (statistics start with '@', text goes in quotes)", 0),
            parseError("spell.range == 'touch'"),
        )
        assertEquals(
            ParseResult.Error("'level' takes an id in quotes, e.g. level('feat.x')", 6),
            parseError("level(3)"),
        )
        assertEquals(ParseResult.Error("'if' takes 3 argument(s), got 2", 0), parseError("if(true, 1)"))
        assertEquals(ParseResult.Error("Unexpected 'm' after the end of the formula", 4), parseError("180 m"))
        assertEquals(ParseResult.Error("Chained comparisons are ambiguous; use 'and'", 6), parseError("1 < 2 < 3"))
        assertEquals(ParseResult.Error("Use '==' to compare", 2), parseError("1 = 1"))
        assertEquals(ParseResult.Error("Unclosed string", 4), parseError("has('feat.x)"))
        assertEquals(ParseResult.Error("Number out of range: 99999999999999999999", 0), parseError("99999999999999999999"))
    }

    @Test
    fun isqrtInvertsTheXpFormula() {
        assertEquals(num(117), eval("isqrt(13747)"))
        assertEquals(num(0), eval("isqrt(0)"))
        assertEquals(num(3037000499), eval("isqrt(9223372036854775807)"))
        // 1 718 250 XP is level 59 (level 60 needs 1 770 000).
        val env = MapEnv(stats = mapOf("xp" to num(1718250)))
        assertEquals(num(59), eval("floor((1 + isqrt(1 + 8 * @xp / 1000)) / 2)", env))
        val justBelow60 = MapEnv(stats = mapOf("xp" to num(1769999)))
        assertEquals(num(59), eval("floor((1 + isqrt(1 + 8 * @xp / 1000)) / 2)", justBelow60))
        val exactly60 = MapEnv(stats = mapOf("xp" to num(1770000)))
        assertEquals(num(60), eval("floor((1 + isqrt(1 + 8 * @xp / 1000)) / 2)", exactly60))
    }

    @Test
    fun formulasPrintBackAsText() {
        for (source in listOf(
            "@ability.str.score >= 13",
            "has('feat.x') and (level() > 20 or not active('toggle.y'))",
            "1 - (2 - 3)",
            "(1 + 2) * -@x",
            "(floor(@caster_level / 3))d6 fire",
            "0.75 * level()",
        )) {
            assertEquals(source, parse(source).expr.toSource())
        }
    }

    @Test
    fun referencesFeedTheDependencyGraph() {
        val f = parse("if(has('feat.power_attack') and active('toggle.power_attack'), @ability.str.mod * level('class.warblade'), level())")
        assertEquals(setOf("ability.str.mod"), f.statRefs)
        assertEquals(setOf("feat.power_attack", "class.warblade"), f.entityRefs)
        assertEquals(setOf("toggle.power_attack"), f.toggleRefs)
        assertTrue(f.usesCharacterLevel)
        assertFalse(parse("1 + 1").usesCharacterLevel)
    }
}
