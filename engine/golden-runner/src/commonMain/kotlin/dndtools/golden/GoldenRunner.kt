package dndtools.golden

import dndtools.engine.Engine
import dndtools.engine.formula.DiceValue
import dndtools.engine.formula.Value
import dndtools.engine.json.EngineJson
import dndtools.engine.math.Fraction
import dndtools.engine.resolve.PrerequisiteResult
import dndtools.engine.resolve.SheetIssue
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** One test case: the three files of a `test-references/<name>/` folder, as text. */
class GoldenCase(val name: String, val catalog: String, val character: String, val expected: String)

/** `expected.json`. Decoded strictly: a typo in an expected file must fail, not be skipped. */
@Serializable
data class ExpectedSheet(
    val character: String,
    val atLevel: Int,
    val note: String? = null,
    val values: List<ExpectedValue>,
    /** When present, exactly these prerequisites fail, with these parts. Parts that cannot be checked are ignored. */
    val prerequisites: List<ExpectedPrerequisite>? = null,
    /** Issues the engine must report (each one at least once). Other issues are allowed. */
    val issues: List<ExpectedIssue> = emptyList(),
)

@Serializable
data class ExpectedPrerequisite(val entity: String, val failed: List<String>)

/** Matched on [code], and on [statistic] and [source] when given. */
@Serializable
data class ExpectedIssue(val code: String, val statistic: String? = null, val source: String? = null)

@Serializable
data class ExpectedValue(
    val stat: String,
    val status: Status,
    val value: Fraction? = null,
    /** For a dice statistic: the dice (`3d6`), the flat part and the average rounded down. */
    val dice: String? = null,
    val flat: Fraction? = null,
    val averageFloor: Long? = null,
    /** The statistic must have no value (it is in a cycle, or its formula fails). */
    val noValue: Boolean = false,
    val how: String? = null,
) {
    @Serializable
    enum class Status {
        /** Re-derived by hand: a mismatch fails the test. */
        @SerialName("verified") VERIFIED,

        /** Reported, never fails: the engine needs data not in the catalog yet. */
        @SerialName("pending") PENDING,
    }
}

@Serializable
data class GoldenCheck(
    val stat: String,
    val status: ExpectedValue.Status,
    val expected: String,
    val actual: String,
    val passed: Boolean,
)

@Serializable
data class GoldenReport(
    val case: String,
    val atLevel: Int,
    val checks: List<GoldenCheck>,
    val issues: List<SheetIssue>,
    val prerequisites: List<PrerequisiteResult>,
) {
    /** Verified values that do not match. Empty means the case passes. */
    val failures: List<GoldenCheck> get() = checks.filter { it.status == ExpectedValue.Status.VERIFIED && !it.passed }
}

/** Computes each case's sheet and compares it with the expected values (`test-references/README.md`). */
object GoldenRunner {
    private val json = Json

    fun run(case: GoldenCase): GoldenReport {
        val catalog = EngineJson.decodeCatalog(case.catalog)
        val character = EngineJson.decodeCharacter(case.character)
        val expected = json.decodeFromString(ExpectedSheet.serializer(), case.expected)
        require(expected.character == character.id) {
            "${case.name}: expected.json is for ${expected.character}, character.json is ${character.id}"
        }
        val sheet = Engine(catalog).compute(character, expected.atLevel)
        val checks = ArrayList<GoldenCheck>()
        for (e in expected.values) {
            val want = describe(e)
            val got = describe(sheet.values[e.stat], dice = e.dice != null)
            checks += GoldenCheck(e.stat, e.status, want, got, want == got)
        }
        expected.prerequisites?.let { prerequisites ->
            val want = prerequisites.sortedBy { it.entity }.joinToString("; ") { "${it.entity}: ${it.failed}" }
            val got = sheet.prerequisites.filter { it.failed.isNotEmpty() }.sortedBy { it.entity }
                .joinToString("; ") { "${it.entity}: ${it.failed}" }
            checks += GoldenCheck("prerequisites", ExpectedValue.Status.VERIFIED, want, got, want == got)
        }
        for (issue in expected.issues) {
            val found = sheet.issues.any {
                it.code.name.lowercase() == issue.code &&
                    (issue.statistic == null || it.statistic == issue.statistic) &&
                    (issue.source == null || it.source == issue.source)
            }
            val label = listOfNotNull(issue.code, issue.statistic, issue.source).joinToString(" ")
            checks += GoldenCheck("issue", ExpectedValue.Status.VERIFIED, label, if (found) label else "(not reported)", found)
        }
        return GoldenReport(case.name, expected.atLevel, checks, sheet.issues, sheet.prerequisites)
    }

    /** Both sides in one text form, so a mismatch reads well in a test report. */
    private fun describe(e: ExpectedValue): String = when {
        e.noValue -> "(no value)"
        e.dice != null -> diceText(e.dice, e.flat ?: Fraction.ZERO, e.averageFloor)
        else -> "${e.value}"
    }

    private fun describe(v: Value?, dice: Boolean): String = when (v) {
        null -> "(no value)"
        is Value.Num -> if (dice) diceText("", v.value, v.value.floor()) else "${v.value}"
        is Value.Dice -> diceText(diceOnly(v.value), v.value.flat, v.value.average.floor())
        is Value.Bool -> "${v.value}"
        is Value.Text -> "'${v.value}'"
    }

    private fun diceOnly(d: DiceValue) = d.terms.joinToString(" + ") { it.describe() }

    private fun diceText(dice: String, flat: Fraction, averageFloor: Long?) =
        "dice=$dice flat=$flat averageFloor=$averageFloor"
}
