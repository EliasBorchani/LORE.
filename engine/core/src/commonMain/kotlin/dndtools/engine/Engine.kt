package dndtools.engine

import dndtools.engine.model.Catalog
import dndtools.engine.model.Character
import dndtools.engine.resolve.CompiledCatalog
import dndtools.engine.resolve.Session
import dndtools.engine.resolve.Sheet

/** The rules engine for one catalog. Parses the catalog's formulas once; create one per catalog version. */
class Engine(catalog: Catalog) {
    private val compiled = CompiledCatalog(catalog)

    /** Classes that cast spells, with their casting ability, kind and default mode. */
    internal val casters get() = compiled.casters

    /** Classes that initiate maneuvers, with their key ability. */
    internal val initiators get() = compiled.initiators

    internal fun entity(id: String) = compiled.entity(id)

    internal fun disciplines(classId: String) = compiled.disciplines(classId)

    /** Skills of the catalog, with their ability and armor check penalty. */
    internal val skills get() = compiled.skills

    /** A live sheet: [Session.update] recomputes only what a change touches, [Session.explain] gives breakdowns. */
    fun session(character: Character, atLevel: Int? = null): Session = Session(compiled, character, atLevel)

    fun compute(character: Character, atLevel: Int? = null): Sheet = session(character, atLevel).sheet
}

fun compute(character: Character, catalog: Catalog): Sheet = Engine(catalog).compute(character)
