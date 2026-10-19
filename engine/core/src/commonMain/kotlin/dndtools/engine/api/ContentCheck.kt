@file:OptIn(ExperimentalJsExport::class)

package dndtools.engine.api

import dndtools.engine.json.EngineJson
import dndtools.engine.model.Catalog
import dndtools.engine.model.Entity
import dndtools.engine.model.ModelCheck
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlin.js.ExperimentalJsExport
import kotlin.js.JsExport

/** Checks content before it is saved, for the content editor. */
@JsExport
object ContentCheck {
    /** The code of a problem the engine cannot decode at all (an unknown field, a wrong value type). */
    const val FORMAT = "format"

    /**
     * Problems in one entity: first what strict decoding refuses (nothing else is checked then), then what
     * [ModelCheck] finds in it (formulas, bonus types, layers, multiplier modes). [catalogJson] gives the bonus and
     * damage types; the core sections are enough.
     */
    fun entity(entityJson: String, catalogJson: String): List<ContentIssue> {
        val entity = try {
            EngineJson.decode(Entity.serializer(), entityJson)
        } catch (e: SerializationException) {
            return listOf(ContentIssue(FORMAT, "", e.message ?: "invalid JSON"))
        } catch (e: IllegalArgumentException) {
            return listOf(ContentIssue(FORMAT, "", e.message ?: "invalid JSON"))
        }
        val sections = EngineJson.json.parseToJsonElement(catalogJson).jsonObject
        // The core sections (`GET /catalog/core`) have no entities: this one is checked alone.
        val catalog = EngineJson.decode(
            Catalog.serializer(),
            JsonObject(sections + ("entities" to JsonArray(emptyList()))).toString(),
        )
        val prefix = "entity:${entity.id}"
        return ModelCheck.catalog(catalog.copy(entities = listOf(entity)))
            .filter { it.at == prefix || it.at.startsWith("$prefix/") }
            .map { ContentIssue(it.code.name.lowercase(), it.at.removePrefix(prefix).removePrefix("/"), it.message) }
    }
}

/** [at] is the place in the entity (`effects[0].value`), empty for the entity as a whole. */
@JsExport
data class ContentIssue(val code: String, val at: String, val message: String)
