package dndtools.engine.model

import dndtools.engine.json.EngineJson
import dndtools.engine.math.Fraction
import kotlinx.serialization.SerializationException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class ModelJsonTest {
    private val catalogJson = """
        {
          "version": "test",
          "bonusTypes": [{"id": "enhancement", "stacks": false}, {"id": "untyped", "stacks": true}],
          "entities": [
            {
              "id": "feat.empower_spell", "type": "feat", "name": {"en": "Empower Spell"},
              "status": "draft", "note": "review metadata, ignored",
              "effects": [
                {"target": "spell.damage", "op": "multiply", "value": 1.5,
                 "multMode": "exclusive: metamagic_amplify", "scope": "spell"},
                {"target": "spell.slot_cost", "op": "add", "value": 2, "bonusType": "untyped", "scope": "spell"}
              ]
            },
            {
              "id": "spell.divine_power", "type": "spell", "name": {"en": "Divine Power"},
              "usesPerDay": "3 + floor(level('class.ultimate_magus') / 2)",
              "effects": [
                {"target": "bab", "op": "set", "layer": "base", "condition": "active('toggle.divine_power')",
                 "value": "if(level() <= 20, level(), 20 + floor(0.75 * (level() - 20)))"}
              ]
            }
          ],
          "progressions": [{"classId": "feat.empower_spell", "level": 1, "bab": 0.5, "fort": 2}]
        }
    """.trimIndent()

    @Test
    fun decodesEffectValuesAndModes() {
        val catalog = EngineJson.decodeCatalog(catalogJson)
        val empower = catalog.entities[0].effects

        assertEquals(EffectValue.Number(Fraction.of(3, 2)), empower[0].value)
        assertEquals(MultMode.Exclusive("metamagic_amplify"), empower[0].multMode)
        assertEquals(EffectScope.SPELL, empower[0].scope)
        assertEquals(Op.ADD, empower[1].op)
        assertEquals(EffectValue.Number(Fraction.of(2)), empower[1].value)

        val divinePower = catalog.entities[1]
        assertEquals(Layer.BASE, divinePower.effects[0].layer)
        assertTrue(divinePower.effects[0].value is EffectValue.Text)
        assertTrue(divinePower.usesPerDay is EffectValue.Text)

        assertEquals(Fraction.of(1, 2), catalog.progressions[0].bab)
        assertEquals(null, catalog.progressions[0].ref)
    }

    @Test
    fun roundTripsThroughJson() {
        val catalog = EngineJson.decodeCatalog(catalogJson)
        assertEquals(catalog, EngineJson.decodeCatalog(EngineJson.encodeCatalog(catalog)))
    }

    @Test
    fun fractionsAreWrittenAsExactDecimalsWhenPossible() {
        fun encode(f: Fraction) = EngineJson.json.encodeToString(Fraction.serializer(), f)
        assertEquals("7", encode(Fraction.of(7)))
        assertEquals("1.5", encode(Fraction.of(3, 2)))
        assertEquals("-0.75", encode(Fraction.of(-3, 4)))
        assertEquals("0.04", encode(Fraction.of(1, 25)))
        assertEquals("\"1/3\"", encode(Fraction.of(1, 3)))
    }

    @Test
    fun nonDecimalEffectValuesRoundTripAsNumbers() {
        val value: EffectValue = EffectValue.Number(Fraction.of(1, 3))
        val encoded = EngineJson.json.encodeToString(EffectValue.serializer(), value)
        assertEquals(value, EngineJson.json.decodeFromString(EffectValue.serializer(), encoded))
    }

    @Test
    fun rejectsUnknownFieldsAndValues() {
        assertFailsWith<SerializationException> {
            EngineJson.decodeCatalog(catalogJson.replace("\"scope\": \"spell\"}", "\"scoep\": \"spell\"}"))
        }
        assertFailsWith<SerializationException> {
            EngineJson.decodeCatalog(catalogJson.replace("\"op\": \"add\"", "\"op\": \"plus\""))
        }
        assertFailsWith<SerializationException> {
            EngineJson.decodeCatalog(catalogJson.replace("exclusive: metamagic_amplify", "exclusive:"))
        }
        assertFailsWith<SerializationException> {
            EngineJson.decodeCatalog(catalogJson.replace("\"value\": 2,", "\"value\": true,"))
        }
    }

    @Test
    fun decodesACharacter() {
        val character = EngineJson.decodeCharacter(
            """
            {
              "id": "char.test", "name": "Test", "xp": 1000, "race": "race.human",
              "assumptions": ["review metadata, ignored"],
              "baseAbilities": {"str": 18, "dex": 16, "con": 16, "int": 18, "wis": 12, "cha": 12},
              "levels": [
                {"level": 1, "classId": "class.warblade", "classLevel": 1,
                 "feats": [{"id": "feat.power_attack", "slot": "general", "flag": "ignored"}],
                 "abilityIncrease": "int"}
              ],
              "spellcasting": {"class.wizard": {"mode": "free_slots"}},
              "activeToggles": [
                {"toggle": "toggle.power_attack", "value": 10},
                {"toggle": "toggle.bulls_strength", "spell": "spell.bulls_strength", "metamagic": ["feat.superspell"]}
              ]
            }
            """.trimIndent()
        )
        assertEquals(18, character.baseAbilities[Ability.STR])
        assertEquals(Ability.INT, character.levels[0].abilityIncrease)
        assertEquals(SpellcastingMode.FREE_SLOTS, character.spellcasting["class.wizard"]?.mode)
        assertEquals(Fraction.of(10), character.activeToggles[0].value)
        assertEquals(listOf("feat.superspell"), character.activeToggles[1].metamagic)
    }

    @Test
    fun checkReportsDataProblems() {
        val catalog = EngineJson.decodeCatalog(
            catalogJson
                .replace("\"bonusType\": \"untyped\"", "\"bonusType\": \"to confirm\"")
                .replace(", \"layer\": \"base\"", "")
                .replace("\"usesPerDay\": \"3 + floor(", "\"usesPerDay\": \"3 + flor(")
        )
        assertEquals(
            listOf(
                ModelIssue.Code.UNKNOWN_BONUS_TYPE,
                ModelIssue.Code.INVALID_FORMULA,
                ModelIssue.Code.MISSING_LAYER,
            ),
            ModelCheck.catalog(catalog).map { it.code },
        )
    }

    @Test
    fun checksDamageTypes() {
        val catalog = EngineJson.decodeCatalog(
            """
            {
              "version": "test", "bonusTypes": [],
              "damageTypes": [{"id": "fire"}, {"id": "fire_holy", "parts": ["fire", "holy"]}],
              "entities": [
                {"id": "spell.x", "type": "spell", "name": {"en": "X"},
                 "effects": [{"target": "spell.damage", "op": "dice", "value": "2d6 fire + 1d6 cold"},
                             {"target": "save.all", "op": "add", "value": 2, "bonusType": "resistance",
                              "situation": "situation.vs_evil"}]}
              ]
            }
            """.trimIndent()
        )
        assertEquals("situation.vs_evil", catalog.entities[0].effects[1].situation)
        assertEquals(
            listOf(
                "damageTypes:fire_holy: Unknown part 'holy'",
                "entity:spell.x/effects[0].value: Unknown damage type 'cold'",
                "entity:spell.x/effects[1]: Unknown bonus type 'resistance'",
            ),
            ModelCheck.catalog(catalog).map { "${it.at}: ${it.message}" },
        )
    }
}
