package dndtools.engine.api

import kotlin.test.Test
import kotlin.test.assertEquals

class FeatSlotsTest {
    private val catalog = """
        {
          "version": "test",
          "bonusTypes": [{"id": "untyped", "stacks": true}],
          "statistics": [
            {"key": "feat_slots.general", "base": "1 + floor(min(level(), 20) / 3)"},
            {"key": "feat_slots.epic", "base": "max(0, floor(level() / 3) - 6)"}
          ],
          "entities": [
            {"id": "class.fighter", "type": "class", "hitDie": 10, "name": {"en": "Fighter"},
             "effects": [{"target": "feat_slots.epic_bonus", "op": "add", "value": "max(0, floor((level('class.fighter') - 20) / 2))", "bonusType": "untyped"}]},
            {"id": "feat.a", "type": "feat", "name": {"en": "A"}},
            {"id": "feat.b", "type": "feat", "name": {"en": "B"}}
          ]
        }
    """.trimIndent()

    private fun sheet(levels: Int, atLevel: Int = 0): CharacterSheet {
        val records = (1..levels).joinToString(",") { level ->
            val feats = when (level) {
                1 -> """[{"id": "feat.a"}]"""
                21 -> """[{"id": "feat.b", "slot": "epic"}]"""
                else -> "[]"
            }
            """{"level": $level, "classId": "class.fighter", "classLevel": $level, "feats": $feats}"""
        }
        val character = """{"id": "c", "name": "C", "baseAbilities": {"str": 10}, "levels": [$records]}"""
        return SheetEngine(catalog).open(character, atLevel)
    }

    private fun CharacterSheet.slots() = featSlots.associate { it.slot to (it.available to it.used) }

    @Test
    fun slotsCountWhatTheSheetGivesAndWhatTheLevelsUse() {
        // Level 24: general feats at 1, 3… 18 (7), epic at 21 and 24 (2), Fighter epic bonus at 22 and 24 (2).
        assertEquals(
            mapOf("epic" to ("2" to 1), "epic_bonus" to ("2" to 0), "general" to ("7" to 1)),
            sheet(24).slots(),
        )
    }

    @Test
    fun aSheetAtAnEarlierLevelCountsOnlyThoseLevels() {
        assertEquals(mapOf("epic" to ("0" to 0), "epic_bonus" to ("0" to 0), "general" to ("2" to 1)), sheet(24, atLevel = 3).slots())
    }
}
