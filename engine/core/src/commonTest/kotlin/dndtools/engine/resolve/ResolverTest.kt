package dndtools.engine.resolve

import dndtools.engine.Engine
import dndtools.engine.formula.DiceValue
import dndtools.engine.formula.Value
import dndtools.engine.math.Fraction
import dndtools.engine.model.Ability
import dndtools.engine.model.BonusType
import dndtools.engine.model.Catalog
import dndtools.engine.model.Character
import dndtools.engine.model.Effect
import dndtools.engine.model.EffectValue
import dndtools.engine.model.Entity
import dndtools.engine.model.FeatChoice
import dndtools.engine.model.Layer
import dndtools.engine.model.LevelRecord
import dndtools.engine.model.MultMode
import dndtools.engine.model.Op
import dndtools.engine.model.StatisticDef
import dndtools.engine.model.TargetGroup
import dndtools.engine.model.ToggleChoice
import dndtools.engine.resolve.BreakdownLine.Status
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

private fun value(v: Any): EffectValue = when (v) {
    is Int -> EffectValue.Number(Fraction.of(v))
    is String -> EffectValue.Text(v)
    is Fraction -> EffectValue.Number(v)
    else -> error("Unsupported value $v")
}

private fun add(target: String, v: Any, type: String = "untyped", condition: String? = null, situation: String? = null) =
    Effect(target, Op.ADD, value(v), bonusType = type, condition = condition, situation = situation)

private fun op(target: String, op: Op, v: Any, layer: Layer? = null, mode: MultMode? = null, condition: String? = null) =
    Effect(target, op, value(v), layer = layer, multMode = mode, condition = condition)

private fun entity(id: String, vararg effects: Effect) =
    Entity(id, id.substringBefore('.'), name = mapOf("en" to id), effects = effects.toList())

private fun stat(key: String, base: Any? = null, components: List<String> = emptyList(), round: Boolean = true) =
    StatisticDef(key, base?.let(::value), components, round)

private val CORE = listOf(
    stat("ability.str.score", "@ability.str.base"),
    stat("ability.str.mod", "floor((@ability.str.score - 10) / 2)"),
    stat("ability.dex.score", "@ability.dex.base"),
    stat("ability.dex.mod", "floor((@ability.dex.score - 10) / 2)"),
    stat("bab", "level()"),
    stat("attack.melee", "@bab + @ability.str.mod"),
    stat("damage.melee", components = listOf("damage.melee.weapon", "damage.melee.ability")),
    stat("damage.melee.weapon", "2d6"),
    stat("damage.melee.ability", "@ability.str.mod"),
    stat("ac.dex_bonus", "@ability.dex.mod"),
    stat("save.fort"),
    stat("save.ref"),
)

private fun catalog(vararg entities: Entity, statistics: List<StatisticDef> = emptyList()) = Catalog(
    version = "test",
    bonusTypes = listOf(
        BonusType("enhancement", false), BonusType("luck", false), BonusType("resistance", false),
        BonusType("untyped", true), BonusType("dodge", true),
    ),
    statistics = CORE + statistics,
    targetGroups = listOf(TargetGroup("save.all", listOf("save.fort", "save.ref"))),
    entities = entities.toList(),
)

private fun character(
    feats: List<String> = emptyList(),
    toggles: List<ToggleChoice> = emptyList(),
    str: Long = 10,
    dex: Long = 10,
    levels: Int = 1,
) = Character(
    id = "char.test",
    name = "Test",
    baseAbilities = Ability.entries.associateWith { 10L } + mapOf(Ability.STR to str, Ability.DEX to dex),
    levels = (1..levels).map { level ->
        LevelRecord(level, "class.fighter", level, feats = if (level == 1) feats.map { FeatChoice(it) } else emptyList())
    },
    activeToggles = toggles,
)

private fun num(n: Long, d: Long = 1): Value = Value.Num(Fraction.of(n, d))

class ResolverTest {

    @Test
    fun nonStackingTypesKeepTheHighestAndUntypedStacks() {
        val c = catalog(
            entity("item.a", add("save.fort", 4, "enhancement")),
            entity("item.b", add("save.fort", 6, "enhancement")),
            entity("feat.c", add("save.fort", 2)),
            entity("feat.d", add("save.fort", 3)),
        )
        val session = Engine(c).session(character(feats = listOf("item.a", "item.b", "feat.c", "feat.d")))
        assertEquals(num(11), session.sheet.values["save.fort"])
        val suppressed = session.explain("save.fort")!!.lines.single { it.status != Status.APPLIED }
        assertEquals("item.a", suppressed.source)
        assertEquals(Status.NOT_STACKING, suppressed.status)
        assertEquals("item.b", suppressed.suppressedBy)
    }

    @Test
    fun penaltiesAlwaysSum() {
        val c = catalog(
            entity("feat.a", add("save.ref", -2, "enhancement")),
            entity("feat.b", add("save.ref", -3, "enhancement")),
        )
        assertEquals(num(-5), Engine(c).compute(character(feats = listOf("feat.a", "feat.b"))).values["save.ref"])
    }

    @Test
    fun theSameSpellCastTwiceCountsOnce() {
        val c = catalog(entity("spell.blessing", add("save.fort", 2, "luck"), add("save.fort", 3, "untyped")))
        val toggles = listOf(
            ToggleChoice("toggle.blessing", spell = "spell.blessing"),
            ToggleChoice("toggle.blessing_again", spell = "spell.blessing"),
        )
        // One source: +2 luck and +3 untyped once each. Its two effects stack by their types.
        assertEquals(num(5), Engine(c).compute(character(toggles = toggles)).values["save.fort"])
    }

    @Test
    fun effectsOfOneEntityFollowTheTypeRules() {
        val c = catalog(entity("spell.x", add("save.ref", 2, "enhancement"), add("save.ref", 4, "enhancement"), add("save.ref", 1)))
        val session = Engine(c).session(character(feats = listOf("spell.x")))
        assertEquals(num(5), session.sheet.values["save.ref"], "enhancement keeps its highest, untyped adds")
        assertEquals(
            listOf(Status.NOT_STACKING, Status.APPLIED, Status.APPLIED),
            session.explain("save.ref")!!.lines.map { it.status },
        )
    }

    @Test
    fun additiveThenMultiplicativeMultipliers() {
        val c = catalog(
            entity("feat.a", op("spell.x", Op.MULTIPLY, 2, mode = MultMode.Additive)),
            entity("feat.b", op("spell.x", Op.MULTIPLY, 2, mode = MultMode.Additive)),
            entity("feat.c", op("spell.x", Op.MULTIPLY, 2, mode = MultMode.Multiplicative)),
            statistics = listOf(stat("spell.x", 10)),
        )
        // x2 and x2 additive give x3, then x2 multiplicative: x6.
        assertEquals(num(60), Engine(c).compute(character(feats = listOf("feat.a", "feat.b", "feat.c"))).values["spell.x"])
    }

    @Test
    fun exclusiveGroupKeepsTheHighest() {
        val amplify = MultMode.Exclusive("metamagic_amplify")
        val c = catalog(
            entity("feat.empower", op("spell.x", Op.MULTIPLY, Fraction.of(3, 2), mode = amplify)),
            entity("feat.superspell", op("spell.x", Op.MULTIPLY, 4, mode = amplify)),
            entity("power.primum", op("spell.x", Op.MULTIPLY, 3, mode = MultMode.Multiplicative)),
            statistics = listOf(stat("spell.x", 420)),
        )
        val session = Engine(c).session(character(feats = listOf("feat.empower", "feat.superspell", "power.primum")))
        // Meteorite: Empower loses to Superspell, then Primum: x4 x3 = x12.
        assertEquals(num(5040), session.sheet.values["spell.x"])
        val empower = session.explain("spell.x")!!.lines.single { it.source == "feat.empower" }
        assertEquals(Status.EXCLUSIVE_LOWER, empower.status)
        assertEquals("feat.superspell", empower.suppressedBy)
    }

    @Test
    fun setLayers() {
        val form = entity("power.form", op("save.ref", Op.SET, 8, layer = Layer.BASE))
        val bonus = entity("item.a", add("save.ref", 2, "enhancement"))
        val bigger = entity("power.bigger_form", op("save.ref", Op.SET, 12, layer = Layer.BASE))
        val override = entity("power.override", op("save.ref", Op.SET, 50, layer = Layer.FINAL))
        val c = catalog(form, bonus, bigger, override)

        // Base-layer set replaces the start, bonuses still add on top; the highest base set wins.
        val engine = Engine(c)
        assertEquals(num(14), engine.compute(character(feats = listOf("power.form", "item.a", "power.bigger_form"))).values["save.ref"])

        // A final-layer set ignores everything before it, which stays visible as replaced.
        val session = engine.session(character(feats = listOf("power.form", "item.a", "power.override")))
        assertEquals(num(50), session.sheet.values["save.ref"])
        assertEquals(
            listOf("power.form" to Status.REPLACED, "item.a" to Status.REPLACED, "power.override" to Status.APPLIED),
            session.explain("save.ref")!!.lines.map { it.source to it.status },
        )
    }

    @Test
    fun floorsAndCaps() {
        val c = catalog(
            entity("item.armor", op("ac.dex_bonus", Op.MAX, 3)),
            entity("item.other_armor", op("ac.dex_bonus", Op.MAX, 5)),
            entity("feat.floor", op("ac.dex_bonus", Op.MIN, 1)),
        )
        val session = Engine(c).session(character(dex = 30, feats = listOf("item.armor", "item.other_armor", "feat.floor")))
        assertEquals(num(3), session.sheet.values["ac.dex_bonus"])
        assertEquals(
            listOf(Status.APPLIED, Status.NOT_BINDING, Status.APPLIED, Status.NOT_BINDING),
            session.explain("ac.dex_bonus")!!.lines.map { it.status },
        )
    }

    @Test
    fun roundingHappensOnceAtTheEnd() {
        val c = catalog(
            statistics = listOf(
                stat("bab.epic", "0.5 * 39", round = false),
                stat("bab.total", "20 + @bab.epic"),
                stat("half", "1 / 2"),
            ),
        )
        val sheet = Engine(c).compute(character())
        assertEquals(num(39, 2), sheet.values["bab.epic"])
        assertEquals(num(39), sheet.values["bab.total"])
        assertEquals(num(0), sheet.values["half"])
    }

    @Test
    fun componentsAndDice() {
        // Two-handed: only the Strength part of damage is multiplied by 1.5.
        val c = catalog(
            entity("power.two_handed", op("damage.melee.ability", Op.MULTIPLY, Fraction.of(3, 2), mode = MultMode.Additive)),
            entity("spell.divine_favor", add("damage.melee", 2, "luck")),
            entity("item.flaming", op("damage.melee", Op.DICE, "1d6 fire")),
        )
        val session = Engine(c).session(character(str = 18, feats = listOf("power.two_handed", "spell.divine_favor", "item.flaming")))
        val damage = (session.sheet.values["damage.melee"] as Value.Dice).value
        assertEquals("2d6 + 1d6 fire + 8 (~18)", damage.describe())
        assertEquals(
            listOf("damage.melee.weapon", "damage.melee.ability", "spell.divine_favor", "item.flaming"),
            session.explain("damage.melee")!!.lines.map { it.source },
        )
    }

    @Test
    fun groupsAndFamilies() {
        val c = catalog(
            entity("item.cloak", add("save.all", 3, "resistance")),
            entity("feat.fort", add("save.fort", 1, "resistance")),
            entity("feat.spell_focus_abjuration", add("dc.school[abjuration]", 1)),
            entity("feat.spell_mastery", add("dc.school[*]", 2)),
            statistics = listOf(stat("dc.school[*]", 10), stat("dc.example", "@dc.school[evocation]")),
        )
        val sheet = Engine(c).compute(character(feats = listOf("item.cloak", "feat.fort", "feat.spell_focus_abjuration", "feat.spell_mastery")))
        assertEquals(num(3), sheet.values["save.fort"], "resistance does not stack")
        assertEquals(num(3), sheet.values["save.ref"])
        assertEquals(num(13), sheet.values["dc.school[abjuration]"])
        assertEquals(num(12), sheet.values["dc.school[evocation]"])
    }

    @Test
    fun conditionsTogglesAndSituations() {
        val c = catalog(
            entity("feat.power_attack", add("attack.melee", "-@toggle.power_attack.value", condition = "active('toggle.power_attack')")),
            entity("spell.protection_from_evil", add("save.fort", 2, "resistance", situation = "situation.vs_evil")),
        )
        val feats = listOf("feat.power_attack", "spell.protection_from_evil")
        val engine = Engine(c)
        assertEquals(num(1), engine.compute(character(feats = feats)).values["attack.melee"])

        val on = character(feats = feats, toggles = listOf(ToggleChoice("toggle.power_attack", value = Fraction.of(5))))
        val session = engine.session(on)
        assertEquals(num(-4), session.sheet.values["attack.melee"])
        assertEquals(num(0), session.sheet.values["save.fort"], "situational bonuses are never in the total")
        assertEquals(Status.SITUATIONAL, session.explain("save.fort")!!.lines.single().status)
    }

    @Test
    fun repeatCount() {
        val c = catalog(entity("feat.spell_improvement", add("caster_level", "4 * count('feat.spell_improvement')")))
        val feats = List(5) { "feat.spell_improvement" }
        assertEquals(num(20), Engine(c).compute(character(feats = feats)).values["caster_level"])
    }

    @Test
    fun raisingAnAbilityPropagates() {
        val engine = Engine(catalog())
        val session = engine.session(character(str = 10))
        assertEquals(num(1), session.sheet.values["attack.melee"])

        val update = session.update(character(str = 18))
        assertEquals(num(5), update.sheet.values["attack.melee"])
        assertEquals(
            setOf("ability.str.score", "ability.str.mod", "attack.melee", "damage.melee.ability", "damage.melee"),
            update.changed,
        )
        assertEquals(update.changed, update.recomputed, "nothing else is recomputed")
    }

    @Test
    fun togglingRecomputesOnlyWhatItTouches() {
        val c = catalog(entity("spell.bulls_strength", add("ability.str.score", 4, "enhancement", condition = "active('toggle.bulls_strength')")))
        val session = Engine(c).session(character(str = 18))
        val bull = ToggleChoice("toggle.bulls_strength", spell = "spell.bulls_strength")

        val on = session.update(character(str = 18, toggles = listOf(bull)))
        assertEquals(num(22), on.sheet.values["ability.str.score"])
        assertEquals(
            setOf("ability.str.score", "ability.str.mod", "attack.melee", "damage.melee.ability", "damage.melee"),
            on.recomputed,
        )
        val off = session.update(character(str = 18))
        assertEquals(num(18), off.sheet.values["ability.str.score"])
        assertEquals(on.recomputed, off.recomputed)
        assertTrue("ability.dex.score" !in off.recomputed)
    }

    @Test
    fun levelChangesReachLevelFormulas() {
        val session = Engine(catalog()).session(character(levels = 5))
        val update = session.update(character(levels = 6))
        assertEquals(num(6), update.sheet.values["bab"])
        assertEquals(setOf("bab", "attack.melee"), update.recomputed)
    }

    @Test
    fun cyclesAreReportedNotFatal() {
        val c = catalog(
            statistics = listOf(stat("loop.a", "@loop.b + 1"), stat("loop.b", "@loop.a + 1"), stat("fine", 7)),
        )
        val sheet = Engine(c).compute(character())
        assertNull(sheet.values["loop.a"])
        assertNull(sheet.values["loop.b"])
        assertEquals(num(7), sheet.values["fine"])
        val cycle = sheet.issues.single { it.code == SheetIssue.Code.CYCLE }
        assertTrue("Cycle: loop.a -> loop.b -> loop.a" in cycle.message, cycle.message)
    }

    @Test
    fun aCycleThroughAnEffectDropsOnlyThatEffect() {
        // An effect on Strength that reads attack, which reads Strength: the effect is dropped, Strength still counts.
        val c = catalog(
            entity("feat.loop", add("ability.str.score", "@attack.melee")),
            entity("feat.fine", add("ability.str.score", 2)),
        )
        val sheet = Engine(c).compute(character(str = 10, feats = listOf("feat.loop", "feat.fine")))
        assertEquals(num(12), sheet.values["ability.str.score"])
        assertTrue(sheet.issues.any { it.code == SheetIssue.Code.CYCLE && it.statistic == "attack.melee" }, sheet.issues.toString())
    }

    @Test
    fun badEffectsAreSkippedAndReported() {
        val c = catalog(
            entity("feat.typo", add("save.fort", "@abilty.con.mod")),
            entity("feat.text", add("save.fort", "'swift'")),
            entity("feat.fine", add("save.fort", 2)),
        )
        val sheet = Engine(c).compute(character(feats = listOf("feat.typo", "feat.text", "feat.fine")))
        assertEquals(num(2), sheet.values["save.fort"])
        assertEquals(
            listOf(
                SheetIssue.Code.FORMULA_ERROR to "feat.typo/effects[0]",
                SheetIssue.Code.INVALID_VALUE to "feat.text/effects[0]",
            ),
            sheet.issues.map { it.code to it.source },
        )
    }

    @Test
    fun diceAverageOfTheWholeStatistic() {
        val dice = DiceValue.of(2, 6) + Fraction.of(8)
        assertEquals(Fraction.of(15), dice.average)
    }
}
