package dndtools.engine.formula

import dndtools.engine.math.Fraction

/** What a formula can read from the character. The resolver implements it; tests use a map. */
interface FormulaEnv {
    /** Value of a statistic, or null if the statistic does not exist. */
    fun stat(key: String): Value?

    /** Character level when [classId] is null, otherwise the level in that class (0 if none). */
    fun level(classId: String?): Long

    fun has(entityId: String): Boolean

    /** How many times the character has the entity (a feat taken 5 times gives 5). */
    fun count(entityId: String): Long = if (has(entityId)) 1 else 0

    fun active(toggleId: String): Boolean
}

/** Thrown by [FormulaEnv.stat] when a statistic exists but has no value (a cycle, or an error in it). */
class StatUnavailable(message: String) : Exception(message)

sealed interface ParseResult {
    data class Ok(val formula: Formula) : ParseResult
    data class Error(val message: String, val position: Int) : ParseResult
}

sealed interface EvalResult {
    data class Ok(val value: Value) : EvalResult
    data class Error(val message: String, val position: Int) : EvalResult
}

/** A parsed formula. Parse once, evaluate many times. Errors are returned, never thrown. */
class Formula private constructor(val source: String, val expr: Expr) {

    /** Statistic keys read with `@`, for the dependency graph. */
    val statRefs: Set<String>

    /** Ids read with `has(...)` and `level('...')`. */
    val entityRefs: Set<String>

    /** Ids read with `active(...)`. */
    val toggleRefs: Set<String>

    /** True if the formula calls `level()` with no class. */
    val usesCharacterLevel: Boolean

    /** Damage types written after dice. */
    val diceTypes: Set<String>

    init {
        val types = HashSet<String>()
        val stats = HashSet<String>()
        val entities = HashSet<String>()
        val toggles = HashSet<String>()
        var characterLevel = false
        fun visit(e: Expr) {
            when (e) {
                is Expr.Stat -> stats += e.key
                is Expr.Unary -> visit(e.operand)
                is Expr.Binary -> { visit(e.left); visit(e.right) }
                is Expr.Dice -> {
                    e.type?.let { types += it }
                    visit(e.count)
                }
                is Expr.Call -> {
                    val id = (e.args.firstOrNull() as? Expr.Str)?.value
                    when (e.function) {
                        Builtin.HAS, Builtin.COUNT -> entities += id!!
                        Builtin.ACTIVE -> toggles += id!!
                        Builtin.LEVEL -> if (id == null) characterLevel = true else entities += id
                        else -> e.args.forEach(::visit)
                    }
                }
                is Expr.Num, is Expr.Str, is Expr.Bool -> Unit
            }
        }
        visit(expr)
        statRefs = stats
        entityRefs = entities
        toggleRefs = toggles
        usesCharacterLevel = characterLevel
        diceTypes = types
    }

    fun evaluate(env: FormulaEnv): EvalResult = try {
        EvalResult.Ok(Evaluator(env).eval(expr))
    } catch (e: FormulaException) {
        EvalResult.Error(e.message ?: "Error", e.position)
    }

    override fun toString(): String = source

    companion object {
        /** A formula for a part of an already parsed one (a prerequisite's condition). */
        internal fun of(expr: Expr): Formula = Formula(expr.toSource(), expr)

        fun parse(source: String): ParseResult = try {
            ParseResult.Ok(Formula(source, Parser(source).parse()))
        } catch (e: FormulaException) {
            ParseResult.Error(e.message ?: "Error", e.position)
        }
    }
}

internal class Evaluator(private val env: FormulaEnv) {

    fun eval(e: Expr): Value = when (e) {
        is Expr.Num -> Value.Num(e.value)
        is Expr.Str -> Value.Text(e.value)
        is Expr.Bool -> Value.Bool(e.value)
        is Expr.Stat -> try {
            env.stat(e.key) ?: fail("Unknown statistic '@${e.key}'", e)
        } catch (x: StatUnavailable) {
            fail(x.message ?: "Statistic '@${e.key}' has no value", e)
        }
        is Expr.Unary -> when (e.op) {
            UnaryOp.NEG -> when (val v = eval(e.operand)) {
                is Value.Num -> Value.Num(arithmetic(e) { -v.value })
                else -> fail("Cannot negate ${kind(v)}", e)
            }
            UnaryOp.NOT -> Value.Bool(!bool(e.operand))
        }
        is Expr.Binary -> binary(e)
        is Expr.Call -> call(e)
        is Expr.Dice -> {
            val count = number(e.count)
            if (!count.isInteger) fail("Dice count must be a whole number, got $count (use floor)", e)
            Value.Dice(arithmetic(e) { DiceValue.of(count.numerator, e.size, e.type) })
        }
    }

    private fun binary(e: Expr.Binary): Value {
        when (e.op) {
            // Short-circuit, so `has('x') and @x.value > 3` never reads a missing statistic.
            BinaryOp.AND -> return Value.Bool(bool(e.left) && bool(e.right))
            BinaryOp.OR -> return Value.Bool(bool(e.left) || bool(e.right))
            else -> Unit
        }
        val left = eval(e.left)
        val right = eval(e.right)
        return when (e.op) {
            BinaryOp.ADD, BinaryOp.SUB, BinaryOp.MUL, BinaryOp.DIV -> arithmetic(e, left, right)
            BinaryOp.EQ -> Value.Bool(equal(e, left, right))
            BinaryOp.NE -> Value.Bool(!equal(e, left, right))
            else -> {
                if (left !is Value.Num || right !is Value.Num) {
                    fail("Cannot compare ${kind(left)} ${e.op.symbol} ${kind(right)}", e)
                }
                val c = left.value.compareTo(right.value)
                Value.Bool(
                    when (e.op) {
                        BinaryOp.LT -> c < 0
                        BinaryOp.LE -> c <= 0
                        BinaryOp.GT -> c > 0
                        else -> c >= 0
                    }
                )
            }
        }
    }

    private fun arithmetic(e: Expr.Binary, left: Value, right: Value): Value = arithmetic(e) {
        when {
            left is Value.Num && right is Value.Num -> Value.Num(
                when (e.op) {
                    BinaryOp.ADD -> left.value + right.value
                    BinaryOp.SUB -> left.value - right.value
                    BinaryOp.MUL -> left.value * right.value
                    else -> {
                        if (right.value.signum() == 0) fail("Division by zero", e)
                        left.value / right.value
                    }
                }
            )
            left is Value.Dice && right is Value.Dice && e.op == BinaryOp.ADD -> Value.Dice(left.value + right.value)
            left is Value.Dice && right is Value.Num -> when (e.op) {
                BinaryOp.ADD -> Value.Dice(left.value + right.value)
                BinaryOp.SUB -> Value.Dice(left.value + (-right.value))
                BinaryOp.MUL -> Value.Dice(left.value * right.value)
                else -> fail("Dice cannot be divided", e)
            }
            left is Value.Num && right is Value.Dice -> when (e.op) {
                BinaryOp.ADD -> Value.Dice(right.value + left.value)
                BinaryOp.MUL -> Value.Dice(right.value * left.value)
                else -> fail("Cannot compute ${kind(left)} ${e.op.symbol} ${kind(right)}", e)
            }
            else -> fail("Cannot compute ${kind(left)} ${e.op.symbol} ${kind(right)}", e)
        }
    }

    private fun equal(e: Expr, left: Value, right: Value): Boolean {
        if (left is Value.Dice || right is Value.Dice) fail("Dice cannot be compared", e)
        if (left::class != right::class) fail("Cannot compare ${kind(left)} with ${kind(right)}", e)
        return left == right
    }

    private fun call(e: Expr.Call): Value {
        val args = e.args
        fun id() = (args[0] as Expr.Str).value
        return when (e.function) {
            Builtin.LEVEL -> Value.Num(Fraction.of(env.level(if (args.isEmpty()) null else id())))
            Builtin.HAS -> Value.Bool(env.has(id()))
            Builtin.COUNT -> Value.Num(Fraction.of(env.count(id())))
            Builtin.ACTIVE -> Value.Bool(env.active(id()))
            Builtin.FLOOR -> Value.Num(Fraction.of(arithmetic(e) { number(args[0]).floor() }))
            Builtin.CEIL -> Value.Num(Fraction.of(arithmetic(e) { number(args[0]).ceil() }))
            Builtin.ISQRT -> {
                val x = number(args[0])
                if (x.signum() < 0) fail("isqrt of a negative number", e)
                Value.Num(Fraction.of(isqrt(x.floor())))
            }
            Builtin.MIN -> Value.Num(args.map(::number).min())
            Builtin.MAX -> Value.Num(args.map(::number).max())
            // Only the chosen branch is evaluated.
            Builtin.IF -> if (bool(args[0])) eval(args[1]) else eval(args[2])
        }
    }

    private fun number(e: Expr): Fraction = when (val v = eval(e)) {
        is Value.Num -> v.value
        else -> fail("Expected a number, got ${kind(v)}", e)
    }

    private fun bool(e: Expr): Boolean = when (val v = eval(e)) {
        is Value.Bool -> v.value
        else -> fail("Expected a test (true or false), got ${kind(v)}", e)
    }

    /** Turns an overflow inside an operation into an error at that operation. */
    private inline fun <T> arithmetic(e: Expr, block: () -> T): T = try {
        block()
    } catch (x: ArithmeticException) {
        fail(x.message ?: "Arithmetic error", e)
    }

    private fun kind(v: Value) = when (v) {
        is Value.Num -> "a number"
        is Value.Bool -> "a test"
        is Value.Text -> "text"
        is Value.Dice -> "dice"
    }

    private fun fail(message: String, e: Expr): Nothing = throw FormulaException(message, e.position)
}

/** Largest r with r * r <= n, by binary search on whole numbers (no floating point). */
internal fun isqrt(n: Long): Long {
    var low = 0L
    var high = minOf(n, 3_037_000_499L) // floor(sqrt(Long.MAX_VALUE)), so mid * mid never overflows
    while (low < high) {
        val mid = (low + high + 1) / 2
        if (mid * mid <= n) low = mid else high = mid - 1
    }
    return low
}
