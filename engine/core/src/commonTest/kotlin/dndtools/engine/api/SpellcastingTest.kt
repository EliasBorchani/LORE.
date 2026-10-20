package dndtools.engine.api

import kotlin.test.Test
import kotlin.test.assertEquals

class SpellcastingTest {
    private val catalog = """
        {
          "version": "1",
          "bonusTypes": [{"id": "untyped", "stacks": true}],
          "statistics": [
            {"key": "ability.cha.score", "base": "@ability.cha.base"},
            {"key": "ability.cha.mod", "base": "floor((@ability.cha.score - 10) / 2)"}
          ],
          "entities": [
            {"id": "class.bard", "type": "class", "name": {"en": "Bard"}, "hitDie": 6,
             "spellcasting": {"ability": "cha", "kind": "arcane", "mode": "spontaneous"}},
            {"id": "spell.fireball", "type": "spell", "name": {"en": "Fireball"},
             "spell": {"school": "evocation", "range": "long"},
             "effects": [{"target": "spell.damage", "op": "dice", "value": "(min(@spell.caster_level, 10))d6 fire", "scope": "spell"}]},
            {"id": "feat.empower", "type": "feat", "name": {"en": "Empower"},
             "effects": [{"target": "spell.slot_cost", "op": "add", "value": 2, "scope": "spell"}]},
            {"id": "feat.extend", "type": "feat", "name": {"en": "Extend"},
             "effects": [{"target": "spell.slot_cost", "op": "add", "value": 1, "scope": "spell"}]},
            {"id": "feat.improved_metamagic", "type": "feat", "name": {"en": "Improved Metamagic"},
             "effects": [{"target": "spell.slot_cost_per_modifier", "op": "add", "value": -1, "scope": "spell"}]},
            {"id": "feat.improved_spell_capacity", "type": "feat", "name": {"en": "Improved Spell Capacity"},
             "effects": [{"target": "slots.above_max[{choice}]", "op": "add", "value": "count('feat.improved_spell_capacity')"}]}
          ],
          "progressions": [
            {"classId": "class.bard", "level": 1, "spellsPerDay": [2, null], "spellsKnown": [4, null]},
            {"classId": "class.bard", "level": 2, "spellsPerDay": [3, 0], "spellsKnown": [5, 2]},
            {"classId": "class.bard", "level": 20, "spellsPerDay": [4, 4, 4], "spellsKnown": [6, 5, 5]}
          ],
          "relations": [{"from": "spell.fireball", "relation": "on_spell_list", "to": "class.bard", "level": 2}]
        }
    """.trimIndent()

    private val engine = SheetEngine(catalog)

    private fun bard(levels: Int, feats: List<String> = emptyList(), extra: String = "") = """
        {"id": "char.test", "name": "Test", "baseAbilities": {"cha": 16},
         "levels": [${(1..levels).joinToString(",") { level ->
            val taken = if (level == 1) feats.joinToString(",") { """{"id": "$it"}""" } else ""
            """{"level": $level, "classId": "class.bard", "classLevel": $level, "feats": [$taken]}"""
         }}],
         "spellcasting": {"class.bard": {"mode": "spontaneous", "known": ["spell.fireball"]}}
         $extra}
    """.trimIndent()

    private fun caster(sheet: CharacterSheet) = sheet.spellcasting.single()

    @Test
    fun slotsComeFromTheTableAndBonusSpells() {
        // Charisma 16 (+3): no bonus at level 0, +1 at level 1, and none where the table says « — ».
        assertEquals(listOf("2"), caster(engine.open(bard(1))).slots)
        assertEquals(listOf("3", "1"), caster(engine.open(bard(2))).slots)
        val second = caster(engine.open(bard(2)))
        assertEquals(listOf("5", "2"), second.known)
        assertEquals(listOf("13", "14"), second.saveDcs)
        assertEquals("spontaneous", second.mode)
        assertEquals(listOf("spell.fireball"), second.spells)
        assertEquals("2", second.casterLevel)
    }

    @Test
    fun pastTheLastRowTheLastValuesHold() {
        assertEquals(listOf("4", "5", "5"), caster(engine.open(bard(25))).slots)
    }

    @Test
    fun slotsAboveTheMaximumFormALadder() {
        val feats = List(2) { "feat.improved_spell_capacity" }
        val choice = """, "choices": {"feat.improved_spell_capacity": "class.bard"}"""
        // Table maximum 2; two extra slots at levels 3 and 4, with their bonus spells (Cha +3: level 3 only).
        assertEquals(listOf("4", "5", "5", "2", "1"), caster(engine.open(bard(20, feats, choice))).slots)
        // Without a class chosen, the extra slots go nowhere.
        assertEquals(listOf("4", "5", "5"), caster(engine.open(bard(20, feats))).slots)
    }

    @Test
    fun aVariantNeedsTheSlotOfItsLevelPlusItsMetamagic() {
        fun variant(vararg metamagic: String) =
            """{"id": "var.fireball", "spell": "spell.fireball", "casterClass": "class.bard",
                "metamagic": [${metamagic.joinToString(",") { "\"$it\"" }}]}"""
        val plain = engine.open(bard(4)).previewVariant(variant())
        assertEquals("2", plain.level)
        assertEquals("2", plain.slotLevel)
        assertEquals("15", plain.saveDc)
        assertEquals(listOf(StatLine("spell.damage", "4d6 fire (~14)")), plain.numbers)

        assertEquals("4", engine.open(bard(4)).previewVariant(variant("feat.empower")).slotLevel)
        val improved = engine.open(bard(4, listOf("feat.improved_metamagic")))
        assertEquals("3", improved.previewVariant(variant("feat.empower")).slotLevel)
        // Empower 2 + Extend 1, minus 1 per modifier = 1, but each modifier costs at least 1: +2.
        assertEquals("4", improved.previewVariant(variant("feat.empower", "feat.extend")).slotLevel)
    }

    @Test
    fun heightenRaisesTheSpellLevelItsSlotAndItsDc() {
        fun variant(heighten: Int, vararg metamagic: String) =
            """{"id": "var.fireball", "spell": "spell.fireball", "casterClass": "class.bard", "heighten": $heighten,
                "metamagic": [${metamagic.joinToString(",") { "\"$it\"" }}]}"""
        val heightened = engine.open(bard(4)).previewVariant(variant(3))
        assertEquals(3, heightened.heighten)
        assertEquals("5", heightened.level)
        assertEquals("5", heightened.slotLevel)
        assertEquals("18", heightened.saveDc)

        assertEquals("7", engine.open(bard(4)).previewVariant(variant(3, "feat.empower")).slotLevel)
        // Improved Metamagic lowers Empower by 1 and leaves the heightened levels alone.
        val improved = engine.open(bard(4, listOf("feat.improved_metamagic")))
        assertEquals("6", improved.previewVariant(variant(3, "feat.empower")).slotLevel)

        val offList = engine.open(bard(4))
            .previewVariant("""{"id": "v", "spell": "spell.unknown", "casterClass": "class.bard", "heighten": 2}""")
        assertEquals(null, offList.level)
    }

    @Test
    fun savedVariantsAreListedAndPreviewsChangeNothing() {
        val saved = """, "variants": [{"id": "var.fireball", "spell": "spell.fireball", "casterClass": "class.bard",
                         "metamagic": ["feat.empower"]}]"""
        val sheet = engine.open(bard(4, extra = saved))
        assertEquals(listOf("var.fireball"), sheet.variants.map { it.id })
        assertEquals("4", sheet.variants.single().slotLevel)

        val empty = engine.open(bard(4))
        empty.previewVariant("""{"id": "var.x", "spell": "spell.fireball", "casterClass": "class.bard"}""")
        assertEquals(emptyList(), empty.variants)
    }

    @Test
    fun aSpellOffTheClassListHasNoLevel() {
        val line = engine.open(bard(4)).previewVariant("""{"id": "v", "spell": "spell.unknown", "casterClass": "class.bard"}""")
        assertEquals(null, line.level)
        assertEquals(null, line.slotLevel)
    }
}
