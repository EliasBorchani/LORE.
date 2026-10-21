package dndtools.engine.resolve

import dndtools.engine.formula.BinaryOp
import dndtools.engine.formula.Expr
import dndtools.engine.formula.Formula
import dndtools.engine.formula.ParseResult
import dndtools.engine.formula.Value
import dndtools.engine.math.Fraction
import dndtools.engine.model.Catalog
import dndtools.engine.model.Effect
import dndtools.engine.model.EffectScope
import dndtools.engine.model.EffectValue
import dndtools.engine.model.Entity
import dndtools.engine.model.InitiatingDef
import dndtools.engine.model.Op
import dndtools.engine.model.ProgressionRow
import dndtools.engine.model.SkillInfo
import dndtools.engine.model.SpellcastingDef
import dndtools.engine.model.StatisticDef

internal sealed interface CompiledValue {
    class Const(val value: Value) : CompiledValue
    class Expr(val formula: Formula) : CompiledValue
}

internal class CompiledDef(val def: StatisticDef, val base: CompiledValue?, val diceSteps: CompiledValue? = null)

internal class CompiledEffect(
    val entityId: String,
    val index: Int,
    val effect: Effect,
    val value: CompiledValue,
    val condition: Formula?,
) {
    val ref = "$entityId/effects[$index]"
}

/** A prerequisite split on its top-level `and`, so a failure names the part that failed. */
internal class CompiledPrerequisite(val entityId: String, val parts: List<Formula>)

/**
 * The catalog with every formula parsed once and effects indexed by the statistic they target.
 *
 * Spell variants: an effect scoped to `spell` targets the statistics of each spell variant, keyed
 * `variant[<spell id>].<target>` (`variant[spell.bulls_strength].spell.numeric`).
 */
internal class CompiledCatalog(val catalog: Catalog) {
    val issues = ArrayList<SheetIssue>()
    val stacks: Map<String, Boolean> = catalog.bonusTypes.associate { it.id to it.stacks }

    private val entities = catalog.entities.associateBy { it.id }
    private val defs = HashMap<String, CompiledDef>()
    private val effectsByTarget = HashMap<String, MutableList<CompiledEffect>>()
    private val spellEffectsByTarget = HashMap<String, MutableList<CompiledEffect>>()
    private val progressions = catalog.progressions.groupBy { it.classId }.mapValues { (_, rows) -> rows.sortedBy { it.level } }
    private val classGrants = HashMap<String, MutableList<Pair<Int, String>>>()
    private val entityGrants = HashMap<String, MutableList<String>>()
    val prerequisites = ArrayList<CompiledPrerequisite>()

    /** Effects whose target depends on the character's choice for their entity: `caster_level.class[{choice}]`. */
    val choiceEffects = ArrayList<CompiledEffect>()

    /** Entity id to the toggles its effects read (`active('toggle.power_attack')`, `@toggle.power_attack.value`). */
    val togglesByEntity = LinkedHashMap<String, LinkedHashSet<String>>()

    /** Entity id to its uses per day, for the entities that have some. */
    val dailyUses = LinkedHashMap<String, CompiledValue>()

    /** Entity id to the maximum of the value picked at the table, for the entities that have one. */
    val tableMax = LinkedHashMap<String, CompiledValue>()

    /** Entities whose effects apply once per take (`repeatable`). */
    val repeatable = HashSet<String>()

    /**
     * Entities applied to one variant by choice: metamagic that costs slot levels (`spell.slot_cost`) and the team's
     * free variant modifiers (label `spell modifier`). Other entities the character has with spell-scoped effects
     * (Improved Metamagic, Arcane Reach) apply to every spell the character casts.
     */
    val perVariantModifiers = HashSet<String>()

    /** Classes that cast spells, with how. */
    val casters: Map<String, SpellcastingDef> =
        catalog.entities.mapNotNull { e -> e.spellcasting?.let { e.id to it } }.toMap()

    /** Classes and feats (Martial Study) that give maneuvers, with their key ability. */
    val initiators: Map<String, InitiatingDef> =
        catalog.entities.mapNotNull { e -> e.initiating?.let { e.id to it } }.toMap()

    /** Class or feat id to the disciplines it may learn maneuvers from, from `initiates` relations. */
    private val disciplines: Map<String, List<String>> = catalog.relations
        .filter { it.relation == INITIATES }
        .groupBy({ it.from }, { it.to })

    /** Skills (entities with a `skill` block): their statistic key is their id. */
    val skills: Map<String, SkillInfo> = catalog.entities.mapNotNull { e -> e.skill?.let { e.id to it } }.toMap()

    /** Entity id (a class, a domain) to the skills it makes class skills, from `class_skill` relations. */
    private val classSkills: Map<String, Set<String>> = catalog.relations
        .filter { it.relation == CLASS_SKILL }
        .groupBy({ it.from }, { it.to })
        .mapValues { (_, skills) -> skills.toSet() }

    /** (spell, class) to the spell's level on that class's list, from `on_spell_list` relations that give one. */
    private val spellLevels: Map<Pair<String, String>, Int> = catalog.relations
        .filter { it.relation == ON_SPELL_LIST && it.level != null }
        .associate { (it.from to it.to) to it.level!! }

    /** Every concrete statistic of the sheet. Fixed for a catalog, whatever the character. */
    val keys: Set<String>

    /** Targets a spell variant has (`variant[<id>].<target>`); variants are computed only when something reads them. */
    private val variantTargets: Set<String>

    init {
        val refs = HashSet<String>()
        fun compile(source: String, at: String): CompiledValue? = when (val r = Formula.parse(source)) {
            is ParseResult.Ok -> CompiledValue.Expr(r.formula).also { refs += r.formula.statRefs }
            is ParseResult.Error -> {
                issues += SheetIssue(SheetIssue.Code.FORMULA_ERROR, source = at, message = "'$source': ${r.message}")
                null
            }
        }
        fun compile(value: EffectValue, at: String): CompiledValue? = when (value) {
            is EffectValue.Number -> CompiledValue.Const(Value.Num(value.value))
            is EffectValue.Text -> compile(value.text, at)
        }

        for (def in catalog.statistics) {
            val base = def.base?.let { compile(it, "statistics:${def.key}") }
            if (def.base != null && base == null) continue
            val steps = def.diceSteps?.let { compile(it, "statistics:${def.key}/diceSteps") }
            if (def.diceSteps != null && steps == null) continue
            defs[def.key] = CompiledDef(def, base, steps)
        }

        // Built-in statistics of each casting class, unless the catalog writes its own (Danalieth's caster levels).
        for ((classId, casting) in casters) {
            val short = classId.removePrefix("class.")
            fun define(key: String, formula: String) {
                if (key in defs) return
                val base = compile(formula, "spellcasting:$classId") ?: return
                defs[key] = CompiledDef(StatisticDef(key, EffectValue.Text(formula)), base)
            }
            define("caster_level.${casting.kind}", "0")
            define("caster_level.class[*]", "0")
            define(
                "caster_level.$short",
                "level('$classId') + @spellcasting.advances[$classId] + @caster_level.${casting.kind} + @caster_level.class[$classId]",
            )
            define("slots.above_max[$classId]", "0")
            val mod = "@ability.${casting.ability.name.lowercase()}.mod"
            val max = "@slots.max_base[$classId]"
            for (level in 0..MAX_SPELL_LEVEL) {
                val base = "@slots.base[$classId:$level]"
                // Slots above the table's maximum form a ladder: one slot at each level max+1, max+2…
                val extra = "($max >= 0 and $level > $max and $level - $max <= @slots.above_max[$classId])"
                // SRD bonus spells, at every level the character can cast: ⌊(mod − L) / 4⌋ + 1 when mod ≥ L.
                val bonus = if (level == 0) "0" else "if(($base >= 0 or $extra) and $mod >= $level, floor(($mod - $level) / 4) + 1, 0)"
                define("slots.$short[$level]", "max($base, 0) + if($extra, 1, 0) + $bonus")
            }
        }

        fun define(key: String, formula: String, at: String) {
            if (key in defs) return
            val base = compile(formula, at) ?: return
            defs[key] = CompiledDef(StatisticDef(key, EffectValue.Text(formula)), base)
        }
        // Built-in statistics of each initiator (Tome of Battle). A class's initiator level is its levels + half the
        // other levels, and its counts are its table columns; a feat (Martial Study) uses the character's initiator
        // level and gets its counts from effects. Highest maneuver level: half the initiator level, rounded up, at
        // most 9. `initiator_level`, read by maneuver formulas (« +1 per initiator level »), is the highest of the
        // classes', or half the character level without any.
        if (initiators.isNotEmpty()) {
            define("initiator_level.class[*]", "0", "initiating")
            define(STANCES_ACTIVE_MAX, "1", "initiating")
        }
        val classLevels = ArrayList<String>()
        for (id in initiators.keys) {
            val short = initiatorKey(id)
            val at = "initiating:$id"
            val isClass = entities[id]?.type in CLASS_TYPES
            if (isClass) {
                define("initiator_level.$short", "level('$id') + floor((level() - level('$id')) / 2) + @initiator_level.class[$id]", at)
                classLevels += "@initiator_level.$short"
            } else {
                define("initiator_level.$short", "@$INITIATOR_LEVEL", at)
            }
            define("maneuvers.max_level.$short", "min(9, ceil(@initiator_level.$short / 2))", at)
            for (column in listOf("known", "readied", "stances")) {
                define("maneuvers.$column.$short", if (isClass) "max(@maneuvers.$column.base[$id], 0)" else "0", at)
            }
        }
        if (initiators.isNotEmpty()) {
            define(INITIATOR_LEVEL, (listOf("floor(level() / 2)") + classLevels).let { if (it.size == 1) it[0] else "max(${it.joinToString()})" }, "initiating")
        }

        // Built-in skill statistics, unless the catalog writes its own: ranks + ability modifier + armor check penalty,
        // and the maximum ranks (level + 3 for a class skill, half that otherwise).
        if (skills.isNotEmpty()) {
            define(ARMOR_CHECK_PENALTY, "0", "skills")
            define(SKILL_POINTS_TOTAL, "max(level(), @$SKILL_POINTS_CLASSES + @ability.int.mod * (level() + 3))", "skills")
        }
        for ((id, skill) in skills) {
            val penalty = if (skill.armorCheckPenalty != 0L) " + ${skill.armorCheckPenalty} * @$ARMOR_CHECK_PENALTY" else ""
            define(id, "@$id.ranks + @ability.${skill.ability.name.lowercase()}.mod$penalty", "skill:$id")
            define("$id.max_ranks", "if(@$id.class_skill == 1, level() + 3, floor((level() + 3) / 2))", "skill:$id")
        }

        val groups = catalog.targetGroups.associate { it.key to it.members }
        for (entity in catalog.entities) {
            entity.effects.forEachIndexed { index, effect ->
                if (effect.op == Op.GRANT) return@forEachIndexed
                val at = "${entity.id}/effects[$index]"
                val value = compile(effect.value, at) ?: return@forEachIndexed
                val condition = effect.condition?.let {
                    (compile(it, at) as? CompiledValue.Expr ?: return@forEachIndexed).formula
                }
                val compiled = CompiledEffect(entity.id, index, effect, value, condition)
                val formulas = listOfNotNull(condition, (value as? CompiledValue.Expr)?.formula)
                val toggles = formulas.flatMap { formula ->
                    formula.toggleRefs + formula.statRefs.mapNotNull { (CharacterState.inputFor(it) as? Input.ToggleValue)?.toggleId }
                }
                if (toggles.isNotEmpty()) togglesByEntity.getOrPut(entity.id) { LinkedHashSet() } += toggles
                // Item-scoped effects apply to the wielded weapon, whose statistics are `weapon.*` on the sheet.
                // One wielded weapon for the spike; several weapons need one scope per item.
                if (CHOICE in effect.target) {
                    choiceEffects += compiled
                    return@forEachIndexed
                }
                if (effect.scope == EffectScope.SPELL && (effect.target == SLOT_COST || SPELL_MODIFIER in entity.labels)) {
                    perVariantModifiers += entity.id
                }
                val byTarget = if (effect.scope == EffectScope.SPELL) spellEffectsByTarget else effectsByTarget
                for (target in groups[effect.target] ?: listOf(effect.target)) {
                    byTarget.getOrPut(target) { ArrayList() } += compiled
                }
            }
            entity.usesPerDay?.let { uses ->
                compile(uses, "${entity.id}/usesPerDay")?.let { dailyUses[entity.id] = it }
            }
            if (entity.repeatable != null) repeatable += entity.id
            entity.tableValue?.let { value ->
                compile(value.max, "${entity.id}/tableValue.max")?.let { tableMax[entity.id] = it }
            }
            entity.prerequisite?.let { source ->
                val formula = (compile(source, "${entity.id}/prerequisite") as? CompiledValue.Expr)?.formula
                if (formula != null) prerequisites += CompiledPrerequisite(entity.id, conjuncts(formula.expr).map(Formula::of))
            }
        }

        for (row in catalog.progressions) {
            row.grants.forEach { classGrants.getOrPut(row.classId) { ArrayList() } += row.level to it }
        }
        for (relation in catalog.relations.filter { it.relation == "grants" }) {
            if (entities[relation.from]?.type in CLASS_TYPES) {
                classGrants.getOrPut(relation.from) { ArrayList() } += (relation.level ?: 1) to relation.to
            } else {
                entityGrants.getOrPut(relation.from) { ArrayList() } += relation.to
            }
        }

        val all = HashSet<String>()
        all += defs.keys
        all += defs.values.flatMap { it.def.components }
        all += effectsByTarget.keys
        all += refs.filter { familyKey(it)?.let { f -> f in defs || f in effectsByTarget } == true }
        keys = all.filterTo(HashSet()) { !it.endsWith("[*]") && CharacterState.inputFor(it) == null }

        variantTargets = spellEffectsByTarget.keys + BUILT_IN_SPELL_TARGETS
    }

    /** Level of [spellId] on [classId]'s list, or null when the catalog does not place it there. */
    fun spellLevel(spellId: String, classId: String): Int? = spellLevels[spellId to classId]

    fun entity(id: String): Entity? = entities[id]

    /** Disciplines [classId] may learn maneuvers from. */
    fun disciplines(classId: String): List<String> = disciplines[classId].orEmpty()

    /** Skills [entityId] makes class skills; `skill.knowledge` stands for every Knowledge field. */
    fun classSkills(entityId: String): Set<String> = classSkills[entityId].orEmpty()

    fun progression(classId: String): List<ProgressionRow> = progressions[classId].orEmpty()

    /** (class level, entity) pairs: what the class gives and from which class level. */
    fun classGrants(classId: String): List<Pair<Int, String>> = classGrants[classId].orEmpty()

    fun entityGrants(entityId: String): List<String> = entityGrants[entityId].orEmpty()

    fun exists(key: String) = key in keys || parseVariant(key)?.second in variantTargets

    fun definition(key: String): CompiledDef? {
        parseVariant(key)?.let { (_, target) ->
            return when (target) {
                // A variant's multiplier on numeric effects starts at x1 and is not rounded.
                SPELL_NUMERIC -> NUMERIC_DEF
                SPELL_SLOT_LEVEL -> SLOT_LEVEL_DEF
                else -> null
            }
        }
        return defs[key] ?: familyKey(key)?.let { defs[it] }
    }

    fun effectsFor(key: String): List<CompiledEffect> {
        parseVariant(key)?.let { (_, target) -> return spellEffectsByTarget[target].orEmpty() }
        val own = effectsByTarget[key].orEmpty()
        val family = familyKey(key)?.let { effectsByTarget[it] }.orEmpty()
        return if (family.isEmpty()) own else own + family
    }

    companion object {
        const val CHOICE = "{choice}"
        const val SPELL_NUMERIC = "spell.numeric"
        const val SPELL_CASTER_LEVEL = "spell.caster_level"
        /** The spell's level on its caster class's list. */
        const val SPELL_LEVEL = "spell.level"
        /** The slot the variant needs: spell level + metamagic cost. */
        const val SPELL_SLOT_LEVEL = "spell.slot_level"
        const val SPELL_DC = "spell.dc"
        const val SPELL_METAMAGIC_COUNT = "spell.metamagic_count"
        const val ON_SPELL_LIST = "on_spell_list"
        const val CLASS_SKILL = "class_skill"
        const val INITIATES = "initiates"
        const val INITIATOR_LEVEL = "initiator_level"
        /** How many stances can be active at once: 1, more with Stance Mastery. */
        const val STANCES_ACTIVE_MAX = "stances.active_max"

        /** The key of an initiator's statistics: `class.warblade` → `warblade`, `feat.martial_study` → `martial_study`. */
        fun initiatorKey(id: String) = id.substringAfter('.')
        const val ARMOR_CHECK_PENALTY = "armor.check_penalty"
        const val SKILL_POINTS_TOTAL = "skill_points.total"
        /** Input: each level's class skill points, ×4 at character level 1. */
        const val SKILL_POINTS_CLASSES = "skill_points.classes"
        /** Input: ranks bought, 1 point per rank in a class skill, 2 otherwise. */
        const val SKILL_POINTS_SPENT = "skill_points.spent"
        /** Slot levels computed per casting class: 0 to this, enough for epic slots above the table's 9th. */
        const val MAX_SPELL_LEVEL = 30
        private const val SLOT_COST = "spell.slot_cost"
        private const val SPELL_MODIFIER = "spell modifier"
        private val BUILT_IN_SPELL_TARGETS = setOf(
            SPELL_NUMERIC, SPELL_CASTER_LEVEL, SPELL_LEVEL, SPELL_SLOT_LEVEL, SPELL_DC, SPELL_METAMAGIC_COUNT,
            SLOT_COST, "spell.slot_cost_per_modifier",
        )
        private val CLASS_TYPES = setOf("class", "prestige_class")
        // A closing ']' must be escaped in every pattern: JavaScript (unicode mode) rejects a lone one.
        private val VARIANT = Regex("variant\\[(.+?)\\]\\.(.+)")
        private val NUMERIC_DEF = CompiledDef(
            StatisticDef(SPELL_NUMERIC, round = false),
            CompiledValue.Const(Value.Num(Fraction.ONE)),
        )

        /**
         * Each modifier costs its feat's slot levels, minus Improved Metamagic's reduction per modifier, and always at
         * least one level: the total never drops below the number of modifiers.
         */
        private const val SLOT_LEVEL_FORMULA =
            "@spell.level + max(@spell.metamagic_count, @spell.slot_cost + @spell.metamagic_count * @spell.slot_cost_per_modifier)"
        private val SLOT_LEVEL_DEF = CompiledDef(
            StatisticDef(SPELL_SLOT_LEVEL, EffectValue.Text(SLOT_LEVEL_FORMULA)),
            CompiledValue.Expr((Formula.parse(SLOT_LEVEL_FORMULA) as ParseResult.Ok).formula),
        )

        fun variantKey(spellId: String, target: String) = "variant[$spellId].$target"

        /** `variant[spell.x].spell.damage` to (`spell.x`, `spell.damage`). */
        fun parseVariant(key: String): Pair<String, String>? =
            VARIANT.matchEntire(key)?.let { it.groupValues[1] to it.groupValues[2] }

        /** `dc.school[abjuration]` belongs to the family `dc.school[*]`. */
        fun familyKey(key: String): String? {
            val open = key.indexOf('[')
            if (open < 0 || !key.endsWith("]") || key.endsWith("[*]")) return null
            return key.substring(0, open) + "[*]"
        }

        private fun conjuncts(e: Expr): List<Expr> =
            if (e is Expr.Binary && e.op == BinaryOp.AND) conjuncts(e.left) + conjuncts(e.right) else listOf(e)
    }
}
