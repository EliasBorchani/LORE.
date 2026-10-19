package dndtools.engine.formula

internal enum class TokenKind {
    NUMBER, STRING, STAT, IDENT, DICE,
    PLUS, MINUS, STAR, SLASH, LPAREN, RPAREN, COMMA,
    LT, LE, GT, GE, EQ, NE,
    EOF,
}

/** [text] holds the number literal, the string content, the statistic key, the name, or the dice size. */
internal data class Token(val kind: TokenKind, val text: String, val position: Int)

internal class FormulaException(message: String, val position: Int) : Exception(message)

internal class Lexer(private val source: String) {
    private var pos = 0

    fun tokens(): List<Token> {
        val tokens = ArrayList<Token>()
        while (true) {
            val hadSpace = skipSpaces()
            if (pos >= source.length) {
                tokens += Token(TokenKind.EOF, "", pos)
                return tokens
            }
            val previous = tokens.lastOrNull()
            // `20d6` and `(x)d6`: a `d` glued to a number or a closing parenthesis starts a dice size.
            if (!hadSpace && previous != null &&
                (previous.kind == TokenKind.NUMBER || previous.kind == TokenKind.RPAREN) &&
                source[pos] == 'd' && source.getOrNull(pos + 1)?.isAsciiDigit() == true
            ) {
                val start = pos++
                tokens += Token(TokenKind.DICE, readWhile { it.isAsciiDigit() }, start)
                continue
            }
            tokens += next()
        }
    }

    private fun next(): Token {
        val start = pos
        val c = source[pos]
        return when {
            c.isAsciiDigit() -> Token(TokenKind.NUMBER, readNumber(), start)
            c == '@' -> {
                pos++
                Token(TokenKind.STAT, readStatKey(start), start)
            }
            c == '\'' || c == '"' -> Token(TokenKind.STRING, readString(c), start)
            // Dots are accepted so a forgotten '@' reads as "Unknown name 'spell.range'", not as a stray '.'.
            c.isLetter() || c == '_' -> Token(TokenKind.IDENT, readWhile { it.isLetterOrDigit() || it == '_' || it == '.' }, start)
            else -> {
                pos++
                when (c) {
                    '+' -> Token(TokenKind.PLUS, "+", start)
                    '-' -> Token(TokenKind.MINUS, "-", start)
                    '*', '×' -> Token(TokenKind.STAR, "*", start)
                    '/' -> Token(TokenKind.SLASH, "/", start)
                    '(' -> Token(TokenKind.LPAREN, "(", start)
                    ')' -> Token(TokenKind.RPAREN, ")", start)
                    ',' -> Token(TokenKind.COMMA, ",", start)
                    '<' -> if (eat('=')) Token(TokenKind.LE, "<=", start) else Token(TokenKind.LT, "<", start)
                    '>' -> if (eat('=')) Token(TokenKind.GE, ">=", start) else Token(TokenKind.GT, ">", start)
                    '=' -> if (eat('=')) Token(TokenKind.EQ, "==", start) else throw FormulaException("Use '==' to compare", start)
                    '!' -> if (eat('=')) Token(TokenKind.NE, "!=", start) else throw FormulaException("Use 'not' for negation", start)
                    else -> throw FormulaException("Unexpected character '$c'", start)
                }
            }
        }
    }

    private fun readNumber(): String {
        val whole = readWhile { it.isAsciiDigit() }
        if (source.getOrNull(pos) == '.' && source.getOrNull(pos + 1)?.isAsciiDigit() == true) {
            pos++
            return "$whole.${readWhile { it.isAsciiDigit() }}"
        }
        return whole
    }

    /** `ability.str.score`, `toggle.power_attack.value`, `dc.school[abjuration]`. */
    private fun readStatKey(start: Int): String {
        val sb = StringBuilder()
        while (pos < source.length) {
            val c = source[pos]
            when {
                c.isLetterOrDigit() || c == '_' || c == '.' -> { sb.append(c); pos++ }
                c == '[' -> {
                    val close = source.indexOf(']', pos)
                    if (close < 0) throw FormulaException("Missing ']' in statistic key", pos)
                    sb.append(source, pos, close + 1)
                    pos = close + 1
                }
                else -> break
            }
        }
        val key = sb.toString()
        if (key.isEmpty() || key.startsWith('.') || key.endsWith('.') || ".." in key) {
            throw FormulaException("Invalid statistic key '@$key'", start)
        }
        return key
    }

    private fun readString(quote: Char): String {
        val start = pos++
        val end = source.indexOf(quote, pos)
        if (end < 0) throw FormulaException("Unclosed string", start)
        val text = source.substring(pos, end)
        pos = end + 1
        return text
    }

    private fun skipSpaces(): Boolean {
        val start = pos
        while (pos < source.length && source[pos].isWhitespace()) pos++
        return pos > start
    }

    private fun eat(c: Char): Boolean {
        if (source.getOrNull(pos) != c) return false
        pos++
        return true
    }

    private inline fun readWhile(test: (Char) -> Boolean): String {
        val start = pos
        while (pos < source.length && test(source[pos])) pos++
        return source.substring(start, pos)
    }

    private fun Char.isAsciiDigit() = this in '0'..'9'
}
