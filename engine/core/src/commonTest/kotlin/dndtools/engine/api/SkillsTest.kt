package dndtools.engine.api

import kotlin.test.Test
import kotlin.test.assertEquals

class SkillsTest {
    private val catalog = """
        {
          "version": "test",
          "bonusTypes": [{"id": "untyped", "stacks": true}, {"id": "circumstance", "stacks": false}],
          "statistics": [
            {"key": "ability.dex.score", "base": "@ability.dex.base"},
            {"key": "ability.dex.mod", "base": "floor((@ability.dex.score - 10) / 2)"},
            {"key": "ability.int.score", "base": "@ability.int.base"},
            {"key": "ability.int.mod", "base": "floor((@ability.int.score - 10) / 2)"},
            {"key": "ability.str.score", "base": "@ability.str.base"},
            {"key": "ability.str.mod", "base": "floor((@ability.str.score - 10) / 2)"}
          ],
          "entities": [
            {"id": "class.rogue", "type": "class", "hitDie": 6, "skillPoints": 8, "name": {"en": "Rogue"}},
            {"id": "class.fighter", "type": "class", "hitDie": 10, "skillPoints": 2, "name": {"en": "Fighter"}},
            {"id": "skill.tumble", "type": "skill", "name": {"en": "Tumble"},
             "skill": {"ability": "dex", "armorCheckPenalty": 1, "trainedOnly": true},
             "effects": [{"target": "skill.balance", "op": "add", "value": 2, "bonusType": "untyped", "condition": "@skill.tumble.ranks >= 5"}]},
            {"id": "skill.balance", "type": "skill", "name": {"en": "Balance"}, "skill": {"ability": "dex", "armorCheckPenalty": 1}},
            {"id": "skill.swim", "type": "skill", "name": {"en": "Swim"}, "skill": {"ability": "str", "armorCheckPenalty": 2}},
            {"id": "skill.knowledge_arcana", "type": "skill", "name": {"en": "Knowledge (arcana)"}, "skill": {"ability": "int", "trainedOnly": true}},
            {"id": "item.chainmail", "type": "item", "name": {"en": "Chainmail"},
             "effects": [{"target": "armor.check_penalty", "op": "add", "value": -5}]}
          ],
          "relations": [
            {"from": "class.rogue", "relation": "class_skill", "to": "skill.tumble"},
            {"from": "class.rogue", "relation": "class_skill", "to": "skill.knowledge"}
          ]
        }
    """.trimIndent()

    private fun sheet(ranks: String, classId: String = "class.rogue", levels: Int = 4, items: String = "[]"): CharacterSheet {
        val records = (1..levels).joinToString(",") { """{"level": $it, "classId": "$classId", "classLevel": $it}""" }
        val character = """
            {"id": "c", "name": "C", "baseAbilities": {"str": 12, "dex": 14, "con": 10, "int": 12, "wis": 10, "cha": 10},
             "levels": [$records], "skillRanks": $ranks, "items": $items}
        """
        return SheetEngine(catalog).open(character)
    }

    private fun CharacterSheet.skill(id: String) = skills.single { it.id == id }

    @Test
    fun aSkillIsRanksPlusAbilityModifier() {
        val s = sheet("""{"skill.tumble": 3}""")
        assertEquals("5", s.skill("skill.tumble").total)
        assertEquals("2", s.skill("skill.balance").total)
    }

    @Test
    fun classSkillsAllowLevelPlusThreeRanksOthersHalf() {
        val s = sheet("{}")
        assertEquals("7", s.skill("skill.tumble").maxRanks)
        assertEquals(true, s.skill("skill.tumble").classSkill)
        assertEquals("3", s.skill("skill.balance").maxRanks)
        // `skill.knowledge` on the class makes every Knowledge field a class skill.
        assertEquals(true, s.skill("skill.knowledge_arcana").classSkill)
    }

    @Test
    fun skillPointsBudgetAndCost() {
        // Rogue 4, Int 12: (8 + 1) × 4 at level 1, then 9 per level: 63. Two cross-class ranks cost 4 points.
        val s = sheet("""{"skill.tumble": 7, "skill.balance": 2}""")
        assertEquals("63", s.skillPoints.total)
        assertEquals("11", s.skillPoints.spent)
        // A Fighter with Int 12 gets (2 + 1) × 4 = 12 at level 1; never less than 1 per level.
        assertEquals("12", sheet("{}", "class.fighter", 1).skillPoints.total)
    }

    @Test
    fun fiveRanksGiveTheSynergy() {
        assertEquals("2", sheet("""{"skill.tumble": 4}""").skill("skill.balance").total)
        assertEquals("4", sheet("""{"skill.tumble": 5}""").skill("skill.balance").total)
    }

    @Test
    fun armorCheckPenaltyAppliesOnceOrTwice() {
        val s = sheet("{}", items = """[{"id": "item.chainmail"}]""")
        assertEquals("-3", s.skill("skill.balance").total)
        assertEquals("-9", s.skill("skill.swim").total)
        assertEquals("1", s.skill("skill.knowledge_arcana").total)
    }

    @Test
    fun aHomebrewSkillWorksLikeAnOfficialOne() {
        val homebrew = catalog.replace(
            "\"entities\": [",
            """"entities": [
            {"id": "eberron:skill.airship_piloting", "type": "skill", "name": {"en": "Airship Piloting"}, "skill": {"ability": "dex"},
             "effects": [{"target": "skill.balance", "op": "add", "value": 2, "bonusType": "untyped", "condition": "@eberron:skill.airship_piloting.ranks >= 5"}]},""",
        )
        val records = (1..4).joinToString(",") { """{"level": $it, "classId": "class.rogue", "classLevel": $it}""" }
        val character = """
            {"id": "c", "name": "C", "baseAbilities": {"str": 12, "dex": 14, "con": 10, "int": 12, "wis": 10, "cha": 10},
             "levels": [$records], "skillRanks": {"eberron:skill.airship_piloting": 5}, "items": []}
        """
        val s = SheetEngine(homebrew).open(character)
        assertEquals("7", s.skill("eberron:skill.airship_piloting").total)
        assertEquals("4", s.skill("skill.balance").total)
    }
}
