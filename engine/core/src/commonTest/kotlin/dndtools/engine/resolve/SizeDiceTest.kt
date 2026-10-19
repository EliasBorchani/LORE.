package dndtools.engine.resolve

import dndtools.engine.Engine
import dndtools.engine.formula.Value
import dndtools.engine.math.Fraction
import dndtools.engine.model.Ability
import dndtools.engine.model.BonusType
import dndtools.engine.model.Catalog
import dndtools.engine.model.Character
import dndtools.engine.model.DiceSteps
import dndtools.engine.model.Effect
import dndtools.engine.model.EffectScope
import dndtools.engine.model.EffectValue
import dndtools.engine.model.Entity
import dndtools.engine.model.FeatChoice
import dndtools.engine.model.Layer
import dndtools.engine.model.LevelRecord
import dndtools.engine.model.ModelCheck
import dndtools.engine.model.Op
import dndtools.engine.model.StatisticDef
import dndtools.engine.resolve.BreakdownLine.Step
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class SizeDiceTest {
    private fun text(t: String) = EffectValue.Text(t)

    private fun entity(id: String, vararg effects: Effect) =
        Entity(id, id.substringBefore('.'), name = mapOf("en" to id), effects = effects.toList())

    private fun size(id: String, word: String) = entity(id, Effect("size", Op.SET, text("'$word'")))

    private fun weapon(id: String, dice: String) = entity(
        id,
        Effect("weapon.damage", Op.SET, text(dice), layer = Layer.BASE, scope = EffectScope.ITEM),
        Effect("weapon.damage", Op.ADD, EffectValue.Number(Fraction.of(2)), bonusType = "enhancement", scope = EffectScope.ITEM),
    )

    private val catalog = Catalog(
        version = "test",
        bonusTypes = listOf(BonusType("enhancement", false), BonusType("untyped", true)),
        statistics = listOf(
            StatisticDef("size", text("'medium'")),
            StatisticDef("size.steps", text("if(@size == 'tiny', -2, if(@size == 'small', -1, if(@size == 'large', 1, if(@size == 'huge', 2, 0))))")),
            StatisticDef("weapon.size_steps", text("@size.steps")),
            StatisticDef("weapon.damage", diceSteps = text("@weapon.size_steps")),
        ),
        entities = listOf(
            weapon("item.longsword", "1d8"), weapon("item.whip", "1d2"), weapon("item.chain", "2d4 + 1d6 fire"),
            size("race.large", "large"), size("race.huge", "huge"), size("race.small", "small"), size("race.tiny", "tiny"),
        ),
        diceSteps = DiceSteps(
            up = mapOf("1d8" to "2d6", "2d6" to "3d6", "1d6" to "1d8"),
            down = mapOf("1d8" to "1d6", "1d6" to "1d4", "1d2" to "1", "2d4" to "1d6"),
        ),
    )

    private fun damage(vararg entities: String): Pair<String, Session> {
        val character = Character(
            id = "char.test",
            name = "Test",
            baseAbilities = Ability.entries.associateWith { 10L },
            levels = listOf(LevelRecord(1, "class.fighter", 1, feats = entities.map { FeatChoice(it) })),
        )
        val session = Engine(catalog).session(character)
        val value = session.sheet.values["weapon.damage"] as Value.Dice
        return value.value.describe() to session
    }

    @Test
    fun mediumDiceStayAsWritten() {
        assertEquals("1d8 + 2 (~6)", damage("item.longsword").first)
    }

    @Test
    fun aLargerWielderMovesTheBaseDiceButNotTheBonus() {
        assertEquals("2d6 + 2 (~9)", damage("item.longsword", "race.large").first)
        assertEquals("3d6 + 2 (~12)", damage("item.longsword", "race.huge").first)
        val (_, session) = damage("item.longsword", "race.large")
        val steps = session.explain("weapon.damage")!!.lines.map { it.step }
        assertEquals(listOf(Step.SET_BASE, Step.SIZE, Step.ADD), steps)
    }

    @Test
    fun aSmallerWielderMovesDown() {
        assertEquals("1d6 + 2 (~5)", damage("item.longsword", "race.small").first)
        assertEquals("1d4 + 2 (~4)", damage("item.longsword", "race.tiny").first)
    }

    @Test
    fun theSmallestStepIsAPlainNumber() {
        assertEquals("3 (~3)", damage("item.whip", "race.small").first)
    }

    @Test
    fun eachTermMovesWithItsTypeAndAMissingStepIsReported() {
        val (text, session) = damage("item.chain", "race.small")
        assertEquals("1d6 + 1d4 fire + 2 (~8)", text)
        val (bigger, big) = damage("item.chain", "race.large")
        assertEquals("2d4 + 1d8 fire + 2 (~11)", bigger)
        assertTrue(big.sheet.issues.any { it.statistic == "weapon.damage" && "2d4" in it.message }, big.sheet.issues.toString())
        assertTrue(session.sheet.issues.isEmpty(), session.sheet.issues.toString())
    }

    @Test
    fun badDiceStepsAreReportedByTheModelCheck() {
        val issues = ModelCheck.catalog(catalog.copy(diceSteps = DiceSteps(up = mapOf("1d8" to "two d6"))))
        assertTrue(issues.any { it.at == "diceSteps:up:1d8" }, issues.toString())
    }
}
