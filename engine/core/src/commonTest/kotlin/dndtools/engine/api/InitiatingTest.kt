package dndtools.engine.api

import kotlin.test.Test
import kotlin.test.assertEquals

class InitiatingTest {
    private val catalog = """
        {
          "version": "1",
          "bonusTypes": [{"id": "untyped", "stacks": true}],
          "statistics": [
            {"key": "ability.int.score", "base": "@ability.int.base"},
            {"key": "ability.int.mod", "base": "floor((@ability.int.score - 10) / 2)"},
            {"key": "attack.melee", "base": "0"}
          ],
          "entities": [
            {"id": "class.warblade", "type": "class", "name": {"en": "Warblade"}, "hitDie": 12,
             "initiating": {"ability": "int"}},
            {"id": "class.fighter", "type": "class", "name": {"en": "Fighter"}, "hitDie": 10},
            {"id": "feat.martial_study", "type": "feat", "name": {"en": "Martial Study"}, "initiating": {},
             "repeatable": {}, "effects": [{"target": "maneuvers.known.martial_study", "op": "add", "value": 1}]},
            {"id": "feat.desert_fire", "type": "feat", "name": {"en": "Desert Fire"},
             "prerequisite": "@maneuvers.count[discipline.iron_heart:strike] >= 1"},
            {"id": "class_power.warblade_stance_mastery", "type": "class_power", "name": {"en": "Stance Mastery"},
             "effects": [{"target": "stances.active_max", "op": "add", "value": 1}]},
            {"id": "stance.leading_the_charge", "type": "stance", "name": {"en": "Leading the Charge"},
             "maneuver": {"discipline": "discipline.iron_heart", "level": 1, "kind": "stance"},
             "effects": [{"target": "attack.melee", "op": "add", "value": "@initiator_level",
                          "condition": "active('toggle.leading_the_charge')"}]},
            {"id": "discipline.iron_heart", "type": "discipline", "name": {"en": "Iron Heart"}},
            {"id": "discipline.shadow_hand", "type": "discipline", "name": {"en": "Shadow Hand"}},
            {"id": "maneuver.steel_wind", "type": "maneuver", "name": {"en": "Steel Wind"},
             "maneuver": {"discipline": "discipline.iron_heart", "level": 1, "kind": "strike"}},
            {"id": "maneuver.lightning_recovery", "type": "maneuver", "name": {"en": "Lightning Recovery"},
             "maneuver": {"discipline": "discipline.iron_heart", "level": 4, "kind": "counter", "requires": 1}},
            {"id": "maneuver.finishing_move", "type": "maneuver", "name": {"en": "Finishing Move"},
             "maneuver": {"discipline": "discipline.iron_heart", "level": 4, "kind": "strike", "requires": 2}},
            {"id": "maneuver.cloak_of_deception", "type": "maneuver", "name": {"en": "Cloak of Deception"},
             "maneuver": {"discipline": "discipline.shadow_hand", "level": 2, "kind": "boost"}},
            {"id": "stance.punishing_stance", "type": "stance", "name": {"en": "Punishing Stance"},
             "maneuver": {"discipline": "discipline.iron_heart", "level": 1, "kind": "stance"},
             "effects": [{"target": "attack.melee", "op": "add", "value": 2,
                          "condition": "active('toggle.stance.punishing_stance')"}]}
          ],
          "progressions": [
            {"classId": "class.warblade", "level": 1, "maneuversKnown": 3, "maneuversReadied": 3, "stancesKnown": 1},
            {"classId": "class.warblade", "level": 4, "maneuversKnown": 5, "maneuversReadied": 4, "stancesKnown": 2},
            {"classId": "class.warblade", "level": 20, "maneuversKnown": 13, "maneuversReadied": 7, "stancesKnown": 4}
          ],
          "relations": [
            {"from": "class.warblade", "relation": "initiates", "to": "discipline.iron_heart"},
            {"from": "feat.martial_study", "relation": "initiates", "to": "discipline.iron_heart"},
            {"from": "feat.martial_study", "relation": "initiates", "to": "discipline.shadow_hand"},
            {"from": "class.warblade", "relation": "grants", "to": "class_power.warblade_stance_mastery", "level": 20}
          ]
        }
    """.trimIndent()

    private val engine = SheetEngine(catalog)

    private fun warblade(warblade: Int, fighter: Int = 0, known: List<String>, toggles: String = "", feats: String = "") = """
        {"id": "char.test", "name": "Test", "baseAbilities": {"int": 14},
         "levels": [${(List(fighter) { "class.fighter" } + List(warblade) { "class.warblade" }).mapIndexed { i, c ->
            """{"level": ${i + 1}, "classId": "$c", "classLevel": ${if (c == "class.fighter") i + 1 else i + 1 - fighter}${if (i == 0) feats else ""}}"""
         }.joinToString(",")}],
         "maneuvers": {"class.warblade": {"known": [${known.joinToString(",") { "\"$it\"" }}]}}
         $toggles}
    """.trimIndent()

    private fun line(sheet: CharacterSheet) = sheet.initiators.single()

    @Test
    fun countsComeFromTheTableAndHoldPastTheLastRow() {
        val first = line(engine.open(warblade(1, known = emptyList())))
        assertEquals(listOf("3", "3", "1"), listOf(first.maneuversKnown, first.maneuversReadied, first.stancesKnown))
        val epic = line(engine.open(warblade(25, known = emptyList())))
        assertEquals(listOf("13", "7", "4"), listOf(epic.maneuversKnown, epic.maneuversReadied, epic.stancesKnown))
        assertEquals(listOf("discipline.iron_heart"), first.disciplines)
    }

    @Test
    fun otherClassesGiveHalfTheirLevelsToTheInitiatorLevel() {
        // Fighter 5 / Warblade 3: initiator level 3 + 2 = 5, maneuvers up to level 3.
        val multiclass = line(engine.open(warblade(3, fighter = 5, known = emptyList())))
        assertEquals("5", multiclass.initiatorLevel)
        assertEquals("3", multiclass.maxManeuverLevel)
        assertEquals("9", line(engine.open(warblade(20, known = emptyList()))).maxManeuverLevel)
    }

    @Test
    fun stancesAreCountedApartAndTheirTogglesShow() {
        val known = listOf("maneuver.steel_wind", "stance.punishing_stance")
        val sheet = engine.open(warblade(1, known = known))
        assertEquals(listOf("maneuver.steel_wind"), line(sheet).maneuvers)
        assertEquals(listOf("stance.punishing_stance"), line(sheet).stances)
        assertEquals(emptyList(), line(sheet).issues.map { it.code })
        assertEquals("stance.punishing_stance", sheet.toggles.single { it.id == "toggle.stance.punishing_stance" }.source)
        val on = engine.open(warblade(1, known = known, toggles = """, "activeToggles": [{"toggle": "toggle.stance.punishing_stance"}]"""))
        assertEquals("2", on.statistic("attack.melee")?.text)
    }

    @Test
    fun brokenRulesAreReported() {
        val known = listOf(
            "maneuver.cloak_of_deception", // a discipline the Warblade does not initiate
            "maneuver.lightning_recovery", // level 4 at initiator level 1
            "feat.unknown",
        )
        val issues = line(engine.open(warblade(1, known = known))).issues.map { it.entity to it.code }
        assertEquals(
            listOf("maneuver.cloak_of_deception" to "discipline", "maneuver.lightning_recovery" to "level", "feat.unknown" to "unknown"),
            issues,
        )
        // At level 7 (maneuvers up to 4), Finishing Move needs two other Iron Heart maneuvers: one is not enough.
        val prerequisites = line(engine.open(warblade(7, known = listOf("maneuver.steel_wind", "maneuver.finishing_move"))))
        assertEquals(listOf("maneuver.finishing_move" to "requires"), prerequisites.issues.map { it.entity to it.code })
        val tooMany = List(4) { "maneuver.steel_wind" } + List(2) { "stance.punishing_stance" }
        val counts = line(engine.open(warblade(1, known = tooMany))).issues.map { it.entity to it.code }
        assertEquals(listOf(null to "too_many", null to "too_many_stances"), counts)
    }

    @Test
    fun formulasReadTheHighestInitiatorLevel() {
        val known = listOf("stance.leading_the_charge")
        val on = """, "activeToggles": [{"toggle": "toggle.leading_the_charge"}]"""
        // Fighter 5 / Warblade 3: initiator level 5.
        assertEquals("5", engine.open(warblade(3, fighter = 5, known = known, toggles = on)).statistic("attack.melee")?.text)
        // Without an initiator class: half the character level (Fighter 6 → 3).
        assertEquals("3", engine.open(warblade(0, fighter = 6, known = emptyList())).statistic("initiator_level")?.text)
    }

    @Test
    fun aFeatGivesManeuversAtTheCharacterInitiatorLevel() {
        val martialStudy = """, "feats": [{"id": "feat.martial_study"}]"""
        val character = warblade(0, fighter = 6, known = emptyList(), feats = martialStudy).replace(
            """"maneuvers": {"class.warblade"""", """"maneuvers": {"feat.martial_study": {"known": ["maneuver.cloak_of_deception"]}, "class.warblade"""",
        )
        val line = engine.open(character).initiators.single()
        assertEquals("feat.martial_study", line.classId)
        assertEquals(listOf("3", "2", "1"), listOf(line.initiatorLevel, line.maxManeuverLevel, line.maneuversKnown))
        assertEquals(listOf("maneuver.cloak_of_deception"), line.maneuvers)
        assertEquals(emptyList(), line.issues.map { it.code })
    }

    @Test
    fun prerequisitesCountKnownManeuvers() {
        val feat = """, "feats": [{"id": "feat.desert_fire"}]"""
        val without = engine.open(warblade(1, known = listOf("stance.punishing_stance"), feats = feat))
        assertEquals(listOf("feat.desert_fire"), without.prerequisites.map { it.entity })
        val with = engine.open(warblade(1, known = listOf("maneuver.steel_wind"), feats = feat))
        assertEquals(emptyList(), with.prerequisites.map { it.entity })
    }

    @Test
    fun stanceMasteryAllowsTwoStances() {
        assertEquals("1", engine.open(warblade(19, known = emptyList())).statistic("stances.active_max")?.text)
        assertEquals("2", engine.open(warblade(20, known = emptyList())).statistic("stances.active_max")?.text)
    }
}
