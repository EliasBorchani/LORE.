package dndtools.engine.api

import kotlin.test.Test
import kotlin.test.assertEquals

class InvokingTest {
    private val catalog = """
        {
          "version": "1",
          "bonusTypes": [{"id": "untyped", "stacks": true}],
          "statistics": [
            {"key": "save.will", "base": "0"}
          ],
          "entities": [
            {"id": "class.warlock", "type": "class", "name": {"en": "Warlock"}, "hitDie": 6, "invoking": {"ability": "cha"}},
            {"id": "class.fighter", "type": "class", "name": {"en": "Fighter"}, "hitDie": 10},
            {"id": "feat.extra_invocation", "type": "feat", "name": {"en": "Extra Invocation"},
             "prerequisite": "@invocations.count[lesser] >= 1",
             "effects": [{"target": "invocations.known.warlock", "op": "add", "value": 1}]},
            {"id": "invocation.dark_ones_own_luck", "type": "invocation", "name": {"en": "Dark One's Own Luck"},
             "invocation": {"grade": "least", "level": 2},
             "effects": [{"target": "save.will", "op": "add", "value": 2, "condition": "active('toggle.dark_ones_own_luck')"}]},
            {"id": "invocation.brimstone_blast", "type": "invocation", "name": {"en": "Brimstone Blast"},
             "invocation": {"grade": "lesser", "level": 3, "kind": "essence"}},
            {"id": "invocation.eldritch_doom", "type": "invocation", "name": {"en": "Eldritch Doom"},
             "invocation": {"grade": "dark", "level": 8, "kind": "blast_shape"}}
          ],
          "progressions": [
            {"classId": "class.warlock", "level": 1, "invocationsKnown": 1, "invocationGrade": "least"},
            {"classId": "class.warlock", "level": 2, "invocationsKnown": 2},
            {"classId": "class.warlock", "level": 6, "invocationsKnown": 4, "invocationGrade": "lesser"},
            {"classId": "class.warlock", "level": 20, "invocationsKnown": 12, "invocationGrade": "dark"}
          ],
          "relations": []
        }
    """.trimIndent()

    private val engine = SheetEngine(catalog)

    private fun warlock(levels: Int, known: List<String>, extra: String = "") = """
        {"id": "char.test", "name": "Test", "baseAbilities": {"cha": 16},
         "levels": [${(1..levels).joinToString(",") { """{"level": $it, "classId": "class.warlock", "classLevel": $it}""" }}],
         "invocations": {"class.warlock": {"known": [${known.joinToString(",") { "\"$it\"" }}]}}
         $extra}
    """.trimIndent()

    @Test
    fun countsAndGradeComeFromTheTableAndHoldPastTheLastRow() {
        val first = engine.open(warlock(1, emptyList())).invokers.single()
        assertEquals(listOf("1", "1", "least"), listOf(first.invokerLevel, first.invocationsKnown, first.maxGrade))
        val sixth = engine.open(warlock(6, emptyList())).invokers.single()
        assertEquals(listOf("4", "lesser"), listOf(sixth.invocationsKnown, sixth.maxGrade))
        val epic = engine.open(warlock(30, emptyList())).invokers.single()
        assertEquals(listOf("30", "12", "dark"), listOf(epic.invokerLevel, epic.invocationsKnown, epic.maxGrade))
    }

    @Test
    fun aGradeAboveTheClassAndTooManyInvocationsAreIssues() {
        val line = engine.open(warlock(1, listOf("invocation.dark_ones_own_luck", "invocation.brimstone_blast", "invocation.nope"))).invokers.single()
        assertEquals(
            listOf("invocation.brimstone_blast:grade", "invocation.nope:unknown", "null:too_many"),
            line.issues.map { "${it.entity}:${it.code}" },
        )
    }

    @Test
    fun knownInvocationsApplyTheirEffectsAndCountForPrerequisites() {
        val sheet = engine.open(warlock(6, listOf("invocation.dark_ones_own_luck", "invocation.brimstone_blast")))
        assertEquals(listOf("toggle.dark_ones_own_luck"), sheet.toggles.map { it.id }.filter { "luck" in it })
        sheet.setToggleChoice("""{"toggle": "toggle.dark_ones_own_luck"}""")
        assertEquals("2", sheet.statistic("save.will")?.text)
    }

    @Test
    fun anEffectAddsInvocationsKnown() {
        val withFeat = warlock(6, listOf("invocation.brimstone_blast")).replaceFirst(
            "\"classLevel\": 1}", "\"classLevel\": 1, \"feats\": [{\"id\": \"feat.extra_invocation\"}]}",
        )
        val sheet = engine.open(withFeat)
        assertEquals("5", sheet.invokers.single().invocationsKnown)
        // The feat needs a known lesser invocation: met here, not with only a least one.
        assertEquals(emptyList(), sheet.prerequisites.filter { it.entity == "feat.extra_invocation" })
        val least = engine.open(withFeat.replace("invocation.brimstone_blast", "invocation.dark_ones_own_luck"))
        assertEquals(1, least.prerequisites.count { it.entity == "feat.extra_invocation" })
    }
}
