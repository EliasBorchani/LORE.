package dndtools.engine.api

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * A Halfling druid 20 (Str 10, Dex 14, Con 12) as a brown bear (6 HD Large, Str 27 Dex 13 Con 19, natural armor 5,
 * 2 claws 1d8 and a secondary bite 2d6, advancement 7–10 Large, 11–18 Huge). At 18 HD the bear is Huge:
 * Str 27 + 8 = 35, Dex 11, Con 23, natural armor 8, and ⌊18/4⌋ − ⌊6/4⌋ = 3 ability points.
 */
class FormsTest {
    private val sizes = "if(@size == 'small', -1, if(@size == 'large', 1, if(@size == 'huge', 2, 0)))"
    private val catalog = """
        {
          "version": "1",
          "bonusTypes": [{"id": "untyped", "stacks": true}, {"id": "racial", "stacks": false}, {"id": "enhancement", "stacks": false}],
          "damageTypes": [{"id": "slashing"}, {"id": "piercing"}, {"id": "bludgeoning"}, {"id": "fire"}],
          "statistics": [
            {"key": "ability.str.score", "base": "@ability.str.base"},
            {"key": "ability.str.mod", "base": "floor((@ability.str.score - 10) / 2)"},
            {"key": "ability.dex.score", "base": "@ability.dex.base"},
            {"key": "ability.dex.mod", "base": "floor((@ability.dex.score - 10) / 2)"},
            {"key": "ability.con.score", "base": "@ability.con.base"},
            {"key": "ability.con.mod", "base": "floor((@ability.con.score - 10) / 2)"},
            {"key": "bab", "base": "15"},
            {"key": "size", "base": "'medium'"},
            {"key": "size.steps", "base": "$sizes"},
            {"key": "size.modifier", "base": "if(@size == 'small', 1, if(@size == 'large', -1, if(@size == 'huge', -2, 0)))"},
            {"key": "ac.natural", "base": 0},
            {"key": "ac.total", "base": "10 + @ac.natural + @ability.dex.mod + @size.modifier"},
            {"key": "hp.max", "base": "10 + @ability.con.mod * level()"},
            {"key": "weapon.attack", "base": 0},
            {"key": "attack.melee", "components": ["bab", "ability.str.mod", "weapon.attack", "size.modifier"]},
            {"key": "damage.melee", "base": "@ability.str.mod"},
            {"key": "speed.land", "base": 9}
          ],
          "diceSteps": {"up": {"1d8": "2d6", "2d6": "3d6"}, "down": {"2d6": "1d8", "1d8": "1d6"}},
          "sizeChanges": [
            {"size": "medium", "str": 4, "dex": -2, "con": 2},
            {"size": "large", "str": 8, "dex": -2, "con": 4, "naturalArmor": 2},
            {"size": "huge", "str": 8, "dex": -2, "con": 4, "naturalArmor": 3}
          ],
          "entities": [
            {"id": "race.halfling", "type": "race", "name": {"en": "Halfling"}, "effects": [
              {"target": "ability.str.score", "op": "add", "value": -2, "bonusType": "racial"},
              {"target": "ability.dex.score", "op": "add", "value": 2, "bonusType": "racial"},
              {"target": "size", "op": "set", "value": "'small'", "layer": "base"},
              {"target": "speed.land", "op": "set", "value": 6, "layer": "base"}
            ]},
            {"id": "class.druid", "type": "class", "name": {"en": "Druid"}, "hitDie": 8},
            {"id": "feat.natural_spell", "type": "feat", "name": {"en": "Natural Spell"}},
            {"id": "feat.multiattack", "type": "feat", "name": {"en": "Multiattack"}, "effects": [
              {"target": "natural.secondary_penalty", "op": "add", "value": 3, "bonusType": "untyped"}
            ]},
            {"id": "power.wild_shape", "type": "class_power", "name": {"en": "Wild shape"}, "shaping": {
              "kinds": ["animal"], "maxHd": "level('class.druid')",
              "minSize": "'small'", "maxSize": "if(level('class.druid') >= 15, 'huge', if(level('class.druid') >= 8, 'large', 'medium'))",
              "meldsEquipment": true, "castingFeat": "feat.natural_spell"
            }},
            {"id": "spell.polymorph", "type": "spell", "name": {"en": "Polymorph"}, "shaping": {"maxHd": "15"}},
            {"id": "item.amulet", "type": "item", "name": {"en": "Amulet of natural armor"}, "effects": [
              {"target": "ac.natural", "op": "add", "value": 2, "bonusType": "enhancement"}
            ]},
            {"id": "item.belt", "type": "item", "name": {"en": "Wilding belt"}, "labels": ["wilding"], "effects": [
              {"target": "ability.str.score", "op": "add", "value": 4, "bonusType": "enhancement"}
            ]},
            {"id": "creature.fire_elemental_large", "type": "creature", "name": {"en": "Large fire elemental"}, "creature": {
              "kind": "elemental", "hitDice": 8, "size": "large",
              "abilities": {"str": 14, "dex": 21, "con": 16, "int": 6, "wis": 11, "cha": 11},
              "naturalArmor": 4, "speeds": {"land": 15},
              "attacks": [{"id": "slam", "name": {"en": "Slam"}, "count": 2, "dice": "2d6 + 2d6 fire", "damageType": "bludgeoning"}]
            }},
            {"id": "creature.brown_bear", "type": "creature", "name": {"en": "Brown bear"}, "creature": {
              "kind": "animal", "hitDice": 6, "size": "large",
              "abilities": {"str": 27, "dex": 13, "con": 19, "int": 2, "wis": 12, "cha": 6},
              "naturalArmor": 5, "speeds": {"land": 12},
              "attacks": [
                {"id": "claw", "name": {"en": "Claw"}, "count": 2, "dice": "1d8", "damageType": "slashing"},
                {"id": "bite", "name": {"en": "Bite"}, "dice": "2d6", "damageType": "piercing", "primary": false}
              ],
              "advancement": [{"maxHd": 10, "size": "large"}, {"maxHd": 18, "size": "huge"}]
            }}
          ],
          "relations": [{"from": "class.druid", "relation": "grants", "to": "power.wild_shape", "level": 5}]
        }
    """.trimIndent()

    private fun character(
        druidLevels: Int = 20,
        forms: String = """[{"id": "form.bear", "name": "War bear", "creature": "creature.brown_bear", "source": "power.wild_shape", "abilityIncreases": ["str", "str", "str"]}]""",
        toggles: String = """[{"toggle": "toggle.form", "form": "form.bear"}]""",
        feats: String = "[]",
    ): String {
        val levels = (1..druidLevels).joinToString(",") { n ->
            """{"level": $n, "classId": "class.druid", "classLevel": $n${if (n == 1) ", \"feats\": $feats" else ""}}"""
        }
        return """
            {"id": "char.test", "name": "Test", "race": "race.halfling",
             "baseAbilities": {"str": 10, "dex": 14, "con": 12, "int": 10, "wis": 16, "cha": 10},
             "levels": [$levels],
             "items": [{"id": "item.amulet"}, {"id": "item.belt"}],
             "forms": $forms,
             "activeToggles": $toggles}
        """.trimIndent()
    }

    private val engine = SheetEngine(catalog)
    private fun CharacterSheet.value(key: String) = statistic(key)?.text

    @Test
    fun theCharacterIsItselfWithoutAForm() {
        val sheet = engine.open(character(toggles = "[]"))
        assertEquals("12", sheet.value("ability.str.score")) // 10 − 2 racial + 4 belt
        assertEquals("small", sheet.value("size"))
        assertEquals("16", sheet.value("ac.total")) // 10 + 2 amulet + 3 Dex (14 + 2 racial) + 1 size
        assertEquals("6", sheet.value("speed.land"))
        assertNull(sheet.activeForm)
    }

    @Test
    fun aBearAdvancedTo18HitDiceIsHuge() {
        val sheet = engine.open(character())
        // 27 + 8 (Huge) + 3 points + 4 wilding belt; the Halfling's −2 no longer counts.
        assertEquals("42", sheet.value("ability.str.score"))
        assertEquals("11", sheet.value("ability.dex.score"))
        assertEquals("23", sheet.value("ability.con.score"))
        assertEquals("huge", sheet.value("size"))
        assertEquals("12", sheet.value("speed.land"))
        // Natural armor 8; the amulet melded into the form.
        assertEquals("8", sheet.value("ac.natural"))
        assertEquals("16", sheet.value("ac.total")) // 10 + 8 + 0 Dex − 2 size
        assertEquals("130", sheet.value("hp.max")) // 10 + 6 × 20

        val form = sheet.activeForm!!
        assertEquals("18", form.hitDice)
        assertEquals(3, form.abilityPoints)
        assertEquals(0, form.unspent)
        assertEquals(emptyList(), form.issues)
        assertFalse(form.canCast)
        val (claw, bite) = form.naturalAttacks
        assertEquals("29", claw.attack) // 15 BAB + 16 Str − 2 size
        assertEquals("2d6 slashing + 16 (~23)", claw.damage)
        assertEquals("24", bite.attack) // secondary −5
        assertEquals("3d6 piercing + 8 (~18)", bite.damage) // half Strength
    }

    @Test
    fun theFormReplacesTheRaceInTheBreakdown() {
        val sheet = engine.open(character())
        val racial = sheet.explain("ability.str.score").single { it.source == "race.halfling" }
        assertEquals("replaced", racial.status)
        assertEquals("creature.brown_bear", racial.suppressedBy)
    }

    @Test
    fun fewerHitDiceKeepTheBearLarge() {
        val forms = """[{"id": "form.bear", "creature": "creature.brown_bear", "source": "power.wild_shape", "hitDice": 10, "abilityIncreases": ["con"]}]"""
        val sheet = engine.open(character(forms = forms))
        assertEquals("large", sheet.value("size"))
        assertEquals("31", sheet.value("ability.str.score")) // 27 + 4 belt
        assertEquals("20", sheet.value("ability.con.score")) // 19 + 1 point
        assertEquals("1d8 slashing + 10 (~14)", sheet.activeForm!!.naturalAttacks[0].damage) // claws as written for Large
    }

    @Test
    fun polymorphStopsAt15HitDice() {
        val forms = """[{"id": "form.bear", "creature": "creature.brown_bear", "source": "spell.polymorph"}]"""
        val form = engine.open(character(forms = forms)).activeForm!!
        assertEquals("15", form.hitDice)
        assertEquals("15", form.maxHitDice)
        assertEquals(2, form.unspent)
        assertEquals(listOf("unspent"), form.issues)
        assertTrue(form.canCast)
    }

    @Test
    fun keepingTheEquipmentIsAHouseRule() {
        val forms = """[{"id": "form.bear", "creature": "creature.brown_bear", "source": "power.wild_shape", "keepEquipment": true}]"""
        assertEquals("10", engine.open(character(forms = forms)).value("ac.natural")) // 8 + 2 amulet
    }

    @Test
    fun aLowLevelDruidCannotTakeTheBearYet() {
        val form = engine.open(character(druidLevels = 5)).forms.single()
        assertTrue("too_many_hd" in form.issues)
        assertTrue("size_not_allowed" in form.issues)
    }

    @Test
    fun multiattackAndNaturalSpell() {
        val sheet = engine.open(character(feats = """[{"id": "feat.multiattack"}, {"id": "feat.natural_spell"}]"""))
        val form = sheet.activeForm!!
        assertEquals("27", form.naturalAttacks[1].attack) // −2 instead of −5
        assertTrue(form.canCast)
    }

    @Test
    fun aSlamCanBurnToo() {
        val forms = """[{"id": "form.fire", "creature": "creature.fire_elemental_large", "source": "spell.polymorph"}]"""
        val sheet = engine.open(character(forms = forms, toggles = """[{"toggle": "toggle.form", "form": "form.fire"}]"""))
        assertEquals("2d6 bludgeoning + 2d6 fire + 4 (~18)", sheet.activeForm!!.naturalAttacks.single().damage) // Str 14 + 4 wilding belt
    }

    @Test
    fun switchingFormsAndBack() {
        val sheet = engine.open(character(toggles = "[]"))
        val changed = sheet.setForm("form.bear")
        assertTrue("ability.str.score" in changed)
        assertEquals("42", sheet.value("ability.str.score"))
        assertTrue(sheet.toggles.none { it.id == FORM_TOGGLE })
        sheet.setForm(null)
        assertEquals("12", sheet.value("ability.str.score"))
        assertEquals("small", sheet.value("size"))
    }

    @Test
    fun theBuilderPreviewsAFormWithoutChangingTheSheet() {
        val sheet = engine.open(character(toggles = "[]"))
        val preview = sheet.previewForm("""{"id": "form.new", "creature": "creature.brown_bear", "source": "power.wild_shape", "hitDice": 12}""")
        assertEquals("huge", preview.form.size)
        assertEquals("huge", preview.stats.single { it.key == "size" }.text)
        assertEquals("small", sheet.value("size"))
    }
}
