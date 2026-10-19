package dndtools.engine.model

import dndtools.engine.formula.Formula
import dndtools.engine.formula.ParseResult
import dndtools.engine.resolve.SizeDice
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** A problem in the data. Reported, never thrown: the engine keeps computing what it can. */
@Serializable
data class ModelIssue(
    val code: Code,
    /** Where the problem is, e.g. `entity:spell.force_of_nature/effects[0]`. */
    val at: String,
    val message: String,
) {
    @Serializable
    enum class Code {
        @SerialName("duplicate_id") DUPLICATE_ID,
        @SerialName("unknown_reference") UNKNOWN_REFERENCE,
        @SerialName("unknown_bonus_type") UNKNOWN_BONUS_TYPE,
        @SerialName("missing_bonus_type") MISSING_BONUS_TYPE,
        @SerialName("missing_mult_mode") MISSING_MULT_MODE,
        @SerialName("missing_layer") MISSING_LAYER,
        @SerialName("level_order") LEVEL_ORDER,
        @SerialName("class_level_mismatch") CLASS_LEVEL_MISMATCH,
        @SerialName("invalid_formula") INVALID_FORMULA,
        @SerialName("unknown_damage_type") UNKNOWN_DAMAGE_TYPE,
        @SerialName("missing_hit_die") MISSING_HIT_DIE,
    }
}

/** Checks on the data before any computation: structure, references, and that every formula parses. */
object ModelCheck {
    private val CLASS_TYPES = setOf("class", "prestige_class")

    fun catalog(catalog: Catalog): List<ModelIssue> = buildList {
        duplicates(catalog.bonusTypes.map { it.id }, "bonusTypes")
        duplicates(catalog.damageTypes.map { it.id }, "damageTypes")
        duplicates(catalog.entities.map { it.id }, "entities")
        duplicates(catalog.rules.map { it.id }, "rules")

        val bonusTypes = catalog.bonusTypes.mapTo(HashSet()) { it.id }
        val damageTypes = catalog.damageTypes.mapTo(HashSet()) { it.id }
        val entityIds = catalog.entities.mapTo(HashSet()) { it.id }

        catalog.damageTypes.forEach { type ->
            type.parts.filter { it !in damageTypes }.forEach {
                add(ModelIssue(ModelIssue.Code.UNKNOWN_DAMAGE_TYPE, "damageTypes:${type.id}", "Unknown part '$it'"))
            }
        }

        fun formula(at: String, source: String) {
            when (val result = Formula.parse(source)) {
                is ParseResult.Error -> add(
                    ModelIssue(
                        ModelIssue.Code.INVALID_FORMULA, at,
                        "'$source': ${result.message} (at character ${result.position + 1})",
                    )
                )
                is ParseResult.Ok -> result.formula.diceTypes.filter { it !in damageTypes }.forEach {
                    add(ModelIssue(ModelIssue.Code.UNKNOWN_DAMAGE_TYPE, at, "Unknown damage type '$it'"))
                }
            }
        }

        duplicates(catalog.statistics.map { it.key }, "statistics")
        duplicates(catalog.targetGroups.map { it.key }, "targetGroups")
        for (def in catalog.statistics) {
            (def.base as? EffectValue.Text)?.let { formula("statistics:${def.key}/base", it.text) }
            (def.diceSteps as? EffectValue.Text)?.let { formula("statistics:${def.key}/diceSteps", it.text) }
        }
        for ((direction, steps) in listOf("up" to catalog.diceSteps.up, "down" to catalog.diceSteps.down)) {
            for ((from, to) in steps) {
                listOf(from, to).filter { SizeDice.parse(it) == null }.forEach {
                    add(ModelIssue(ModelIssue.Code.INVALID_FORMULA, "diceSteps:$direction:$from", "'$it' is not <count>d<size> or a whole number"))
                }
            }
        }

        for (entity in catalog.entities) {
            if (entity.type in CLASS_TYPES && entity.hitDie == null) {
                add(ModelIssue(ModelIssue.Code.MISSING_HIT_DIE, "entity:${entity.id}", "A class needs a hit die"))
            }
            entity.prerequisite?.let { formula("entity:${entity.id}/prerequisite", it) }
            (entity.usesPerDay as? EffectValue.Text)?.let { formula("entity:${entity.id}/usesPerDay", it.text) }
            entity.effects.forEachIndexed { i, effect ->
                val at = "entity:${entity.id}/effects[$i]"
                (effect.value as? EffectValue.Text)?.let { formula("$at.value", it.text) }
                effect.condition?.let { formula("$at.condition", it) }
                when (effect.op) {
                    Op.ADD -> when (val type = effect.bonusType) {
                        null -> add(ModelIssue(ModelIssue.Code.MISSING_BONUS_TYPE, at, "'add' needs a bonus type"))
                        !in bonusTypes -> add(
                            ModelIssue(ModelIssue.Code.UNKNOWN_BONUS_TYPE, at, "Unknown bonus type '$type'")
                        )
                    }
                    Op.MULTIPLY -> if (effect.multMode == null) {
                        add(ModelIssue(ModelIssue.Code.MISSING_MULT_MODE, at, "'multiply' needs an explicit mode"))
                    }
                    Op.SET -> if (effect.layer == null) {
                        add(ModelIssue(ModelIssue.Code.MISSING_LAYER, at, "'set' needs a layer (base or final)"))
                    }
                    else -> Unit
                }
            }
        }

        catalog.progressions.forEachIndexed { i, row ->
            if (row.classId !in entityIds) unknown("progressions[$i]", row.classId)
            row.grants.forEachIndexed { j, id -> if (id !in entityIds) unknown("progressions[$i].grants[$j]", id) }
        }
        catalog.relations.forEachIndexed { i, relation ->
            if (relation.from !in entityIds) unknown("relations[$i].from", relation.from)
            if (relation.to !in entityIds) unknown("relations[$i].to", relation.to)
        }
    }

    fun character(character: Character, catalog: Catalog): List<ModelIssue> = buildList {
        val entityIds = catalog.entities.mapTo(HashSet()) { it.id }
        fun ref(at: String, id: String?) {
            if (id != null && id !in entityIds) unknown(at, id)
        }

        ref("race", character.race)

        val classLevels = HashMap<String, Int>()
        character.levels.forEachIndexed { i, record ->
            val at = "levels[$i]"
            if (record.level != i + 1) {
                add(ModelIssue(ModelIssue.Code.LEVEL_ORDER, at, "Record $i is level ${record.level}, expected ${i + 1}"))
            }
            ref("$at.classId", record.classId)
            val classLevel = (classLevels[record.classId] ?: 0) + 1
            classLevels[record.classId] = classLevel
            if (record.classLevel != classLevel) {
                add(
                    ModelIssue(
                        ModelIssue.Code.CLASS_LEVEL_MISMATCH, at,
                        "${record.classId} level ${record.classLevel} recorded, $classLevel from the record order",
                    )
                )
            }
            record.feats.forEachIndexed { j, feat -> ref("$at.feats[$j]", feat.id) }
            record.gained.forEachIndexed { j, id -> ref("$at.gained[$j]", id) }
            record.spellcastingAdvances.forEachIndexed { j, id -> ref("$at.spellcastingAdvances[$j]", id) }
        }

        character.items.forEachIndexed { i, item -> ref("items[$i]", item.id) }
        character.choices.forEach { (entity, option) ->
            ref("choices.$entity", entity)
            ref("choices.$entity", option)
        }
        character.spellcasting.keys.forEach { ref("spellcasting.$it", it) }
        character.activeToggles.forEachIndexed { i, toggle ->
            ref("activeToggles[$i].spell", toggle.spell)
            ref("activeToggles[$i].entity", toggle.entity)
            ref("activeToggles[$i].casterClass", toggle.casterClass)
            toggle.metamagic.forEachIndexed { j, id -> ref("activeToggles[$i].metamagic[$j]", id) }
        }
    }

    private fun MutableList<ModelIssue>.duplicates(ids: List<String>, at: String) {
        ids.groupingBy { it }.eachCount().filterValues { it > 1 }.keys.forEach {
            add(ModelIssue(ModelIssue.Code.DUPLICATE_ID, at, "'$it' is defined more than once"))
        }
    }

    private fun MutableList<ModelIssue>.unknown(at: String, id: String) {
        add(ModelIssue(ModelIssue.Code.UNKNOWN_REFERENCE, at, "Unknown entity '$id'"))
    }
}
