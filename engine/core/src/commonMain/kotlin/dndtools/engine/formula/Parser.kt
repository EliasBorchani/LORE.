package dndtools.engine.formula

import dndtools.engine.math.Fraction

/**
 * Recursive-descent parser. Precedence, lowest first:
 *
 * ```
 * or      := and ("or" and)*
 * and     := not ("and" not)*
 * not     := "not" not | compare
 * compare := sum (("<" | "<=" | ">" | ">=" | "==" | "!=") sum)?
 * sum     := product (("+" | "-") product)*
 * product := unary (("*" | "×" | "/") unary)*
 * unary   := "-" unary | "+" unary | dice
 * dice    := primary (DICE type?)?          e.g. 20d6, (floor(@caster_level / 3))d6 electricity
 * primary := NUMBER | STRING | "true" | "false" | @stat | builtin "(" args ")" | "(" or ")"
 * ```
 */
internal class Parser(source: String) {
    private val tokens = Lexer(source).tokens()
    private var index = 0

    fun parse(): Expr {
        val expr = or()
        val extra = peek()
        if (extra.kind != TokenKind.EOF) {
            throw FormulaException("Unexpected ${describe(extra)} after the end of the formula", extra.position)
        }
        return expr
    }

    private fun or(): Expr {
        var left = and()
        while (peekKeyword("or")) {
            val op = advance()
            left = Expr.Binary(BinaryOp.OR, left, and(), op.position)
        }
        return left
    }

    private fun and(): Expr {
        var left = not()
        while (peekKeyword("and")) {
            val op = advance()
            left = Expr.Binary(BinaryOp.AND, left, not(), op.position)
        }
        return left
    }

    private fun not(): Expr {
        if (peekKeyword("not")) {
            val op = advance()
            return Expr.Unary(UnaryOp.NOT, not(), op.position)
        }
        return compare()
    }

    private fun compare(): Expr {
        val left = sum()
        val op = when (peek().kind) {
            TokenKind.LT -> BinaryOp.LT
            TokenKind.LE -> BinaryOp.LE
            TokenKind.GT -> BinaryOp.GT
            TokenKind.GE -> BinaryOp.GE
            TokenKind.EQ -> BinaryOp.EQ
            TokenKind.NE -> BinaryOp.NE
            else -> return left
        }
        val token = advance()
        val right = sum()
        if (peek().kind in COMPARISONS) {
            throw FormulaException("Chained comparisons are ambiguous; use 'and'", peek().position)
        }
        return Expr.Binary(op, left, right, token.position)
    }

    private fun sum(): Expr {
        var left = product()
        while (true) {
            val op = when (peek().kind) {
                TokenKind.PLUS -> BinaryOp.ADD
                TokenKind.MINUS -> BinaryOp.SUB
                else -> return left
            }
            val token = advance()
            left = Expr.Binary(op, left, product(), token.position)
        }
    }

    private fun product(): Expr {
        var left = unary()
        while (true) {
            val op = when (peek().kind) {
                TokenKind.STAR -> BinaryOp.MUL
                TokenKind.SLASH -> BinaryOp.DIV
                else -> return left
            }
            val token = advance()
            left = Expr.Binary(op, left, unary(), token.position)
        }
    }

    private fun unary(): Expr = when (peek().kind) {
        TokenKind.MINUS -> {
            val token = advance()
            Expr.Unary(UnaryOp.NEG, unary(), token.position)
        }
        TokenKind.PLUS -> {
            advance()
            unary()
        }
        else -> dice()
    }

    private fun dice(): Expr {
        val count = primary()
        if (peek().kind != TokenKind.DICE) return count
        val token = advance()
        val size = token.text.toLongOrNull()?.takeIf { it > 0 }
            ?: throw FormulaException("Invalid dice size 'd${token.text}'", token.position)
        // A bare word right after dice is its damage type: `20d6 electricity`.
        val next = peek()
        val type = if (next.kind == TokenKind.IDENT && next.text !in KEYWORDS && peek(1).kind != TokenKind.LPAREN) {
            advance().text
        } else {
            null
        }
        return Expr.Dice(count, size, type, count.position)
    }

    private fun primary(): Expr {
        val token = advance()
        return when (token.kind) {
            TokenKind.NUMBER -> {
                val value = try {
                    Fraction.parse(token.text)
                } catch (e: NumberFormatException) {
                    throw FormulaException("Number out of range: ${token.text}", token.position)
                } catch (e: ArithmeticException) {
                    throw FormulaException("Number out of range: ${token.text}", token.position)
                }
                Expr.Num(value, token.position)
            }
            TokenKind.STRING -> Expr.Str(token.text, token.position)
            TokenKind.STAT -> Expr.Stat(token.text, token.position)
            TokenKind.LPAREN -> {
                val inner = or()
                expect(TokenKind.RPAREN, "')'")
                inner
            }
            TokenKind.IDENT -> when (token.text) {
                "true" -> Expr.Bool(true, token.position)
                "false" -> Expr.Bool(false, token.position)
                else -> call(token)
            }
            else -> throw FormulaException("Expected a value, found ${describe(token)}", token.position)
        }
    }

    private fun call(name: Token): Expr {
        val function = Builtin.byId[name.text]
            ?: throw FormulaException(
                if (peek().kind == TokenKind.LPAREN) "Unknown function '${name.text}'"
                else "Unknown name '${name.text}' (statistics start with '@', text goes in quotes)",
                name.position,
            )
        expect(TokenKind.LPAREN, "'(' after '${name.text}'")
        val args = ArrayList<Expr>()
        if (peek().kind != TokenKind.RPAREN) {
            args += or()
            while (peek().kind == TokenKind.COMMA) {
                advance()
                args += or()
            }
        }
        expect(TokenKind.RPAREN, "')' to close '${name.text}('")

        if (args.size < function.minArgs || args.size > function.maxArgs) {
            val expected = when {
                function.minArgs == function.maxArgs -> "${function.minArgs}"
                function.maxArgs == Int.MAX_VALUE -> "at least ${function.minArgs}"
                else -> "${function.minArgs} to ${function.maxArgs}"
            }
            throw FormulaException("'${function.id}' takes $expected argument(s), got ${args.size}", name.position)
        }
        if (function.stringArgs) {
            args.firstOrNull { it !is Expr.Str }?.let {
                throw FormulaException("'${function.id}' takes an id in quotes, e.g. ${function.id}('feat.x')", it.position)
            }
        }
        return Expr.Call(function, args, name.position)
    }

    private fun expect(kind: TokenKind, what: String): Token {
        val token = peek()
        if (token.kind != kind) throw FormulaException("Expected $what, found ${describe(token)}", token.position)
        return advance()
    }

    private fun peek(offset: Int = 0): Token = tokens[minOf(index + offset, tokens.lastIndex)]

    private fun advance(): Token = tokens[index].also { if (index < tokens.lastIndex) index++ }

    private fun peekKeyword(word: String) = peek().let { it.kind == TokenKind.IDENT && it.text == word }

    private fun describe(token: Token): String = when (token.kind) {
        TokenKind.EOF -> "the end of the formula"
        TokenKind.STRING -> "'${token.text}'"
        TokenKind.STAT -> "'@${token.text}'"
        TokenKind.DICE -> "'d${token.text}'"
        else -> "'${token.text}'"
    }

    private companion object {
        val KEYWORDS = setOf("and", "or", "not", "true", "false")
        val COMPARISONS = setOf(TokenKind.LT, TokenKind.LE, TokenKind.GT, TokenKind.GE, TokenKind.EQ, TokenKind.NE)
    }
}
