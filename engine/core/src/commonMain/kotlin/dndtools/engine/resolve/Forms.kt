package dndtools.engine.resolve

import dndtools.engine.model.Ability
import dndtools.engine.model.CreatureInfo
import dndtools.engine.model.SizeChange

/**
 * A creature advanced to some hit dice, as a form uses it (Monster Manual advancement): the size of its band, Str /
 * Dex / Con and natural armor moved along the catalog's `sizeChanges`, and one ability point per 4 hit dice past the
 * creature's own, given in the order the player chose.
 */
internal object Forms {
    val SIZES = listOf("fine", "diminutive", "tiny", "small", "medium", "large", "huge", "gargantuan", "colossal")
    private val MEDIUM = SIZES.indexOf("medium")

    /** Medium = 0, Large = 1, Small = −1; null for a word that is not a size. */
    fun steps(size: String): Int? = SIZES.indexOf(size).takeIf { it >= 0 }?.minus(MEDIUM)

    /** The most hit dice the creature's advancement reaches; its own when it has none. */
    fun maxHitDice(creature: CreatureInfo): Int = maxOf(creature.hitDice, creature.advancement.maxOfOrNull { it.maxHd } ?: 0)

    fun sizeAt(creature: CreatureInfo, hitDice: Int): String {
        if (hitDice <= creature.hitDice) return creature.size
        val bands = creature.advancement.sortedBy { it.maxHd }
        return (bands.firstOrNull { hitDice <= it.maxHd } ?: bands.lastOrNull())?.size ?: creature.size
    }

    /** Ability points the extra hit dice give: one each time the total crosses a multiple of 4. */
    fun abilityPoints(creature: CreatureInfo, hitDice: Int): Int =
        maxOf(0, hitDice / 4 - creature.hitDice / 4)

    class Shape(
        val hitDice: Int,
        val size: String,
        val abilities: Map<Ability, Long>,
        val naturalArmor: Long,
        /** Points the extra hit dice give but the player has not placed yet. */
        val unspent: Int,
        /** Increases listed beyond the points available; they are ignored. */
        val extra: Int,
        /** Sizes crossed with no `sizeChanges` entry: counted as no change. */
        val missingSizes: List<String>,
    )

    fun shape(creature: CreatureInfo, hitDice: Int, increases: List<Ability>, changes: List<SizeChange>): Shape {
        val size = sizeAt(creature, hitDice)
        val bySize = changes.associateBy { it.size }
        val from = SIZES.indexOf(creature.size)
        val to = SIZES.indexOf(size)
        val abilities = creature.abilities.toMutableMap()
        var naturalArmor = creature.naturalArmor
        val missing = ArrayList<String>()
        fun bump(ability: Ability, by: Long) {
            abilities[ability]?.let { abilities[ability] = it + by }
        }
        fun apply(sizeName: String, sign: Int) {
            val change = bySize[sizeName]
            if (change == null) {
                missing += sizeName
                return
            }
            bump(Ability.STR, sign * change.str)
            bump(Ability.DEX, sign * change.dex)
            bump(Ability.CON, sign * change.con)
            naturalArmor += sign * change.naturalArmor
        }
        if (from >= 0 && to >= 0) {
            // Growing into a size adds its change; shrinking out of one takes it off.
            for (i in from + 1..to) apply(SIZES[i], 1)
            for (i in from downTo to + 1) apply(SIZES[i], -1)
        }
        val points = abilityPoints(creature, hitDice)
        val placed = increases.take(points)
        placed.forEach { bump(it, 1) }
        return Shape(
            hitDice = hitDice,
            size = size,
            abilities = abilities,
            naturalArmor = naturalArmor,
            unspent = points - placed.size,
            extra = maxOf(0, increases.size - points),
            missingSizes = missing,
        )
    }
}
