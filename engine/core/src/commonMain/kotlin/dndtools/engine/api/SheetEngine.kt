@file:OptIn(ExperimentalJsExport::class)

package dndtools.engine.api

import dndtools.engine.Engine
import dndtools.engine.formula.Value
import dndtools.engine.json.EngineJson
import dndtools.engine.math.Fraction
import dndtools.engine.model.Character
import dndtools.engine.model.InvocationGrade
import dndtools.engine.model.ManeuverKind
import dndtools.engine.model.SavedForm
import dndtools.engine.model.SpellVariant
import dndtools.engine.model.ToggleChoice
import dndtools.engine.resolve.BreakdownLine
import dndtools.engine.resolve.CompiledCatalog
import dndtools.engine.resolve.Forms
import dndtools.engine.resolve.Session
import kotlin.js.ExperimentalJsExport
import kotlin.js.JsExport

/**
 * The engine as the apps see it: JSON in, plain objects out, exported to JavaScript (TypeScript types are generated)
 * and to Swift. Numbers cross the boundary as text, because a JavaScript number is a floating-point double and the
 * engine's values are exact fractions.
 */
@JsExport
class SheetEngine(catalogJson: String) {
    private val engine = Engine(EngineJson.decodeCatalog(catalogJson))

    /** The sheet of a character. [atLevel] 0 means every level the character has. */
    fun open(characterJson: String, atLevel: Int = 0): CharacterSheet =
        CharacterSheet(engine, EngineJson.decodeCharacter(characterJson), atLevel.takeIf { it > 0 })
}

/** A live sheet. Switching a toggle recomputes only what it touches. */
@JsExport
class CharacterSheet internal constructor(private val engine: Engine, private var character: Character, private val atLevel: Int?) {
    private val session: Session = engine.session(character, atLevel)

    /** Toggle choices seen so far, so a toggle switched off and on again keeps its spell, metamagic and value. */
    private val knownToggles = character.activeToggles.associateByTo(LinkedHashMap()) { it.toggle }

    val name: String get() = character.name
    val level: Int get() = session.sheet.atLevel

    val statistics: List<StatLine>
        get() = session.sheet.values.map { (key, value) -> StatLine(key, text(value)) }

    val issues: List<String>
        get() = session.sheet.issues.map { listOfNotNull(it.statistic, it.source).joinToString(" ") + ": " + it.message }

    /** Toggles the character can switch: the ones on the character, then those their entities' conditions read. */
    val toggles: List<ToggleLine>
        get() {
            val active = character.activeToggles.mapTo(HashSet()) { it.toggle }
            val read = session.toggleSources()
            val known = knownToggles.values.filter { it.form == null }.map {
                val source = it.spell ?: it.entity ?: read[it.toggle]
                ToggleLine(it.toggle, it.toggle in active, it.value?.toString(), source, maxValue(source))
            }
            val others = read.filterKeys { it !in knownToggles }.map { (id, source) -> ToggleLine(id, false, null, source, maxValue(source)) }
            return known + others
        }

    private fun maxValue(source: String?): String? = source?.let(session::tableMax)?.let(::text)

    /** Uses per day of the character's powers (wards, Kaleidoscopic Doom), as exact text. */
    val dailyUses: List<DailyUse>
        get() = session.dailyUses().map { (entity, uses) -> DailyUse(entity, uses?.let(::text)) }

    /**
     * Each casting class the character has: caster level, slots and spells known per spell level (from 0 up to the
     * highest level with a slot), save DC per level, and the spells the character knows for it.
     */
    val spellcasting: List<CasterLine>
        get() = engine.casters.filterKeys { classId -> character.levels.any { it.classId == classId } }.map { (classId, def) ->
            val short = classId.removePrefix("class.")
            val ability = def.ability.name.lowercase()
            val modifier = (session.sheet.values["ability.$ability.mod"] as? Value.Num)?.value ?: Fraction.ZERO
            val levels = 0..CompiledCatalog.MAX_SPELL_LEVEL
            val slots = levels.map { (session.sheet.values["slots.$short[$it]"] as? Value.Num)?.value ?: Fraction.ZERO }
            val highest = levels.lastOrNull { slots[it].signum() > 0 || session.spellTable(classId, false, it) >= 0 } ?: -1
            val shown = 0..highest
            val choice = character.spellcasting[classId]
            CasterLine(
                classId = classId,
                ability = ability,
                kind = def.kind,
                mode = (choice?.mode ?: def.mode).name.lowercase(),
                casterLevel = statistic("caster_level.$short")?.text,
                slots = shown.map { slots[it].toString() },
                known = shown.map { level -> session.spellTable(classId, true, level).takeIf { it >= 0 }?.toString() },
                saveDcs = shown.map { (Fraction.of(10L + it) + modifier).toString() },
                spells = choice?.known.orEmpty(),
            )
        }

    /**
     * Each initiator the character has (a class, or a feat such as Martial Study): initiator level, highest maneuver
     * level, its counts, the disciplines it may learn from, the maneuvers and stances learned through it, and what
     * breaks the rules.
     */
    val initiators: List<InitiatorLine>
        get() {
            val levels = character.levels.let { if (atLevel == null) it else it.take(atLevel) }
            val had = engine.initiators.filterKeys { id -> levels.any { it.classId == id } || session.isSource(id) }
            val allKnown = session.knownManeuvers()
            return had.map { (classId, def) ->
                val short = CompiledCatalog.initiatorKey(classId)
                val known = character.maneuvers[classId]?.known.orEmpty()
                val infos = known.associateWith { engine.entity(it)?.maneuver }
                val (stances, maneuvers) = known.partition { infos[it]?.kind == ManeuverKind.STANCE }
                val disciplines = engine.disciplines(classId)
                val maxLevel = number("maneuvers.max_level.$short")
                val issues = buildList {
                    for (id in known) {
                        val info = infos[id]
                        when {
                            info == null -> add(ManeuverIssue(id, "unknown"))
                            info.discipline !in disciplines -> add(ManeuverIssue(id, "discipline"))
                            maxLevel != null && info.level > maxLevel -> add(ManeuverIssue(id, "level"))
                            else -> {
                                val sameDiscipline = allKnown.count { it != id && engine.entity(it)?.maneuver?.discipline == info.discipline }
                                if (sameDiscipline < info.requires) add(ManeuverIssue(id, "requires"))
                            }
                        }
                    }
                    number("maneuvers.known.$short")?.let { if (maneuvers.size > it) add(ManeuverIssue(null, "too_many")) }
                    number("maneuvers.stances.$short")?.let { if (stances.size > it) add(ManeuverIssue(null, "too_many_stances")) }
                }
                InitiatorLine(
                    classId = classId,
                    ability = def.ability?.name?.lowercase(),
                    initiatorLevel = statistic("initiator_level.$short")?.text,
                    maxManeuverLevel = statistic("maneuvers.max_level.$short")?.text,
                    maneuversKnown = statistic("maneuvers.known.$short")?.text,
                    maneuversReadied = statistic("maneuvers.readied.$short")?.text,
                    stancesKnown = statistic("maneuvers.stances.$short")?.text,
                    disciplines = disciplines,
                    maneuvers = maneuvers,
                    stances = stances,
                    issues = issues,
                )
            }
        }

    /**
     * Each invoker class the character has (Warlock): invoker level, invocations known and the highest grade it may
     * learn (`least` … `dark`, null before the first), the invocations learned, and what breaks the rules.
     */
    val invokers: List<InvokerLine>
        get() {
            val levels = character.levels.let { if (atLevel == null) it else it.take(atLevel) }
            return engine.invokers.filterKeys { id -> levels.any { it.classId == id } }.map { (classId, def) ->
                val short = CompiledCatalog.initiatorKey(classId)
                val known = character.invocations[classId]?.known.orEmpty()
                val maxGrade = number("invocations.max_grade.$short")?.toInt() ?: 0
                val issues = buildList {
                    for (id in known) {
                        val info = engine.entity(id)?.invocation
                        when {
                            info == null -> add(InvocationIssue(id, "unknown"))
                            info.grade.ordinal + 1 > maxGrade -> add(InvocationIssue(id, "grade"))
                        }
                    }
                    number("invocations.known.$short")?.let { if (known.size > it) add(InvocationIssue(null, "too_many")) }
                }
                InvokerLine(
                    classId = classId,
                    ability = def.ability?.name?.lowercase(),
                    invokerLevel = statistic("invoker_level.$short")?.text,
                    invocationsKnown = statistic("invocations.known.$short")?.text,
                    maxGrade = InvocationGrade.entries.getOrNull(maxGrade - 1)?.name?.lowercase(),
                    invocations = known,
                    issues = issues,
                )
            }
        }

    private fun number(key: String): Long? = (session.sheet.values[key] as? Value.Num)?.value?.floor()

    /** Every skill of the catalog with the character's ranks, maximum ranks and total. */
    val skills: List<SkillLine>
        get() = engine.skills.map { (id, info) ->
            SkillLine(
                id = id,
                ability = info.ability.name.lowercase(),
                ranks = session.skillRanks(id).toString(),
                maxRanks = statistic("$id.max_ranks")?.text,
                classSkill = session.isClassSkill(id),
                trainedOnly = info.trainedOnly,
                armorCheckPenalty = info.armorCheckPenalty > 0,
                total = statistic(id)?.text,
            )
        }

    /** Skill points: the budget and what the ranks cost (2 per rank outside class skills). */
    val skillPoints: SkillPoints
        get() = SkillPoints(statistic(CompiledCatalog.SKILL_POINTS_TOTAL)?.text, session.skillPointsSpent().toString())

    /**
     * Feat slots by type (`general`, `epic`, `fighter_bonus`…): how many the sheet gives (`feat_slots.<type>`) and how
     * many feats the level records put in them (a feat without a slot counts as `general`).
     */
    val featSlots: List<FeatSlotLine>
        get() {
            val levels = character.levels.let { if (atLevel == null) it else it.take(atLevel) }
            val used = levels.flatMap { it.feats }.groupingBy { it.slot ?: GENERAL_SLOT }.eachCount()
            val available = session.sheet.values.keys.filter { it.startsWith(FEAT_SLOTS) }.associate { key ->
                key.removePrefix(FEAT_SLOTS) to (statistic(key)?.text ?: "0")
            }
            return (available.keys + used.keys).sorted().map { slot ->
                FeatSlotLine(slot, available[slot] ?: "0", used[slot] ?: 0)
            }
        }

    /** The character's saved variants with their slot level, DC and main numbers. */
    val variants: List<VariantLine>
        get() = character.variants.map { variantLine(session, it) }

    /** A variant as it would be if saved, without changing this sheet: for the « Nouvelle variante » builder. */
    fun previewVariant(variantJson: String): VariantLine {
        val variant = EngineJson.decode(SpellVariant.serializer(), variantJson)
        val preview = engine.session(character.copy(variants = character.variants.filter { it.id != variant.id } + variant), atLevel)
        return variantLine(preview, variant)
    }

    private fun variantLine(session: Session, variant: SpellVariant): VariantLine {
        fun value(target: String) = session.variantStatistic(variant.id, target)?.let(::text)
        return VariantLine(
            id = variant.id,
            spell = variant.spell,
            casterClass = variant.casterClass,
            metamagic = variant.metamagic,
            heighten = maxOf(variant.heighten, 0),
            level = value(CompiledCatalog.SPELL_LEVEL)?.takeIf { it != "-1" },
            slotLevel = value(CompiledCatalog.SPELL_SLOT_LEVEL)?.takeIf { value(CompiledCatalog.SPELL_LEVEL) != "-1" },
            casterLevel = value(CompiledCatalog.SPELL_CASTER_LEVEL),
            saveDc = value(CompiledCatalog.SPELL_DC),
            numbers = VARIANT_NUMBERS.mapNotNull { target ->
                value(target)?.takeIf { it != "0" && !(target == CompiledCatalog.SPELL_NUMERIC && it == "1") }?.let { StatLine(target, it) }
            },
        )
    }

    /** The character's saved forms, each advanced as far as the creature and its source allow (or as chosen). */
    val forms: List<FormLine>
        get() = character.forms.map { formLine(session, it) }

    /** The form the character is in, with its natural attacks; null in its own form. */
    val activeForm: FormLine?
        get() = session.activeForm?.let { formLine(session, it) }

    /** Turns the character into a saved form, or back into itself with null. Returns the statistics that changed. */
    fun setForm(formId: String?): List<String> {
        knownToggles.remove(FORM_TOGGLE)
        val others = character.activeToggles.filter { it.form == null }
        val toggles = if (formId == null) others else others + ToggleChoice(FORM_TOGGLE, form = formId)
        return update(character.copy(activeToggles = toggles))
    }

    /** A form as it would be if saved and taken, without changing this sheet: for the transformation builder. */
    fun previewForm(formJson: String): FormPreview {
        val form = EngineJson.decode(SavedForm.serializer(), formJson)
        val next = character.copy(
            forms = character.forms.filter { it.id != form.id } + form,
            activeToggles = character.activeToggles.filter { it.form == null } + ToggleChoice(FORM_TOGGLE, form = form.id),
        )
        val preview = engine.session(next, atLevel)
        val stats = FORM_PREVIEW_STATS.mapNotNull { key -> preview.sheet.values[key]?.let { StatLine(key, text(it)) } }
        return FormPreview(formLine(preview, form), stats)
    }

    private fun formLine(session: Session, form: SavedForm): FormLine {
        val creature = engine.entity(form.creature)?.creature
        val shaping = engine.entity(form.source)?.shaping
        val active = session.activeForm?.id == form.id && session.formCreature != null
        if (creature == null || shaping == null) {
            return FormLine(form.id, form.name, form.creature, form.source, active, null, null, null, null, null, null, null, null, 0, 0,
                canCast = true, issues = listOf("unknown"), naturalAttacks = emptyList())
        }
        val limit = (session.shapingLimit(form.source, "maxHd") as? Value.Num)?.value?.floor()?.toInt()
        val most = listOfNotNull(Forms.maxHitDice(creature), limit, form.hitDice).min()
        val hitDice = maxOf(most, creature.hitDice)
        val shape = Forms.shape(creature, hitDice, form.abilityIncreases, engine.sizeChanges)
        val kinds = shaping.kinds + engine.shapers.filter { (id, def) -> def.extends == form.source && session.isSource(id) }.values.flatMap { it.kinds }
        fun sizeLimit(name: String) = (session.shapingLimit(form.source, name) as? Value.Text)?.value?.let(Forms::steps)
        val steps = Forms.steps(shape.size)
        val issues = buildList {
            if (engine.entity(form.source)?.type != "spell" && !session.isSource(form.source)) add("not_had")
            if (kinds.isNotEmpty() && creature.kind !in kinds) add("kind_not_allowed")
            if (limit != null && creature.hitDice > limit) add("too_many_hd")
            if (steps != null && (sizeLimit("minSize")?.let { steps < it } == true || sizeLimit("maxSize")?.let { steps > it } == true)) add("size_not_allowed")
            if (shape.unspent > 0) add("unspent")
            if (shape.extra > 0) add("too_many_increases")
            if (shape.missingSizes.isNotEmpty()) add("size_changes_missing")
        }
        val casting = shaping.castingFeat
        val attacks = if (!active) emptyList() else creature.attacks.take(CompiledCatalog.MAX_NATURAL_ATTACKS).mapIndexed { i, attack ->
            val n = i + 1
            NaturalAttackLine(
                id = attack.id, count = attack.count, primary = attack.primary,
                attackKey = "natural.$n.attack", damageKey = "natural.$n.damage",
                attack = session.sheet.values["natural.$n.attack"]?.let(::text),
                damage = session.sheet.values["natural.$n.damage"]?.let(::text),
            )
        }
        return FormLine(
            id = form.id, name = form.name, creature = form.creature, source = form.source, active = active,
            hitDice = hitDice.toString(),
            maxHitDice = maxOf(listOfNotNull(Forms.maxHitDice(creature), limit).min(), creature.hitDice).toString(),
            size = shape.size,
            str = shape.abilities[dndtools.engine.model.Ability.STR]?.toString(),
            dex = shape.abilities[dndtools.engine.model.Ability.DEX]?.toString(),
            con = shape.abilities[dndtools.engine.model.Ability.CON]?.toString(),
            naturalArmor = shape.naturalArmor.toString(),
            kind = creature.kind,
            abilityPoints = Forms.abilityPoints(creature, hitDice),
            unspent = shape.unspent,
            canCast = casting == null || session.isSource(casting),
            issues = issues,
            naturalAttacks = attacks,
        )
    }

    /** Prerequisites of what the character has that are not met or cannot be checked. The choices are kept. */
    val prerequisites: List<PrerequisiteLine>
        get() = session.sheet.prerequisites.map { PrerequisiteLine(it.entity, it.failed, it.unknown) }

    fun statistic(key: String): StatLine? = session.sheet.values[key]?.let { StatLine(key, text(it)) }

    fun explain(key: String): List<BreakdownRow> = session.explain(key)?.lines.orEmpty().map { line ->
        BreakdownRow(
            step = line.step.name.lowercase(),
            source = line.source,
            value = text(line.value),
            status = line.status.name.lowercase(),
            bonusType = line.bonusType,
            detail = listOfNotNull(
                line.suppressedBy?.let { "beaten by $it" },
                line.situation,
                line.modifiers.takeIf { it.isNotEmpty() }?.joinToString(" + "),
            ).joinToString("; "),
            suppressedBy = line.suppressedBy,
            situation = line.situation,
            modifiers = line.modifiers,
        )
    }

    /** Switches a toggle and returns the keys of the statistics whose value changed. */
    fun setToggle(toggleId: String, active: Boolean): List<String> {
        val others = character.activeToggles.filter { it.toggle != toggleId }
        val toggles = if (active) others + (knownToggles[toggleId] ?: ToggleChoice(toggleId)) else others
        return update(character.copy(activeToggles = toggles))
    }

    /**
     * Switches on a toggle described in full, as JSON in the character format (`{"toggle", "spell", "metamagic",
     * "casterClass", "value"}`): a buff the character's build lists but that is off at the table.
     */
    fun setToggleChoice(toggleJson: String): List<String> {
        val choice = EngineJson.decode(ToggleChoice.serializer(), toggleJson)
        knownToggles[choice.toggle] = choice
        return update(character.copy(activeToggles = character.activeToggles.filter { it.toggle != choice.toggle } + choice))
    }

    /** Sets the value a toggle carries (Power Attack's penalty), given as an exact number in text: `5`, `1/2`. */
    fun setToggleValue(toggleId: String, value: String): List<String> {
        val choice = (knownToggles[toggleId] ?: ToggleChoice(toggleId)).copy(value = Fraction.parse(value))
        knownToggles[toggleId] = choice
        val toggles = character.activeToggles.map { if (it.toggle == toggleId) choice else it }
        return update(character.copy(activeToggles = toggles))
    }

    private fun update(next: Character): List<String> {
        character = next
        return session.update(next, atLevel).changed.sorted()
    }

    private fun text(value: Value): String = when (value) {
        // Exact decimal when there is one (25.5), otherwise the fraction (1/3).
        is Value.Num -> value.value.toDecimalString() ?: value.value.toString()
        is Value.Dice -> value.value.describe()
        is Value.Bool -> value.value.toString()
        is Value.Text -> value.value
    }
}

private const val FEAT_SLOTS = "feat_slots."
/** The toggle that holds the active form; the web app keeps it in play state like any other toggle. */
const val FORM_TOGGLE = "toggle.form"

/** What the transformation builder compares before and after. */
private val FORM_PREVIEW_STATS = listOf(
    "size", "ability.str.score", "ability.dex.score", "ability.con.score", "ac.total", "ac.natural", "hp.max",
    "attack.melee", "speed.land", "speed.fly", "speed.swim", "speed.climb", "speed.burrow",
)
private const val GENERAL_SLOT = "general"

/** Variant statistics worth showing when the spell or its metamagic changes them. */
private val VARIANT_NUMBERS = listOf(
    "spell.damage", "spell.healing", "spell.healing_per_round", "spell.duration", "spell.range", "spell.area.radius",
    "spell.action", "spell.save", "spell.caster_level_vs_sr", CompiledCatalog.SPELL_NUMERIC,
)

@JsExport
data class StatLine(val key: String, val text: String)

/** One casting class. Lists are indexed by spell level from 0; `known` is null at levels with « — ». */
@JsExport
data class CasterLine(
    val classId: String,
    val ability: String,
    val kind: String,
    /** `prepared`, `spontaneous` or `free_slots`. */
    val mode: String,
    val casterLevel: String?,
    val slots: List<String>,
    val known: List<String?>,
    val saveDcs: List<String>,
    /** Spells known or in the spellbook. */
    val spells: List<String>,
)

/**
 * One initiator: a class, or a feat that gives maneuvers ([classId] is then the feat's id). Counts are exact text.
 * Save DCs are written in each maneuver, which names its own ability.
 */
@JsExport
data class InitiatorLine(
    val classId: String,
    /** The class's key ability, when it has one. */
    val ability: String?,
    val initiatorLevel: String?,
    val maxManeuverLevel: String?,
    val maneuversKnown: String?,
    val maneuversReadied: String?,
    val stancesKnown: String?,
    val disciplines: List<String>,
    val maneuvers: List<String>,
    val stances: List<String>,
    val issues: List<ManeuverIssue>,
)

/** One invoker class (Warlock). Counts are exact text; [maxGrade] is `least`, `lesser`, `greater` or `dark`. */
@JsExport
data class InvokerLine(
    val classId: String,
    /** The class's key ability, when it has one. */
    val ability: String?,
    val invokerLevel: String?,
    val invocationsKnown: String?,
    val maxGrade: String?,
    val invocations: List<String>,
    val issues: List<InvocationIssue>,
)

/**
 * A learned invocation that breaks a rule: `unknown` (not an invocation of the catalog), `grade` (above the highest
 * grade the class reached); or, with no [entity], `too_many` (more than the table and effects give).
 */
@JsExport
data class InvocationIssue(val entity: String?, val code: String)

/**
 * A learned maneuver that breaks a rule: `unknown` (not a maneuver of the catalog), `discipline` (the class does not
 * initiate it), `level` (above the highest level), `requires` (too few known of its discipline); or, with no
 * [entity], `too_many` / `too_many_stances` (more than the table gives).
 */
@JsExport
data class ManeuverIssue(val entity: String?, val code: String)

@JsExport
data class VariantLine(
    val id: String,
    val spell: String,
    val casterClass: String,
    val metamagic: List<String>,
    /** Levels added by Heighten Spell, included in [level]. */
    val heighten: Int,
    /** The spell's level on the caster class's list plus [heighten]; null when it is not on that list. */
    val level: String?,
    /** The slot it needs: level + metamagic cost. */
    val slotLevel: String?,
    val casterLevel: String?,
    val saveDc: String?,
    /** Damage, healing, duration, range… as exact text, only those the spell has. */
    val numbers: List<StatLine>,
)

/**
 * [source]: the entity the toggle belongs to (its spell, or the feat whose effects read it), to show its name.
 * [maxValue]: the highest value the player may pick, when the source declares a `tableValue`.
 */
@JsExport
data class ToggleLine(val id: String, val active: Boolean, val value: String?, val source: String?, val maxValue: String? = null)

/**
 * A saved form, computed. Numbers are text; [str], [dex], [con] are null when the creature has none. [issues]:
 * `unknown` (creature or source missing), `not_had` (the character lacks the source), `kind_not_allowed`,
 * `too_many_hd` (the creature's own hit dice are above the source's limit), `size_not_allowed`, `unspent` (ability
 * points not placed), `too_many_increases`, `size_changes_missing` (the catalog's `sizeChanges` lacks a size crossed).
 */
@JsExport
data class FormLine(
    val id: String,
    val name: String?,
    val creature: String,
    val source: String,
    val active: Boolean,
    val hitDice: String?,
    /** The most hit dice the creature and the source allow. */
    val maxHitDice: String?,
    val size: String?,
    val str: String?,
    val dex: String?,
    val con: String?,
    val naturalArmor: String?,
    val kind: String?,
    /** +1 ability points the extra hit dice give, and how many are not placed. */
    val abilityPoints: Int,
    val unspent: Int,
    /** False when the source needs a feat to cast in the form (Natural Spell) and the character lacks it. */
    val canCast: Boolean,
    val issues: List<String>,
    /** Only for the active form: its attacks as the sheet computes them. */
    val naturalAttacks: List<NaturalAttackLine>,
)

/** A natural attack of the active form; [attackKey] and [damageKey] open their breakdown. */
@JsExport
data class NaturalAttackLine(
    val id: String,
    val count: Int,
    val primary: Boolean,
    val attackKey: String,
    val damageKey: String,
    val attack: String?,
    val damage: String?,
)

/** A form in the builder: its line and the main statistics of the sheet with the form taken. */
@JsExport
data class FormPreview(val form: FormLine, val stats: List<StatLine>)

@JsExport
data class DailyUse(val entity: String, val uses: String?)

@JsExport
data class SkillLine(
    val id: String,
    val ability: String,
    val ranks: String,
    val maxRanks: String?,
    val classSkill: Boolean,
    /** Needs at least one rank to be used. */
    val trainedOnly: Boolean,
    val armorCheckPenalty: Boolean,
    val total: String?,
)

@JsExport
data class SkillPoints(val total: String?, val spent: String)

@JsExport
data class FeatSlotLine(val slot: String, val available: String, val used: Int)

@JsExport
data class PrerequisiteLine(val entity: String, val failed: List<String>, val unknown: List<String>)

@JsExport
data class BreakdownRow(
    val step: String,
    val source: String,
    val value: String,
    /** `applied`, or why it did not count: `not_stacking`, `replaced`, `situational`... */
    val status: String,
    val bonusType: String?,
    /** [suppressedBy], [situation] and [modifiers] in one English line, for quick displays. */
    val detail: String,
    /** The source that won instead of this line. */
    val suppressedBy: String? = null,
    /** Situation id when the line applies only then (`situation.vs_evil`). */
    val situation: String? = null,
    /** Metamagic applied to the spell this line comes from. */
    val modifiers: List<String> = emptyList(),
)
