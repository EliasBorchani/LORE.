package dndtools.engine.resolve

import dndtools.engine.math.Fraction
import dndtools.engine.model.Ability
import dndtools.engine.model.Character

/**
 * A fact read from the character's choices rather than from another statistic. The resolver records the inputs each
 * statistic read, so after a change it recomputes only the statistics whose inputs changed.
 */
internal sealed interface Input {
    data class Level(val classId: String?) : Input
    data class Count(val entityId: String) : Input
    data class Active(val toggleId: String) : Input
    data class ToggleValue(val toggleId: String) : Input
    data class AbilityBase(val ability: Ability) : Input
    data class Progression(val stat: String) : Input
    data object HitDice : Input
    data object Xp : Input
    data class Advances(val classId: String) : Input
    data class CasterClass(val variantId: String) : Input

    /** A cell of a class's spells-per-day (or spells-known) column at the class's casting level; −1 for « — ». */
    data class SpellTable(val classId: String, val known: Boolean, val level: Int) : Input

    /** Highest spell level the class's table gives a slot for at its casting level; −1 when none. */
    data class MaxSpellLevel(val classId: String) : Input

    /** Level of a variant's spell on its caster class's list; −1 when the spell is not on it. */
    data class SpellLevel(val variantId: String) : Input
    data class MetamagicCount(val variantId: String) : Input
    data class SkillRanks(val skillId: String) : Input

    /** 1 when an entity the character has (a class, a domain) makes the skill a class skill, else 0. */
    data class ClassSkill(val skillId: String) : Input
    data object ClassSkillPoints : Input
    data object SkillPointsSpent : Input
}

/** A spell as the character casts it: from a saved variant, or from a toggle naming a spell and its metamagic. */
internal data class VariantDef(val spell: String, val casterClass: String?, val metamagic: List<String>, val heighten: Int = 0)

/** The character's choices replayed up to one level, with what the catalog derives from them directly. */
internal class CharacterState(character: Character, atLevel: Int?, private val catalog: CompiledCatalog) {
    private val records = if (atLevel == null) character.levels else character.levels.take(atLevel)
    val characterLevel = records.size
    private val classLevels = records.groupingBy { it.classId }.eachCount()
    private val toggles = character.activeToggles.associateBy { it.toggle }
    private val xp = character.xp
    private val abilityBases = Ability.entries.associateWith { ability ->
        (character.baseAbilities[ability] ?: 0) + records.count { it.abilityIncrease == ability }
    }

    /**
     * Variant id to what it casts. Saved variants keep their own id; a toggle naming a spell directly is the variant
     * whose id is the spell id (how Danalieth's buffs are written).
     */
    private val variants: Map<String, VariantDef> = buildMap {
        for (v in character.variants) put(v.id, VariantDef(v.spell, v.casterClass, v.metamagic, maxOf(v.heighten, 0)))
        for (toggle in character.activeToggles) {
            val spell = toggle.spell ?: continue
            if (toggle.variant == null && spell !in this) put(spell, VariantDef(spell, toggle.casterClass, toggle.metamagic))
        }
    }

    /** Spell id to the variant an active toggle casts. The same spell on two toggles is one source: the first counts. */
    private val spellVariants: Map<String, String> = buildMap {
        for (toggle in character.activeToggles) {
            val variantId = toggle.variant ?: toggle.spell ?: continue
            val spell = variants[variantId]?.spell ?: continue
            if (spell !in this) put(spell, variantId)
        }
    }

    private val skillRanks: Map<String, Long> = buildMap {
        putAll(character.skillRanks)
        for (record in records) record.skillRanks.forEach { (skill, ranks) -> put(skill, (get(skill) ?: 0) + ranks) }
    }

    /** Entities whose effects apply, with how many times the character has each one. */
    private val sources: Map<String, Int> = buildMap {
        fun add(id: String?) {
            if (id != null) put(id, (get(id) ?: 0) + 1)
        }
        add(character.race)
        classLevels.keys.forEach(::add)
        for (record in records) {
            record.feats.forEach { add(it.id) }
            record.gained.forEach(::add)
        }
        character.items.filter { it.equipped }.forEach { add(it.id) }
        // A skill with ranks is had, so its synergy effects (Tumble 5 ranks: +2 Balance) can apply.
        skillRanks.filter { it.value > 0 }.keys.forEach(::add)
        spellVariants.keys.forEach(::add)
        character.activeToggles.forEach { add(it.entity) }
        for ((classId, level) in classLevels) {
            catalog.classGrants(classId).filter { it.first <= level }.forEach { add(it.second) }
        }
        // Entities granted by other entities (a template's powers), until nothing new appears.
        val queue = ArrayDeque(keys)
        while (queue.isNotEmpty()) {
            for (granted in catalog.entityGrants(queue.removeFirst())) {
                if (granted !in this) {
                    add(granted)
                    queue += granted
                }
            }
        }
    }

    private val choices = character.choices

    fun isSource(entityId: String) = entityId in sources

    fun choice(entityId: String): String? = choices[entityId]

    /** The variant an active toggle casts [spellId] as, when the spell is on the sheet. */
    fun variantOfSpell(spellId: String): String? = spellVariants[spellId]

    fun metamagic(variantId: String): List<String> = variants[variantId]?.metamagic.orEmpty()

    /** Effects on a spell variant come from the spell itself and from its metamagic. */
    fun isVariantSource(variantId: String, entityId: String): Boolean {
        val variant = variants[variantId] ?: return false
        return entityId == variant.spell || entityId in variant.metamagic
    }

    fun read(input: Input): Any = when (input) {
        is Input.Level -> if (input.classId == null) characterLevel.toLong() else (classLevels[input.classId] ?: 0).toLong()
        is Input.Count -> (sources[input.entityId] ?: 0).toLong()
        is Input.Active -> input.toggleId in toggles
        is Input.ToggleValue -> toggles[input.toggleId]?.value ?: Fraction.ZERO
        is Input.AbilityBase -> abilityBases.getValue(input.ability)
        is Input.Progression -> progression(input.stat)
        Input.HitDice -> records.sumOf { (catalog.entity(it.classId)?.hitDie ?: 0).toLong() }
        Input.Xp -> xp
        is Input.Advances -> records.count { input.classId in it.spellcastingAdvances }.toLong()
        is Input.CasterClass -> variants[input.variantId]?.casterClass ?: ""
        is Input.SpellTable -> spellTable(input.classId, input.known)?.getOrNull(input.level)?.toLong() ?: -1L
        is Input.MaxSpellLevel -> spellTable(input.classId, known = false)?.indexOfLast { it != null }?.toLong() ?: -1L
        is Input.SpellLevel -> variants[input.variantId]
            ?.let { v -> v.casterClass?.let { catalog.spellLevel(v.spell, it) }?.plus(v.heighten) }?.toLong() ?: -1L
        is Input.MetamagicCount -> metamagic(input.variantId).size.toLong()
        is Input.SkillRanks -> skillRanks[input.skillId] ?: 0L
        is Input.ClassSkill -> if (isClassSkill(input.skillId)) 1L else 0L
        Input.ClassSkillPoints -> records.sumOf { record ->
            (catalog.entity(record.classId)?.skillPoints ?: 0L) * (if (record.level == 1) 4 else 1)
        }
        // Simplification: the cost follows today's class skills, not the ones the character had when buying.
        Input.SkillPointsSpent -> skillRanks.entries.sumOf { (skill, ranks) -> ranks * (if (isClassSkill(skill)) 1 else 2) }
    }

    fun skillRanks(skillId: String): Long = skillRanks[skillId] ?: 0L

    fun isClassSkill(skillId: String): Boolean = sources.keys.any { source ->
        val skills = catalog.classSkills(source)
        skillId in skills || (skillId.startsWith(KNOWLEDGE_FIELD) && KNOWLEDGE in skills)
    }

    /**
     * The class's column at its casting level: class levels plus the levels of other classes that advance it.
     * Past the last written row the last one holds, as for base attack.
     */
    private fun spellTable(classId: String, known: Boolean): List<Int?>? {
        val castingLevel = (classLevels[classId] ?: 0) + records.count { classId in it.spellcastingAdvances }
        if (castingLevel == 0) return null
        return catalog.progression(classId)
            .lastOrNull { it.level <= castingLevel && (if (known) it.spellsKnown else it.spellsPerDay).isNotEmpty() }
            ?.let { if (known) it.spellsKnown else it.spellsPerDay }
    }

    /**
     * Base attack or a save from the class tables. Levels gained up to the epic threshold read the class table
     * (running totals, the last written value holds past the end); each level after it gives the epic gain.
     * Fractions add up exactly and are rounded once, by the statistic that reads them.
     */
    private fun progression(stat: String): Fraction {
        val rules = catalog.catalog.progressionRules
        val epicAfter = rules.epicAfterLevel
        var total = Fraction.ZERO
        for (classId in classLevels.keys) {
            val tableLevel = records.count { it.classId == classId && (epicAfter == null || it.level <= epicAfter) }
            if (tableLevel == 0) continue
            val row = catalog.progression(classId)
                .lastOrNull { it.level <= tableLevel && tableValue(it, stat) != null }
            total += row?.let { tableValue(it, stat) } ?: Fraction.ZERO
        }
        if (epicAfter != null) {
            val perLevel = rules.epicPerLevel[stat] ?: Fraction.ZERO
            total += perLevel * records.count { it.level > epicAfter }.toLong()
        }
        return total
    }

    private fun tableValue(row: dndtools.engine.model.ProgressionRow, stat: String): Fraction? = when (stat) {
        "bab" -> row.bab
        "fort" -> row.fort
        "ref" -> row.ref
        "will" -> row.will
        else -> null
    }

    companion object {
        /** The optional ruleset slug of a homebrew id: `eberron:skill.airship_piloting`. */
        private const val SLUG = "(?:[a-z][a-z0-9_]*:)"
        private val ABILITY_BASE = Regex("ability\\.(str|dex|con|int|wis|cha)\\.base")
        private val TOGGLE_VALUE = Regex("($SLUG?toggle\\..+)\\.value")
        private val PROGRESSION = Regex("progression\\.(bab|fort|ref|will)")
        private val ADVANCES = Regex("spellcasting\\.advances\\[(.+)\\]")
        private val SLOTS_BASE = Regex("slots\\.base\\[(.+):(\\d+)\\]")
        private val KNOWN_BASE = Regex("spells_known\\.base\\[(.+):(\\d+)\\]")
        private val MAX_BASE = Regex("slots\\.max_base\\[(.+)\\]")
        private val SKILL_RANKS = Regex("($SLUG?skill\\..+)\\.ranks")
        private val CLASS_SKILL = Regex("($SLUG?skill\\..+)\\.class_skill")
        private const val KNOWLEDGE = "skill.knowledge"
        private const val KNOWLEDGE_FIELD = "skill.knowledge_"

        /**
         * Statistic keys that come straight from the choices: `ability.str.base`, `toggle.power_attack.value`,
         * `progression.bab`, `hit_dice.total`, `xp`, `spellcasting.advances[class.wizard]`, and the class table cells
         * `slots.base[class.bard:3]`, `spells_known.base[class.bard:3]`, `slots.max_base[class.bard]`.
         */
        fun inputFor(key: String): Input? {
            SLOTS_BASE.matchEntire(key)?.let { return Input.SpellTable(it.groupValues[1], false, it.groupValues[2].toInt()) }
            KNOWN_BASE.matchEntire(key)?.let { return Input.SpellTable(it.groupValues[1], true, it.groupValues[2].toInt()) }
            MAX_BASE.matchEntire(key)?.let { return Input.MaxSpellLevel(it.groupValues[1]) }
            ABILITY_BASE.matchEntire(key)?.let { m ->
                return Input.AbilityBase(Ability.entries.first { it.name.lowercase() == m.groupValues[1] })
            }
            TOGGLE_VALUE.matchEntire(key)?.let { return Input.ToggleValue(it.groupValues[1]) }
            PROGRESSION.matchEntire(key)?.let { return Input.Progression(it.groupValues[1]) }
            ADVANCES.matchEntire(key)?.let { return Input.Advances(it.groupValues[1]) }
            SKILL_RANKS.matchEntire(key)?.let { return Input.SkillRanks(it.groupValues[1]) }
            CLASS_SKILL.matchEntire(key)?.let { return Input.ClassSkill(it.groupValues[1]) }
            return when (key) {
                "hit_dice.total" -> Input.HitDice
                "xp" -> Input.Xp
                CompiledCatalog.SKILL_POINTS_CLASSES -> Input.ClassSkillPoints
                CompiledCatalog.SKILL_POINTS_SPENT -> Input.SkillPointsSpent
                else -> null
            }
        }
    }
}
