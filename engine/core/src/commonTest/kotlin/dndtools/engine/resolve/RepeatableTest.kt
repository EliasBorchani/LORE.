package dndtools.engine.resolve

import dndtools.engine.Engine
import dndtools.engine.formula.Value
import dndtools.engine.json.EngineJson
import dndtools.engine.math.Fraction
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** A repeatable feat applies its effects once per take, each take with its own choice. */
class RepeatableTest {
    private val catalog = EngineJson.decodeCatalog(
        """
        {
          "version": "test",
          "bonusTypes": [{"id": "enhancement", "stacks": false}, {"id": "untyped", "stacks": true}],
          "statistics": [{"key": "skill.climb"}, {"key": "skill.swim"}, {"key": "hp.max"}, {"key": "save.will"}],
          "entities": [
            {"id": "class.fighter", "type": "class", "hitDie": 10, "name": {"en": "Fighter"}},
            {"id": "feat.skill_focus", "type": "feat", "name": {"en": "Skill Focus"}, "repeatable": {"choose": "skill"},
             "effects": [{"target": "{choice}", "op": "add", "value": 3, "bonusType": "untyped"}]},
            {"id": "feat.toughness", "type": "feat", "name": {"en": "Toughness"}, "repeatable": {},
             "effects": [{"target": "hp.max", "op": "add", "value": 3, "bonusType": "untyped"},
                         {"target": "save.will", "op": "add", "value": 2, "bonusType": "enhancement"}]}
          ]
        }
        """.trimIndent()
    )

    private fun character(vararg feats: String) = EngineJson.decodeCharacter(
        """
        {
          "id": "char.test", "name": "Test",
          "baseAbilities": {"str": 10, "dex": 10, "con": 10, "int": 10, "wis": 10, "cha": 10},
          "levels": [${feats.withIndex().joinToString(",") { (i, f) ->
            """{"level": ${i + 1}, "classId": "class.fighter", "classLevel": ${i + 1}, "feats": [$f]}"""
        }}]
        }
        """.trimIndent()
    )

    private fun num(n: Long): Value = Value.Num(Fraction.of(n, 1))

    @Test
    fun eachTakeAppliesItsOwnChoice() {
        val sheet = Engine(catalog).compute(
            character(
                """{"id": "feat.skill_focus", "choice": "skill.climb"}""",
                """{"id": "feat.skill_focus", "choice": "skill.swim"}""",
            )
        )
        assertEquals(num(3), sheet.values["skill.climb"])
        assertEquals(num(3), sheet.values["skill.swim"])
    }

    @Test
    fun takesAddUpAndTypedBonusesStillDoNotStack() {
        val sheet = Engine(catalog).compute(character("""{"id": "feat.toughness"}""", """{"id": "feat.toughness"}""", """{"id": "feat.toughness"}"""))
        assertEquals(num(9), sheet.values["hp.max"], "untyped: 3 per take")
        assertEquals(num(2), sheet.values["save.will"], "enhancement: the highest only")
    }

    @Test
    fun aTakeWithoutChoiceIsAnIssue() {
        val sheet = Engine(catalog).compute(character("""{"id": "feat.skill_focus"}"""))
        assertEquals(num(0), sheet.values["skill.climb"])
        assertTrue(sheet.issues.any { "needs a choice" in it.message })
    }
}
