-- Catalog search: names in every language and the id, compared without accents or case (« epee » finds « Épée »).
-- The index is on the version content, so every write path (import, restore) keeps it up to date by itself.

CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- unaccent() is only STABLE (its dictionary could change); naming the dictionary makes this wrapper safe to index.
CREATE FUNCTION lore_fold(text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    AS $$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, $1)) $$;

-- `feat.power_attack` + « Attaque en puissance » + "Power Attack" → "feat power attack attaque en puissance power attack".
CREATE FUNCTION lore_search_text(content jsonb) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
        SELECT public.lore_fold(concat_ws(' ',
            translate(content ->> 'id', '._', '  '),
            (SELECT string_agg(value, ' ') FROM jsonb_each_text(
                CASE WHEN jsonb_typeof(content -> 'name') = 'object' THEN content -> 'name' ELSE '{}' END))))
    $$;

-- The name a result is sorted by: French first, then English, then the id.
CREATE FUNCTION lore_sort_name(content jsonb) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$ SELECT public.lore_fold(coalesce(content -> 'name' ->> 'fr', content -> 'name' ->> 'en', content ->> 'id')) $$;

CREATE INDEX entity_version_search_idx ON entity_version USING gin (lore_search_text(content) gin_trgm_ops);
