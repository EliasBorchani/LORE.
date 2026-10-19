package dndtools.engine.resolve

import dndtools.engine.Engine
import dndtools.engine.formula.Value
import dndtools.engine.json.EngineJson
import dndtools.engine.math.Fraction
import kotlin.test.Test
import kotlin.test.assertEquals

/** Class tables, the epic rule, grants, spell variants and prerequisites, on a small catalog written as JSON. */
class ProgressionAndSpellsTest {
    private val catalog = EngineJson.decodeCatalog(
        """
        {
          "version": "test",
          "bonusTypes": [{"id": "enhancement", "stacks": false}, {"id": "untyped", "stacks": true}],
          "statistics": [
            {"key": "ability.str.score", "base": "@ability.str.base"},
            {"key": "bab", "base": "@progression.bab"},
            {"key": "save.fort", "base": "@progression.fort"},
            {"key": "hp.base", "base": "3 / 4 * @hit_dice.total"},
            {"key": "caster_level.class[*]", "base": 0},
            {"key": "caster_level.wizard", "base": "level('class.wizard') + @spellcasting.advances[class.wizard] + @caster_level.class[class.wizard]"},
            {"key": "caster_level.sorcerer", "base": "level('class.sorcerer') + @caster_level.class[class.sorcerer]"}
          ],
          "progressions": [
            {"classId": "class.fighter", "level": 1, "bab": 1, "fort": 2, "grants": ["power.bonus_feat"]},
            {"classId": "class.fighter", "level": 2, "bab": 2, "fort": 3},
            {"classId": "class.fighter", "level": 4, "bab": 4, "fort": 4, "grants": ["power.toughness"]},
            {"classId": "class.wizard", "level": 1, "bab": 0, "fort": 0}
          ],
          "progressionRules": {"epicAfterLevel": 3, "epicPerLevel": {"bab": 0.5, "fort": 0.5}},
          "relations": [
            {"from": "template.vampire", "relation": "grants", "to": "power.bat_form"},
            {"from": "class.wizard", "relation": "grants", "to": "power.scribe", "level": 2}
          ],
          "entities": [
            {"id": "class.fighter", "type": "class", "hitDie": 10, "name": {"en": "Fighter"}},
            {"id": "class.wizard", "type": "class", "hitDie": 4, "name": {"en": "Wizard"},
             "prerequisite": "@ability.str.score >= 13 and has('feat.scribe_scroll') and @skill.spellcraft.ranks >= 4 and @turn_undead.level >= 1"},
            {"id": "template.vampire", "type": "template", "name": {"en": "Vampire"}},
            {"id": "power.bonus_feat", "type": "class_power", "name": {"en": "Bonus feat"},
             "effects": [{"target": "save.fort", "op": "add", "value": 1, "bonusType": "untyped"}]},
            {"id": "power.toughness", "type": "class_power", "name": {"en": "Toughness"},
             "effects": [{"target": "save.fort", "op": "add", "value": 10, "bonusType": "untyped"}]},
            {"id": "power.bat_form", "type": "class_power", "name": {"en": "Bat form"},
             "effects": [{"target": "speed.fly", "op": "add", "value": 180, "bonusType": "untyped"}]},
            {"id": "power.scribe", "type": "class_power", "name": {"en": "Scribe"},
             "effects": [{"target": "save.fort", "op": "add", "value": 100, "bonusType": "untyped"}]},
            {"id": "feat.spell_improvement", "type": "feat", "name": {"en": "Spell Improvement"},
             "effects": [{"target": "caster_level.class[{choice}]", "op": "add",
                          "value": "4 * count('feat.spell_improvement')", "bonusType": "untyped"}]},
            {"id": "feat.superspell", "type": "feat", "name": {"en": "Superspell"},
             "effects": [{"target": "spell.numeric", "op": "multiply", "value": 4,
                          "multMode": "exclusive: amplify", "scope": "spell"}]},
            {"id": "feat.empower_spell", "type": "feat", "name": {"en": "Empower"},
             "effects": [{"target": "spell.numeric", "op": "multiply", "value": 1.5,
                          "multMode": "exclusive: amplify", "scope": "spell"}]},
            {"id": "spell.bulls_strength", "type": "spell", "name": {"en": "Bull's Strength"},
             "effects": [{"target": "ability.str.score", "op": "add", "value": "min(@spell.caster_level, 4)",
                          "bonusType": "enhancement", "condition": "active('toggle.bulls_strength')"}]}
          ]
        }
        """.trimIndent()
    )

    private fun character(levels: List<String>, extra: String = "") = EngineJson.decodeCharacter(
        """
        {
          "id": "char.test", "name": "Test", "race": "template.vampire",
          "baseAbilities": {"str": 10, "dex": 10, "con": 10, "int": 10, "wis": 10, "cha": 10},
          "levels": [${levels.withIndex().joinToString(",") { (i, cls) ->
            val classLevel = levels.take(i + 1).count { it == cls }
            """{"level": ${i + 1}, "classId": "$cls", "classLevel": $classLevel}"""
        }}]
          $extra
        }
        """.trimIndent()
    )

    private fun num(n: Long, d: Long = 1): Value = Value.Num(Fraction.of(n, d))

    @Test
    fun classTablesThenTheEpicRule() {
        // Fighter 1-3 from the table, then 2 epic levels (4 and 5): the table's level 4 never counts.
        val sheet = Engine(catalog).compute(character(List(5) { "class.fighter" }))
        assertEquals(num(3), sheet.values["bab"], "table 2 at fighter 3 (last written row holds), + 2 x 1/2")
        // The epic rule replaces base attack and saves only: class features still come at their class level.
        assertEquals(num(3 + 1 + 1 + 10), sheet.values["save.fort"], "table 3 + 2 x 1/2 + bonus feat + toughness")
    }

    @Test
    fun grantsFromTablesAndRelations() {
        val engine = Engine(catalog)
        val fighter = engine.compute(character(List(2) { "class.fighter" }))
        assertEquals(num(3 + 1), fighter.values["save.fort"], "bonus feat from the fighter table at level 1")
        assertEquals(num(180), fighter.values["speed.fly"], "bat form, granted by the vampire race")

        val wizard = engine.compute(character(listOf("class.wizard", "class.wizard")))
        assertEquals(num(100), wizard.values["save.fort"], "wizard relation grant at class level 2")
    }

    @Test
    fun hitDiceAndAdvances() {
        val sheet = Engine(catalog).compute(character(listOf("class.fighter", "class.wizard", "class.wizard")))
        assertEquals(num(13), sheet.values["hp.base"], "3/4 of (10 + 4 + 4) = 13.5, rounded once")
        assertEquals(num(2), sheet.values["caster_level.wizard"])
    }

    @Test
    fun spellVariantsMultiplyBuffs() {
        val toggle = """
            ,"activeToggles": [{"toggle": "toggle.bulls_strength", "spell": "spell.bulls_strength",
                                "casterClass": "class.wizard", "metamagic": ["feat.superspell", "feat.empower_spell"]}]
        """
        val session = Engine(catalog).session(character(List(3) { "class.wizard" }, toggle))
        // Caster level 3 from the wizard, so min(3, 4) = 3; Superspell beats Empower: x4.
        assertEquals(num(10 + 12), session.sheet.values["ability.str.score"])
        val line = session.explain("ability.str.score")!!.lines.single { it.source == "spell.bulls_strength" }
        assertEquals(listOf("feat.superspell", "feat.empower_spell"), line.modifiers)

        // Without a casting class, the spell cannot read its caster level: reported, the rest still computes.
        val noClass = Engine(catalog).compute(character(List(3) { "class.wizard" }, toggle.replace("\"casterClass\": \"class.wizard\",", "")))
        assertEquals(num(10), noClass.values["ability.str.score"])
        assertEquals(true, noClass.issues.any { "names no casterClass" in it.message }, noClass.issues.toString())
    }

    @Test
    fun choicesPickTheTargetOfAnEffect() {
        val levels = listOf("class.wizard", "class.sorcerer")
        val feats = List(2) { """{"id": "feat.spell_improvement"}""" }.joinToString(",")
        fun withChoice(choice: String) = EngineJson.decodeCharacter(
            EngineJson.encodeCharacter(character(levels, choice)).replaceFirst(
                "\"classLevel\":1}", "\"classLevel\":1,\"feats\":[$feats]}",
            )
        )
        val engine = Engine(catalog)
        val session = engine.session(withChoice(""","choices": {"feat.spell_improvement": "class.wizard"}"""))
        assertEquals(num(1 + 8), session.sheet.values["caster_level.wizard"], "two takes, +4 each")
        assertEquals(num(1), session.sheet.values["caster_level.sorcerer"])

        // Changing the choice moves the bonus, and recomputes only the two caster levels and their parts.
        val update = session.update(withChoice(""","choices": {"feat.spell_improvement": "class.sorcerer"}"""))
        assertEquals(num(1), update.sheet.values["caster_level.wizard"])
        assertEquals(num(1 + 8), update.sheet.values["caster_level.sorcerer"])
        assertEquals(
            setOf("caster_level.class[class.wizard]", "caster_level.class[class.sorcerer]", "caster_level.wizard", "caster_level.sorcerer"),
            update.changed,
        )

        val none = engine.compute(withChoice(""))
        assertEquals(true, none.issues.any { "needs a choice" in it.message }, none.issues.toString())
    }

    @Test
    fun prerequisitesNameThePartThatFailed() {
        val sheet = Engine(catalog).compute(character(listOf("class.wizard")))
        val result = sheet.prerequisites.single()
        assertEquals("class.wizard", result.entity)
        assertEquals(listOf("@ability.str.score >= 13", "has('feat.scribe_scroll')", "@skill.spellcraft.ranks >= 4"), result.failed)
        assertEquals(
            listOf("@turn_undead.level >= 1: Unknown statistic '@turn_undead.level'"),
            result.unknown,
        )
    }
}
