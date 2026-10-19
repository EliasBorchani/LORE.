package dndtools.engine.api

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ContentCheckTest {
    private val core = """{"version": "test", "bonusTypes": [{"id": "morale", "stacks": false}]}"""

    private fun check(entity: String) = ContentCheck.entity(entity, core).map { "${it.code} ${it.at}" }

    @Test
    fun aGoodEntityHasNoIssue() {
        val feat = """
            {"id": "feat.brave", "type": "feat", "name": {"fr": "Brave"}, "provenance": "team", "note": "for review",
             "prerequisite": "@bab >= 1",
             "effects": [{"target": "save.will", "op": "add", "value": 2, "bonusType": "morale"}]}
        """
        assertEquals(emptyList(), check(feat))
    }

    @Test
    fun anUnknownFieldStopsTheCheck() {
        val issues = ContentCheck.entity("""{"id": "feat.x", "type": "feat", "name": {}, "colour": "red"}""", core)
        assertEquals(1, issues.size)
        assertEquals(ContentCheck.FORMAT, issues[0].code)
        assertTrue("colour" in issues[0].message, issues[0].message)
        assertEquals(listOf("format "), check("{not json"))
    }

    @Test
    fun formulasBonusTypesAndLayersAreChecked() {
        val feat = """
            {"id": "feat.x", "type": "feat", "name": {"fr": "X"}, "prerequisite": "@bab >=",
             "effects": [
               {"target": "save.will", "op": "add", "value": "1 +", "bonusType": "luck"},
               {"target": "size", "op": "set", "value": "'large'"},
               {"target": "attack.melee", "op": "multiply", "value": 2}
             ]}
        """
        assertEquals(
            listOf(
                "invalid_formula prerequisite",
                "invalid_formula effects[0].value",
                "unknown_bonus_type effects[0]",
                "missing_layer effects[1]",
                "missing_mult_mode effects[2]",
            ),
            check(feat),
        )
    }
}
