package dndtools.engine.api

import kotlin.test.Test
import kotlin.test.assertEquals

class SheetEngineTest {
    private val catalog = """
        {
          "version": "1",
          "bonusTypes": [{"id": "untyped", "stacks": true}],
          "statistics": [{"key": "bab", "base": "level()"}, {"key": "attack.melee", "base": "@bab"}],
          "entities": [
            {"id": "class.fighter", "type": "class", "name": {"en": "Fighter"}, "hitDie": 10},
            {"id": "feat.power_attack", "type": "feat", "name": {"en": "Power Attack"},
             "prerequisite": "@bab >= 1 and has('feat.cleave')",
             "effects": [{"target": "attack.melee", "op": "add", "value": "-@toggle.power_attack.value",
                          "condition": "active('toggle.power_attack')"}]},
            {"id": "power.ward", "type": "class_power", "name": {"en": "Ward"},
             "usesPerDay": "floor((level('class.fighter') + 1) / 2)"},
            {"id": "power.doom", "type": "class_power", "name": {"en": "Doom"}, "usesPerDay": 1},
            {"id": "spell.bless", "type": "spell", "name": {"en": "Bless"},
             "effects": [{"target": "attack.melee", "op": "add", "value": 1, "bonusType": "untyped",
                          "condition": "active('toggle.bless')"}]}
          ],
          "relations": [{"from": "class.fighter", "relation": "grants", "to": "power.ward"}]
        }
    """.trimIndent()

    private fun character(toggles: String = "[]") = """
        {"id": "char.test", "name": "Test", "baseAbilities": {"str": 10},
         "levels": [
           {"level": 1, "classId": "class.fighter", "classLevel": 1, "feats": [{"id": "feat.power_attack"}]},
           {"level": 2, "classId": "class.fighter", "classLevel": 2},
           {"level": 3, "classId": "class.fighter", "classLevel": 3}
         ],
         "activeToggles": $toggles}
    """.trimIndent()

    private val engine = SheetEngine(catalog)

    @Test
    fun togglesIncludeTheOnesTheCharactersEntitiesRead() {
        val sheet = engine.open(character("""[{"toggle": "toggle.bless", "spell": "spell.bless"}]"""))
        assertEquals(
            listOf(
                ToggleLine("toggle.bless", active = true, value = null, source = "spell.bless"),
                ToggleLine("toggle.power_attack", active = false, value = null, source = "feat.power_attack"),
            ),
            sheet.toggles,
        )
    }

    @Test
    fun aToggleDescribedInFullCanBeSwitchedOn() {
        val sheet = engine.open(character())
        assertEquals("3", sheet.statistic("attack.melee")?.text)

        sheet.setToggleChoice("""{"toggle": "toggle.bless", "spell": "spell.bless"}""")
        assertEquals("4", sheet.statistic("attack.melee")?.text)

        sheet.setToggleChoice("""{"toggle": "toggle.power_attack", "value": "2"}""")
        assertEquals("2", sheet.statistic("attack.melee")?.text)
        assertEquals(ToggleLine("toggle.power_attack", true, "2", "feat.power_attack"), sheet.toggles.last())

        sheet.setToggle("toggle.bless", false)
        assertEquals("1", sheet.statistic("attack.melee")?.text)
    }

    @Test
    fun dailyUsesAreComputedForWhatTheCharacterHas() {
        val sheet = engine.open(character())
        // power.ward comes from the class; power.doom is not the character's.
        assertEquals(listOf(DailyUse("power.ward", "2")), sheet.dailyUses)
        assertEquals(listOf(DailyUse("power.ward", "1")), engine.open(character(), atLevel = 1).dailyUses)
    }

    @Test
    fun failedPrerequisitesNameTheirParts() {
        val sheet = engine.open(character())
        assertEquals(listOf(PrerequisiteLine("feat.power_attack", listOf("has('feat.cleave')"), emptyList())), sheet.prerequisites)
    }
}
