package dndtools.engine.resolve

import dndtools.engine.formula.DiceValue
import dndtools.engine.formula.EvalResult
import dndtools.engine.formula.FormulaEnv
import dndtools.engine.formula.StatUnavailable
import dndtools.engine.formula.Value
import dndtools.engine.math.Fraction
import dndtools.engine.model.Character
import dndtools.engine.model.Layer
import dndtools.engine.model.MultMode
import dndtools.engine.model.Op
import dndtools.engine.resolve.BreakdownLine.Status
import dndtools.engine.resolve.BreakdownLine.Step

/**
 * The sheet of one character, kept up to date across changes.
 *
 * Statistics are resolved on demand. Each one records the statistics and the character facts ([Input]) it read, so
 * [update] recomputes only the statistics whose inputs or effects changed, plus everything that depends on them.
 */
class Session internal constructor(
    private val compiled: CompiledCatalog,
    character: Character,
    private var atLevel: Int?,
) {
    private var state = CharacterState(character, atLevel, compiled)
    private val records = HashMap<String, StatRecord>()
    private val inProgress = LinkedHashSet<String>()
    private var recomputed = HashSet<String>()

    var sheet: Sheet = computeAll()
        private set

    fun explain(statistic: String): Breakdown? = records[statistic]?.breakdown

    fun update(character: Character, atLevel: Int? = this.atLevel): SheetUpdate {
        val next = CharacterState(character, atLevel, compiled)
        val dirty = records.filter { (key, record) ->
            record.inputs.any { (input, seen) -> next.read(input) != seen } ||
                activeEffects(key, next) != record.effects
        }.keys.toHashSet()

        val dependents = HashMap<String, MutableList<String>>()
        for ((key, record) in records) record.reads.forEach { dependents.getOrPut(it) { ArrayList() } += key }
        val queue = ArrayDeque(dirty)
        while (queue.isNotEmpty()) {
            dependents[queue.removeFirst()]?.forEach { if (dirty.add(it)) queue += it }
        }

        val before = sheet.values
        dirty.forEach(records::remove)
        state = next
        this.atLevel = atLevel
        sheet = computeAll()
        val changed = (before.keys + sheet.values.keys).filterTo(HashSet()) { before[it] != sheet.values[it] }
        return SheetUpdate(sheet, changed, recomputed)
    }

    private fun computeAll(): Sheet {
        recomputed = HashSet()
        for (key in compiled.keys.sorted()) resolve(key, reader = null)
        val values = LinkedHashMap<String, Value>()
        val issues = ArrayList(compiled.issues)
        issues += choiceIssues()
        for (key in compiled.keys.sorted()) {
            val record = records.getValue(key)
            record.value?.let { values[key] = it }
            issues += record.issues
        }
        return Sheet(state.characterLevel, values, issues.distinct(), checkPrerequisites())
    }

    /** Each prerequisite of what the character has, part by part. Met ones are left out. */
    private fun checkPrerequisites(): List<PrerequisiteResult> =
        compiled.prerequisites.filter { state.isSource(it.entityId) }.mapNotNull { prerequisite ->
            val frame = Frame("prerequisite:${prerequisite.entityId}")
            val failed = ArrayList<String>()
            val unknown = ArrayList<String>()
            for (part in prerequisite.parts) {
                when (val r = part.evaluate(frame)) {
                    is EvalResult.Ok -> if (r.value != Value.Bool(true)) failed += part.source
                    is EvalResult.Error -> unknown += "${part.source}: ${r.message}"
                }
            }
            if (failed.isEmpty() && unknown.isEmpty()) null else PrerequisiteResult(prerequisite.entityId, failed, unknown)
        }

    /**
     * Toggles the effects of the character's entities read, each with the first entity reading it, so a sheet can
     * offer Power Attack while it is off.
     */
    fun toggleSources(): Map<String, String> = buildMap {
        for ((entityId, toggles) in compiled.togglesByEntity) {
            if (state.isSource(entityId)) toggles.forEach { if (it !in this) put(it, entityId) }
        }
    }

    /** A statistic of a spell variant (`spell.slot_level`, `spell.damage`…), computed when asked; null when it has none. */
    fun variantStatistic(variantId: String, target: String): Value? {
        val key = CompiledCatalog.variantKey(variantId, target)
        if (!compiled.exists(key)) return null
        return resolve(key, reader = null).value
    }

    /** A cell of a class table's spell columns at the class's casting level; −1 for « — » or no class. */
    internal fun isSource(entityId: String): Boolean = state.isSource(entityId)

    internal fun knownManeuvers(): Set<String> = state.knownManeuvers

    internal fun skillRanks(skillId: String): Long = state.skillRanks(skillId)

    internal fun isClassSkill(skillId: String): Boolean = state.isClassSkill(skillId)

    internal fun skillPointsSpent(): Long = state.read(Input.SkillPointsSpent) as Long

    internal fun spellTable(classId: String, known: Boolean, level: Int): Long =
        state.read(Input.SpellTable(classId, known, level)) as Long

    /** Uses per day of the character's entities that have some; null when the formula fails. */
    fun dailyUses(): Map<String, Value?> = compiled.dailyUses.filterKeys(state::isSource).mapValues { (entityId, uses) ->
        when (uses) {
            is CompiledValue.Const -> uses.value
            is CompiledValue.Expr -> (uses.formula.evaluate(Frame("uses:$entityId")) as? EvalResult.Ok)?.value
        }
    }

    /** The highest value the player may pick for the entity's toggle, or null when it has none (or it fails). */
    fun tableMax(entityId: String): Value? = when (val max = compiled.tableMax[entityId]) {
        null -> null
        is CompiledValue.Const -> max.value
        is CompiledValue.Expr -> (max.formula.evaluate(Frame("tableValue:$entityId")) as? EvalResult.Ok)?.value
    }

    private fun activeEffects(key: String, state: CharacterState): List<CompiledEffect> {
        val variant = CompiledCatalog.parseVariant(key)
        val fixed = compiled.effectsFor(key).filter {
            if (variant != null) isVariantEffect(variant.first, it.entityId, state) else state.isSource(it.entityId)
        }
        if (variant != null) return fixed
        // A repeatable entity applies its effects once per take; a choice effect once per take that chose this key.
        val taken = fixed.flatMap { if (it.entityId in compiled.repeatable) List(state.count(it.entityId)) { _ -> it } else listOf(it) }
        val chosen = compiled.choiceEffects.filter { state.isSource(it.entityId) }.flatMap { effect ->
            choiceTargets(effect, state).filter { it == key }.map { effect }
        }
        return if (chosen.isEmpty()) taken else taken + chosen
    }

    /**
     * A variant takes spell-scoped effects from its spell, from the modifiers chosen for it, and from what the
     * character has that changes every spell (Improved Metamagic); never from another spell or an unchosen modifier.
     */
    private fun isVariantEffect(variantId: String, entityId: String, state: CharacterState): Boolean =
        state.isVariantSource(variantId, entityId) ||
            (state.isSource(entityId) && entityId !in compiled.perVariantModifiers && compiled.entity(entityId)?.type != "spell")

    /** `caster_level.class[{choice}]` with each of the character's choices for the effect's entity. */
    private fun choiceTargets(effect: CompiledEffect, state: CharacterState): List<String> =
        state.choices(effect.entityId).map { effect.effect.target.replace(CompiledCatalog.CHOICE, it) }

    /** A choice effect of an active entity that cannot apply: no choice made, or a choice naming no statistic. */
    private fun choiceIssues(): List<SheetIssue> = compiled.choiceEffects.filter { state.isSource(it.entityId) }.flatMap {
        val targets = choiceTargets(it, state)
        if (targets.isEmpty()) {
            listOf(SheetIssue(SheetIssue.Code.INVALID_VALUE, source = it.ref, message = "${it.entityId} needs a choice for '${it.effect.target}'"))
        } else {
            targets.filter { target -> target !in compiled.keys }.map { target ->
                SheetIssue(SheetIssue.Code.INVALID_VALUE, source = it.ref, message = "The choice gives '$target', which is not a statistic")
            }
        }
    }

    private fun resolve(key: String, reader: Frame?): StatRecord {
        records[key]?.let { return it }
        if (key in inProgress) {
            val path = inProgress.toList().dropWhile { it != key } + key
            val message = "Cycle: ${path.joinToString(" -> ")}"
            reader?.cycles?.add(message)
            throw StatUnavailable(message)
        }
        inProgress += key
        try {
            val record = Frame(key).compute()
            records[key] = record
            recomputed += key
            return record
        } finally {
            inProgress -= key
        }
    }

    private class StatRecord(
        val value: Value?,
        val breakdown: Breakdown,
        val reads: Set<String>,
        val inputs: Map<Input, Any>,
        val effects: List<CompiledEffect>,
        val issues: List<SheetIssue>,
    )

    private class Applicable(val effect: CompiledEffect, val value: Value, val modifiers: List<String> = emptyList()) {
        val number get() = (value as? Value.Num)?.value
    }

    /** Computes one statistic and records everything it reads. */
    private inner class Frame(val key: String) : FormulaEnv {
        val reads = HashSet<String>()
        val inputs = HashMap<Input, Any>()
        val issues = ArrayList<SheetIssue>()
        val cycles = HashSet<String>()
        private val lines = ArrayList<BreakdownLine>()

        /** The spell whose `@spell.*` statistics formulas read: the variant being computed, or the spell of an effect. */
        private val variantSpell = CompiledCatalog.parseVariant(key)?.first
        private var spellContext: String? = variantSpell

        private fun input(input: Input): Any = state.read(input).also { inputs[input] = it }

        override fun stat(key: String): Value? {
            CharacterState.inputFor(key)?.let { input ->
                return when (val v = input(input)) {
                    is Long -> Value.Num(Fraction.of(v))
                    else -> Value.Num(v as Fraction)
                }
            }
            val actual = spellContext?.takeIf { key.startsWith("spell.") }
                ?.let { CompiledCatalog.variantKey(it, key) } ?: key
            if (!compiled.exists(actual)) return null
            reads += actual
            val record = resolve(actual, this)
            return record.value ?: throw StatUnavailable("@$actual has an error: ${record.breakdown.error}")
        }

        override fun level(classId: String?) = input(Input.Level(classId)) as Long
        override fun has(entityId: String) = (input(Input.Count(entityId)) as Long) > 0
        override fun count(entityId: String) = input(Input.Count(entityId)) as Long
        override fun active(toggleId: String) = input(Input.Active(toggleId)) as Boolean

        private fun issue(code: SheetIssue.Code, source: String, message: String) {
            issues += SheetIssue(code, key, source, message)
        }

        private fun eval(value: CompiledValue, source: String): Value? = when (value) {
            is CompiledValue.Const -> value.value
            is CompiledValue.Expr -> when (val r = value.formula.evaluate(this)) {
                is EvalResult.Ok -> r.value
                is EvalResult.Error -> {
                    val code = if (r.message in cycles) SheetIssue.Code.CYCLE else SheetIssue.Code.FORMULA_ERROR
                    issue(code, source, "'${value.formula.source}': ${r.message}")
                    null
                }
            }
        }

        fun compute(): StatRecord {
            val effects = activeEffects(key, state)
            val definition = compiled.definition(key)
            val value = try {
                resolveValue(definition, effects)
            } catch (e: ResolveError) {
                issue(SheetIssue.Code.STATISTIC_ERROR, e.source, e.message ?: "Error")
                null
            }
            val error = if (value == null) issues.lastOrNull()?.message ?: "No value" else null
            return StatRecord(value, Breakdown(key, value, error, lines.toList()), reads, inputs, effects, issues)
        }

        /** Order of operations: base, set (base layer), add, dice, multiply, set (final layer), min / max, round. */
        private fun resolveValue(definition: CompiledDef?, effects: List<CompiledEffect>): Value {
            var current: Value = Value.Num(Fraction.ZERO)
            if (variantSpell != null) {
                variantBase(variantSpell, CompiledCatalog.parseVariant(key)!!.second)?.let {
                    current = it
                    lines += BreakdownLine(Step.BASE, "definition", current)
                }
            }
            definition?.base?.let { base ->
                current = eval(base, "definition") ?: throw ResolveError("definition", "Base formula failed")
                lines += BreakdownLine(Step.BASE, "definition", current)
            }
            definition?.def?.components?.forEach { component ->
                val part = try {
                    stat(component) ?: throw ResolveError(component, "Unknown component '$component'")
                } catch (e: StatUnavailable) {
                    throw ResolveError(component, e.message ?: "Component has no value")
                }
                current = plus(current, part, component)
                lines += BreakdownLine(Step.COMPONENT, component, part)
            }

            val applicable = ArrayList<Applicable>()
            for (effect in effects) {
                val e = effect.effect
                spellContext = variantSpell ?: state.variantOfSpell(effect.entityId)
                if (e.situation != null) {
                    eval(effect.value, effect.ref)?.let {
                        lines += BreakdownLine(
                            stepOf(e.op, e.layer), effect.entityId, it, Status.SITUATIONAL,
                            bonusType = e.bonusType, situation = e.situation,
                        )
                    }
                    continue
                }
                effect.condition?.let { condition ->
                    when (val test = eval(CompiledValue.Expr(condition), effect.ref)) {
                        null -> continue
                        !is Value.Bool -> {
                            issue(SheetIssue.Code.INVALID_VALUE, effect.ref, "Condition '${condition.source}' is not a test")
                            continue
                        }
                        else -> if (!test.value) continue
                    }
                }
                val value = eval(effect.value, effect.ref) ?: continue
                applicable += if (variantSpell == null && e.op == Op.ADD && spellContext != null) {
                    withMetamagic(effect, value, spellContext!!) ?: continue
                } else {
                    Applicable(effect, value)
                }
            }
            spellContext = variantSpell
            fun ofOp(op: Op, layer: Layer? = null) = applicable.filter {
                it.effect.effect.op == op && (op != Op.SET || (it.effect.effect.layer ?: Layer.BASE) == layer)
            }

            var before = lines.size
            pickSet(ofOp(Op.SET, Layer.BASE), Step.SET_BASE)?.let { winner ->
                markReplaced(before)
                current = winner.value
            }
            definition?.diceSteps?.let { current = applySizeSteps(current, it) }
            current = applyAdds(current, ofOp(Op.ADD))
            for (dice in ofOp(Op.DICE)) {
                current = tryPlus(current, dice) ?: continue
                lines += line(Step.DICE, dice)
            }
            current = applyMultipliers(current, ofOp(Op.MULTIPLY))
            before = lines.size
            pickSet(ofOp(Op.SET, Layer.FINAL), Step.SET_FINAL)?.let { winner ->
                markReplaced(before)
                current = winner.value
            }
            current = applyLimits(current, ofOp(Op.MIN), ofOp(Op.MAX))

            if (definition?.def?.round != false) current = roundDown(current)
            return current
        }

        /**
         * Penalties sum. Stacking types sum, other types keep their highest bonus. The same-source rule needs nothing
         * here: an entity is one source however many times it is active (see [CharacterState]).
         */
        private fun applyAdds(start: Value, adds: List<Applicable>): Value {
            var current = start
            val bonusesByType = adds
                .filter { (it.number?.signum() ?: 0) > 0 }
                .groupBy { it.effect.effect.bonusType ?: UNTYPED }
            for (add in adds) {
                val type = add.effect.effect.bonusType ?: UNTYPED
                val number = add.number
                val winner = if (number == null || number.signum() <= 0 || compiled.stacks[type] != false) {
                    add
                } else {
                    bonusesByType.getValue(type).maxWith(compareBy { it.number!! })
                }
                if (winner === add) {
                    current = tryPlus(current, add) ?: continue
                    lines += line(Step.ADD, add)
                } else {
                    lines += line(Step.ADD, add, Status.NOT_STACKING, suppressedBy = winner.effect.entityId)
                }
            }
            return current
        }

        /** Exclusive groups keep their highest; the winners and additive multipliers add their extra parts; then each multiplicative one multiplies. */
        private fun applyMultipliers(start: Value, all: List<Applicable>): Value {
            val multipliers = all.filter { valid(it, it.number != null, "A multiplier must be a number") }
            if (multipliers.isEmpty()) return start
            if (start !is Value.Num && start !is Value.Dice) {
                issue(SheetIssue.Code.INVALID_VALUE, multipliers.first().effect.ref, "Cannot multiply ${describe(start)}")
                return start
            }
            val pool = ArrayList<Applicable>()
            val multiplicative = ArrayList<Applicable>()
            for (m in multipliers) {
                when (m.effect.effect.multMode) {
                    is MultMode.Exclusive -> Unit
                    MultMode.Multiplicative -> multiplicative += m
                    // Missing mode is reported by ModelCheck; 3.5's default is additive.
                    MultMode.Additive, null -> pool += m
                }
            }
            multipliers.filter { it.effect.effect.multMode is MultMode.Exclusive }
                .groupBy { (it.effect.effect.multMode as MultMode.Exclusive).group }
                .forEach { (_, group) ->
                    val best = group.maxWith(compareBy { it.number!! })
                    pool += best
                    group.filter { it !== best }.forEach {
                        lines += line(Step.MULTIPLY, it, Status.EXCLUSIVE_LOWER, suppressedBy = best.effect.entityId)
                    }
                }
            var factor = pool.fold(Fraction.ONE) { f, m -> f + (m.number!! - Fraction.ONE) }
            multiplicative.forEach { factor *= it.number!! }
            pool.forEach { lines += line(Step.MULTIPLY, it) }
            multiplicative.forEach { lines += line(Step.MULTIPLY, it) }
            return try {
                if (start is Value.Num) Value.Num(start.value * factor) else Value.Dice((start as Value.Dice).value * factor)
            } catch (e: ArithmeticException) {
                issue(SheetIssue.Code.INVALID_VALUE, multipliers.first().effect.ref, e.message ?: "Cannot multiply")
                start
            }
        }

        /** Base dice moved by size categories (a Large wielder's longsword: 1d8 -> 2d6); bonuses added later do not scale. */
        private fun applySizeSteps(start: Value, steps: CompiledValue): Value {
            val value = eval(steps, "definition") ?: return start
            val number = (value as? Value.Num)?.value
            if (number == null || number.denominator != 1L || number.floor() !in -MAX_SIZE_STEPS..MAX_SIZE_STEPS) {
                issue(SheetIssue.Code.INVALID_VALUE, "definition", "Size steps must be a whole number from -$MAX_SIZE_STEPS to $MAX_SIZE_STEPS")
                return start
            }
            val count = number.floor().toInt()
            if (count == 0 || start !is Value.Dice) return start
            val scaled = SizeDice.scale(start.value, count, compiled.catalog.diceSteps)
            scaled.missing?.let { issue(SheetIssue.Code.INVALID_VALUE, "definition", "No dice step for $it ${if (count > 0) "up" else "down"}") }
            lines += BreakdownLine(Step.SIZE, "definition", Value.Dice(scaled.dice))
            return Value.Dice(scaled.dice)
        }

        /** Floors (`min`) first, then caps (`max`), so a cap always holds. */
        private fun applyLimits(start: Value, floors: List<Applicable>, caps: List<Applicable>): Value {
            var current = start
            fun limit(all: List<Applicable>, step: Step, pickFloor: Boolean) {
                val items = all.filter { valid(it, it.number != null, "A floor or a cap must be a number") }
                if (items.isEmpty()) return
                val num = (current as? Value.Num)?.value
                if (num == null) {
                    issue(SheetIssue.Code.INVALID_VALUE, items.first().effect.ref, "Only a number can have a floor or a cap")
                    return
                }
                val best = if (pickFloor) items.maxWith(compareBy { it.number!! }) else items.minWith(compareBy { it.number!! })
                val binding = if (pickFloor) best.number!! > num else best.number!! < num
                for (item in items) {
                    lines += line(step, item, if (item === best && binding) Status.APPLIED else Status.NOT_BINDING)
                }
                if (binding) current = best.value
            }
            limit(floors, Step.MIN, pickFloor = true)
            limit(caps, Step.MAX, pickFloor = false)
            return current
        }

        /** Two sets on one layer: the highest number wins (the first one for text). */
        private fun pickSet(sets: List<Applicable>, step: Step): Applicable? {
            if (sets.isEmpty()) return null
            // Numbers compare by value and dice by average (3d6 beats 2d6); text keeps the first.
            val comparable = sets.all { it.value is Value.Num || it.value is Value.Dice }
            val winner = if (comparable) sets.maxWith(compareBy { average(it.value) }) else sets.first()
            for (set in sets) {
                lines += if (set === winner) line(step, set) else line(step, set, Status.SET_LOWER, winner.effect.entityId)
            }
            return winner
        }

        /** Values a variant starts from, read from the character rather than from effects. */
        private fun variantBase(variantId: String, target: String): Value? = when (target) {
            CompiledCatalog.SPELL_CASTER_LEVEL -> casterStat(variantId, "caster_level.") { it.removePrefix("class.") }
            CompiledCatalog.SPELL_LEVEL -> Value.Num(Fraction.of(input(Input.SpellLevel(variantId)) as Long))
            CompiledCatalog.SPELL_METAMAGIC_COUNT -> Value.Num(Fraction.of(input(Input.MetamagicCount(variantId)) as Long))
            // 10 + spell level + the casting ability modifier of the class casting it.
            CompiledCatalog.SPELL_DC -> {
                val level = stat(CompiledCatalog.SPELL_LEVEL) as Value.Num
                val modifier = casterStat(variantId, "ability.") { classId ->
                    val ability = compiled.casters[classId]?.ability
                        ?: throw ResolveError("definition", "$classId does not cast spells")
                    ability.name.lowercase() + ".mod"
                } as Value.Num
                Value.Num(Fraction.of(10) + level.value + modifier.value)
            }
            else -> null
        }

        /** A statistic of the class casting [variantId], named by its toggle or saved variant: `caster_level.wizard`. */
        private fun casterStat(variantId: String, prefix: String, suffix: (String) -> String): Value {
            val classId = input(Input.CasterClass(variantId)) as String
            if (classId.isEmpty()) throw ResolveError("definition", "The toggle or variant casting $variantId names no casterClass")
            val key = prefix + suffix(classId)
            return try {
                stat(key) ?: throw ResolveError("definition", "No statistic '$key' for $classId")
            } catch (e: StatUnavailable) {
                throw ResolveError("definition", e.message ?: "No value for '$key'")
            }
        }

        /** A buff cast as a variant: its numeric bonus times the variant's multiplier (Superspell: +4 becomes +16). */
        private fun withMetamagic(effect: CompiledEffect, value: Value, variantId: String): Applicable? {
            val metamagic = state.metamagic(variantId)
            if (metamagic.isEmpty() || value !is Value.Num) return Applicable(effect, value)
            val factor = try {
                stat(CompiledCatalog.variantKey(variantId, CompiledCatalog.SPELL_NUMERIC))
            } catch (e: StatUnavailable) {
                issue(SheetIssue.Code.FORMULA_ERROR, effect.ref, e.message ?: "No variant multiplier")
                return null
            }
            val multiplier = (factor as? Value.Num)?.value ?: return Applicable(effect, value)
            return Applicable(effect, Value.Num(value.value * multiplier), metamagic)
        }

        /** A winning `set` replaces everything counted before it; those lines stay in the breakdown, marked replaced. */
        private fun markReplaced(until: Int) {
            for (i in 0 until until) {
                if (lines[i].status == Status.APPLIED) lines[i] = lines[i].copy(status = Status.REPLACED)
            }
        }

        /** Adds an effect's value, or reports it and skips it when the types do not fit. */
        private fun tryPlus(current: Value, a: Applicable): Value? = try {
            plus(current, a.value, a.effect.ref)
        } catch (e: ResolveError) {
            issue(SheetIssue.Code.INVALID_VALUE, a.effect.ref, e.message ?: "Invalid value")
            null
        } catch (e: ArithmeticException) {
            issue(SheetIssue.Code.INVALID_VALUE, a.effect.ref, e.message ?: "Number out of range")
            null
        }

        private fun valid(a: Applicable, ok: Boolean, message: String): Boolean {
            if (!ok) issue(SheetIssue.Code.INVALID_VALUE, a.effect.ref, message)
            return ok
        }

        private fun line(step: Step, a: Applicable, status: Status = Status.APPLIED, suppressedBy: String? = null) =
            BreakdownLine(
                step, a.effect.entityId, a.value, status,
                bonusType = a.effect.effect.bonusType, multMode = a.effect.effect.multMode, suppressedBy = suppressedBy,
                modifiers = a.modifiers,
            )

        private fun average(v: Value): Fraction = when (v) {
            is Value.Num -> v.value
            is Value.Dice -> v.value.average
            else -> Fraction.ZERO
        }

        private fun stepOf(op: Op, layer: Layer?): Step = when (op) {
            Op.ADD -> Step.ADD
            Op.DICE -> Step.DICE
            Op.MULTIPLY -> Step.MULTIPLY
            Op.SET -> if (layer == Layer.FINAL) Step.SET_FINAL else Step.SET_BASE
            Op.MIN -> Step.MIN
            Op.MAX -> Step.MAX
            Op.GRANT -> Step.ADD
        }

        private fun plus(a: Value, b: Value, source: String): Value = when {
            a is Value.Num && b is Value.Num -> Value.Num(a.value + b.value)
            a is Value.Dice && b is Value.Num -> Value.Dice(a.value + b.value)
            a is Value.Num && b is Value.Dice -> Value.Dice(b.value + a.value)
            a is Value.Dice && b is Value.Dice -> Value.Dice(a.value + b.value)
            else -> throw ResolveError(source, "Cannot add ${describe(b)} to ${describe(a)}")
        }

        private fun roundDown(v: Value): Value = when (v) {
            is Value.Num -> Value.Num(Fraction.of(v.value.floor()))
            is Value.Dice -> Value.Dice(DiceValue(v.value.terms, Fraction.of(v.value.flat.floor())))
            else -> v
        }

        private fun describe(v: Value) = when (v) {
            is Value.Num -> "a number"
            is Value.Bool -> "a test"
            is Value.Text -> "text"
            is Value.Dice -> "dice"
        }
    }

    private class ResolveError(val source: String, message: String) : Exception(message)

    private companion object {
        const val UNTYPED = "untyped"

        /** Fine to Colossal is 8 steps; epic growth goes further. */
        const val MAX_SIZE_STEPS = 20L
    }
}
