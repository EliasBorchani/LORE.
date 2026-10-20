package dndtools.golden

import dndtools.engine.Engine
import dndtools.engine.formula.Value
import dndtools.engine.json.EngineJson
import dndtools.engine.math.Fraction
import dndtools.engine.model.ModelCheck
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.time.Duration
import kotlin.time.TimeSource

/** The reference cases (`test-references/`), checked the same way on JVM, JS and iOS. */
class GoldenTest {
    private val danalieth = GoldenCases.all.single { it.name == "danalieth" }

    @Test
    fun everyCasePasses() {
        for (case in GoldenCases.all) {
            val report = GoldenRunner.run(case)
            println("== ${report.case} at level ${report.atLevel}")
            for (check in report.checks) {
                val mark = when {
                    check.passed -> "ok  "
                    check.status == ExpectedValue.Status.VERIFIED -> "FAIL"
                    else -> "pend"
                }
                println("$mark ${check.stat}: expected ${check.expected}, got ${check.actual}")
            }
            report.issues.forEach { println("issue ${it.code} ${it.statistic ?: ""} ${it.source ?: ""}: ${it.message}") }
            assertEquals(emptyList(), report.failures, "${case.name}: verified values that do not match")
        }
    }

    /**
     * The move of team content into a ruleset (`server migrate-groups`) prefixes its ids with the ruleset's slug. The
     * same sheet must come out: this renames every team id the way the server does (same id pattern) and checks the
     * verified values again.
     */
    @Test
    fun danaliethWithRulesetIdsGivesTheSameValues() {
        val catalog = EngineJson.decodeCatalog(danalieth.catalog)
        val team = catalog.entities.filter { it.provenance == "team" }.map { it.id }.toSet()
        val id = Regex("""\b(?:[a-z][a-z0-9_]*:)?[a-z][a-z0-9_]*\.[a-z0-9_]+\b""")
        fun rename(text: String) = id.replace(text) { if (it.value in team) "table:${it.value}" else it.value }
        val renamed = GoldenCase(
            "danalieth-ruleset",
            rename(danalieth.catalog),
            rename(danalieth.character),
            rename(danalieth.expected),
        )
        assertTrue(rename(danalieth.character) != danalieth.character, "the character names team content")

        val before = GoldenRunner.run(danalieth)
        val after = GoldenRunner.run(renamed)
        assertEquals(emptyList(), after.failures)
        assertEquals(before.checks.map { it.actual }, after.checks.map { it.actual })
    }

    @Test
    fun danaliethIsFastEnough() {
        val catalog = EngineJson.decodeCatalog(danalieth.catalog)
        val character = EngineJson.decodeCharacter(danalieth.character)
        val engine = Engine(catalog)
        repeat(5) { engine.compute(character, 59) }
        var best = Duration.INFINITE
        repeat(20) {
            val mark = TimeSource.Monotonic.markNow()
            engine.compute(character, 59)
            best = minOf(best, mark.elapsedNow())
        }
        val start = TimeSource.Monotonic.markNow()
        Engine(catalog).compute(character, 59)
        val cold = start.elapsedNow()
        println("Danalieth full compute: best $best, with catalog compilation $cold")
        // Spike target: under 100 ms on a mid-range phone and in the browser. Here it guards against regressions.
        assertTrue(best.inWholeMilliseconds < 100, "best $best")
    }

    @Test
    fun danaliethKnownDataIssues() {
        val catalog = EngineJson.decodeCatalog(danalieth.catalog)
        val character = EngineJson.decodeCharacter(danalieth.character)
        // Known gaps in batch-1-v5, to be fixed in the content, not worked around in the engine.
        assertEquals(
            listOf(
                "duplicate_id rules: 'rule.hit_points' is defined more than once",
                "duplicate_id rules: 'rule.experience' is defined more than once",
            ),
            (ModelCheck.catalog(catalog) + ModelCheck.character(character, catalog))
                .map { "${it.code.name.lowercase()} ${it.at}: ${it.message}" },
        )
    }

    @Test
    fun danaliethStrengthBreakdown() {
        val catalog = EngineJson.decodeCatalog(danalieth.catalog)
        val session = Engine(catalog).session(EngineJson.decodeCharacter(danalieth.character), 59)
        val lines = session.explain("ability.str.score")!!.lines
        val bull = lines.single { it.source == "spell.bulls_strength" }
        assertEquals(Value.Num(Fraction.of(16)), bull.value)
        assertEquals(listOf("feat.superspell"), bull.modifiers)
        val divinePower = lines.single { it.source == "spell.divine_power" }
        assertEquals("spell.bulls_strength", divinePower.suppressedBy)
    }
}
