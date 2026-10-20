-- Catalog search, part 2: full text in descriptions, and the filter values (facets) computed from the content.
-- The values are stored generated columns of `entity_version`: Postgres computes them once when a version is written
-- (import, restore, the editor: nothing to do), and a search reads them instead of recomputing them from the JSON on
-- every row (several times too slow at tens of thousands of entities). They are derived, so never exported.

-- Descriptions: words reduced to their root (« aveuglés » → « aveugl »), accents ignored. One configuration per language.
CREATE TEXT SEARCH CONFIGURATION lore_fr (COPY = pg_catalog.french);
ALTER TEXT SEARCH CONFIGURATION lore_fr
    ALTER MAPPING FOR word, hword, hword_part WITH public.unaccent, pg_catalog.french_stem;
CREATE TEXT SEARCH CONFIGURATION lore_en (COPY = pg_catalog.english);
ALTER TEXT SEARCH CONFIGURATION lore_en
    ALTER MAPPING FOR word, hword, hword_part WITH public.unaccent, pg_catalog.english_stem;

CREATE FUNCTION lore_description_fr(content jsonb) RETURNS tsvector
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$ SELECT to_tsvector('public.lore_fr'::regconfig, coalesce(content -> 'description' ->> 'fr', '')) $$;

CREATE FUNCTION lore_description_en(content jsonb) RETURNS tsvector
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$ SELECT to_tsvector('public.lore_en'::regconfig, coalesce(content -> 'description' ->> 'en', '')) $$;

-- A spell's school and descriptors in lower case, so « Mal » and « mal » are one value. Accents stay: the app shows
-- these values as they are (« évocation » → « Évocation »).
CREATE FUNCTION lore_school(content jsonb) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$ SELECT nullif(lower(trim(content -> 'spell' ->> 'school')), '') $$;

CREATE FUNCTION lore_descriptors(content jsonb) RETURNS text[]
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
        SELECT coalesce(array_agg(DISTINCT lower(trim(d))) FILTER (WHERE trim(d) <> ''), '{}')
        FROM jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(content -> 'spell' -> 'descriptors') = 'array'
                 THEN content -> 'spell' -> 'descriptors' ELSE '[]' END) d
    $$;

-- What an entity's effects change on the character, by family: `ac.total` → `ac`, `ability.str.score` →
-- `ability.str` (`ability.all.*` → all six), `skill.jump` stays whole. Effects scoped to the spell or the item itself
-- (a spell's damage, a weapon's threat range) say nothing about the character and are left out.
CREATE FUNCTION lore_affects(content jsonb) RETURNS text[]
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
        SELECT coalesce(array_agg(DISTINCT family), '{}')
        FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(content -> 'effects') = 'array' THEN content -> 'effects' ELSE '[]' END) f,
             LATERAL (SELECT f ->> 'target' AS target) t,
             LATERAL unnest(CASE
                 WHEN target LIKE 'ability.all.%' THEN ARRAY['ability.str', 'ability.dex', 'ability.con',
                                                             'ability.int', 'ability.wis', 'ability.cha']
                 WHEN target LIKE 'ability.%' OR target LIKE 'skill.%'
                     THEN ARRAY[split_part(target, '.', 1) || '.' || split_part(target, '.', 2)]
                 ELSE ARRAY[split_part(target, '.', 1)] END) family
        WHERE target IS NOT NULL AND coalesce(f ->> 'scope', '') NOT IN ('spell', 'item')
    $$;

ALTER TABLE entity_version
    ADD COLUMN search_text text GENERATED ALWAYS AS (lore_search_text(content)) STORED,
    ADD COLUMN search_sort text GENERATED ALWAYS AS (lore_sort_name(content)) STORED,
    ADD COLUMN search_fr tsvector GENERATED ALWAYS AS (lore_description_fr(content)) STORED,
    ADD COLUMN search_en tsvector GENERATED ALWAYS AS (lore_description_en(content)) STORED,
    ADD COLUMN facet_school text GENERATED ALWAYS AS (lore_school(content)) STORED,
    ADD COLUMN facet_descriptors text[] GENERATED ALWAYS AS (lore_descriptors(content)) STORED,
    ADD COLUMN facet_affects text[] GENERATED ALWAYS AS (lore_affects(content)) STORED;

-- 0004's index on lore_search_text(content) moves to the column.
DROP INDEX entity_version_search_idx;
CREATE INDEX entity_version_search_idx ON entity_version USING gin (search_text gin_trgm_ops);
CREATE INDEX entity_version_search_fr_idx ON entity_version USING gin (search_fr);
CREATE INDEX entity_version_search_en_idx ON entity_version USING gin (search_en);
CREATE INDEX entity_version_facet_school_idx ON entity_version (facet_school);
CREATE INDEX entity_version_facet_descriptors_idx ON entity_version USING gin (facet_descriptors);
CREATE INDEX entity_version_facet_affects_idx ON entity_version USING gin (facet_affects);

-- Spell list filter: which spells are on a class's (or domain's) list.
CREATE INDEX entity_relation_to_idx ON entity_relation (relation, to_id);
