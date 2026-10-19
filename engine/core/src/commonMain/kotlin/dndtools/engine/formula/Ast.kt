package dndtools.engine.formula

import dndtools.engine.math.Fraction

/** Syntax tree of a formula. [position] is the character offset in the source, for error messages. */
sealed interface Expr {
    val position: Int

    data class Num(val value: Fraction, override val position: Int) : Expr
    data class Str(val value: String, override val position: Int) : Expr
    data class Bool(val value: Boolean, override val position: Int) : Expr
    data class Stat(val key: String, override val position: Int) : Expr
    data class Unary(val op: UnaryOp, val operand: Expr, override val position: Int) : Expr
    data class Binary(val op: BinaryOp, val left: Expr, val right: Expr, override val position: Int) : Expr
    data class Call(val function: Builtin, val args: List<Expr>, override val position: Int) : Expr

    /** `<count>d<size> [type]`: the count is any expression, the size a literal. */
    data class Dice(val count: Expr, val size: Long, val type: String?, override val position: Int) : Expr
}

/** Formula text for an expression, used to name the part of a prerequisite that failed. */
fun Expr.toSource(): String = print(this, 0)

private fun print(e: Expr, parentPrecedence: Int): String {
    val (text, precedence) = when (e) {
        is Expr.Num -> (e.value.toDecimalString() ?: "(${e.value})") to 9
        is Expr.Str -> "'${e.value}'" to 9
        is Expr.Bool -> "${e.value}" to 9
        is Expr.Stat -> "@${e.key}" to 9
        is Expr.Call -> "${e.function.id}(${e.args.joinToString(", ") { print(it, 0) }})" to 9
        is Expr.Dice -> {
            // A count other than a number is always wrapped: `@xd6` would read as a statistic named `xd6`.
            val count = if (e.count is Expr.Num) print(e.count, 9) else "(${print(e.count, 0)})"
            "${count}d${e.size}${e.type?.let { " $it" } ?: ""}" to 8
        }
        is Expr.Unary -> when (e.op) {
            UnaryOp.NEG -> "-${print(e.operand, 7)}" to 7
            UnaryOp.NOT -> "not ${print(e.operand, 3)}" to 3
        }
        is Expr.Binary -> {
            val p = when (e.op) {
                BinaryOp.OR -> 1
                BinaryOp.AND -> 2
                BinaryOp.MUL, BinaryOp.DIV -> 6
                BinaryOp.ADD, BinaryOp.SUB -> 5
                else -> 4
            }
            // The right side of a left-associative operator needs parentheses at equal precedence: a - (b - c).
            "${print(e.left, p)} ${e.op.symbol} ${print(e.right, p + 1)}" to p
        }
    }
    return if (precedence < parentPrecedence) "($text)" else text
}

enum class UnaryOp { NEG, NOT }

enum class BinaryOp(val symbol: String) {
    ADD("+"), SUB("-"), MUL("*"), DIV("/"),
    LT("<"), LE("<="), GT(">"), GE(">="), EQ("=="), NE("!="),
    AND("and"), OR("or"),
}

/** Built-in functions. Arity is checked when parsing, so bad content fails when it is saved, not on the sheet. */
enum class Builtin(val id: String, val minArgs: Int, val maxArgs: Int, val stringArgs: Boolean = false) {
    LEVEL("level", 0, 1, stringArgs = true),
    HAS("has", 1, 1, stringArgs = true),
    COUNT("count", 1, 1, stringArgs = true),
    ACTIVE("active", 1, 1, stringArgs = true),
    FLOOR("floor", 1, 1),
    CEIL("ceil", 1, 1),
    MIN("min", 2, Int.MAX_VALUE),
    MAX("max", 2, Int.MAX_VALUE),

    /** Whole square root, rounded down: inverts the XP formula without a loop. */
    ISQRT("isqrt", 1, 1),
    IF("if", 3, 3);

    companion object {
        val byId = entries.associateBy { it.id }
    }
}
