@file:OptIn(ExperimentalJsExport::class)

package dndtools.engine.api

import dndtools.engine.Engine
import dndtools.engine.formula.Value
import dndtools.engine.json.EngineJson
import dndtools.engine.math.Fraction
import dndtools.engine.model.Character
import dndtools.engine.model.SpellVariant
import dndtools.engine.model.ToggleChoice
import dndtools.engine.resolve.BreakdownLine
import dndtools.engine.resolve.CompiledCatalog
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
            val known = knownToggles.values.map {
                ToggleLine(it.toggle, it.toggle in active, it.value?.toString(), it.spell ?: it.entity ?: read[it.toggle])
            }
            val others = read.filterKeys { it !in knownToggles }.map { (id, source) -> ToggleLine(id, false, null, source) }
            return known + others
        }

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
            level = value(CompiledCatalog.SPELL_LEVEL)?.takeIf { it != "-1" },
            slotLevel = value(CompiledCatalog.SPELL_SLOT_LEVEL)?.takeIf { value(CompiledCatalog.SPELL_LEVEL) != "-1" },
            casterLevel = value(CompiledCatalog.SPELL_CASTER_LEVEL),
            saveDc = value(CompiledCatalog.SPELL_DC),
            numbers = VARIANT_NUMBERS.mapNotNull { target ->
                value(target)?.takeIf { it != "0" && !(target == CompiledCatalog.SPELL_NUMERIC && it == "1") }?.let { StatLine(target, it) }
            },
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

@JsExport
data class VariantLine(
    val id: String,
    val spell: String,
    val casterClass: String,
    val metamagic: List<String>,
    /** The spell's level on the caster class's list; null when it is not on that list. */
    val level: String?,
    /** The slot it needs: level + metamagic cost. */
    val slotLevel: String?,
    val casterLevel: String?,
    val saveDc: String?,
    /** Damage, healing, duration, range… as exact text, only those the spell has. */
    val numbers: List<StatLine>,
)

/** [source]: the entity the toggle belongs to (its spell, or the feat whose effects read it), to show its name. */
@JsExport
data class ToggleLine(val id: String, val active: Boolean, val value: String?, val source: String?)

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
