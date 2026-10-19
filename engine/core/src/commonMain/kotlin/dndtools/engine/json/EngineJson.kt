package dndtools.engine.json

import dndtools.engine.model.Catalog
import dndtools.engine.model.Character
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * JSON format of the engine's inputs and outputs.
 *
 * Decoding is strict: an unknown field is an error, so a typo in team content fails loudly instead of being
 * dropped. The only exception is review metadata (see [REVIEW_METADATA]), which is removed before decoding.
 */
object EngineJson {
    /** Fields used by people reviewing the content, never read by the engine (`golden/README.md`). */
    val REVIEW_METADATA = setOf("status", "note", "flag", "assumptions")

    val json = Json {
        explicitNulls = false
        encodeDefaults = false
    }

    fun decodeCatalog(text: String): Catalog = decode(Catalog.serializer(), text)

    fun decodeCharacter(text: String): Character = decode(Character.serializer(), text)

    fun encodeCatalog(catalog: Catalog): String = json.encodeToString(Catalog.serializer(), catalog)

    fun encodeCharacter(character: Character): String = json.encodeToString(Character.serializer(), character)

    fun <T> decode(serializer: KSerializer<T>, text: String): T =
        json.decodeFromJsonElement(serializer, stripReviewMetadata(json.parseToJsonElement(text)))

    fun stripReviewMetadata(element: JsonElement): JsonElement = when (element) {
        is JsonObject -> JsonObject(
            element.filterKeys { it !in REVIEW_METADATA }.mapValues { stripReviewMetadata(it.value) }
        )
        is JsonArray -> JsonArray(element.map(::stripReviewMetadata))
        else -> element
    }
}
