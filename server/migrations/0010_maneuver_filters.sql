-- Catalog search, part 3: maneuver and stance filters (Tome of Battle), read from the `maneuver` block like the spell
-- school in 0007. The discipline is an entity id (`discipline.diamond_mind`), so the facet shows its name.
CREATE FUNCTION lore_discipline(content jsonb) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$ SELECT nullif(trim(content -> 'maneuver' ->> 'discipline'), '') $$;

CREATE FUNCTION lore_maneuver_level(content jsonb) RETURNS integer
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
        SELECT CASE WHEN jsonb_typeof(content -> 'maneuver' -> 'level') = 'number'
                    THEN (content -> 'maneuver' ->> 'level')::numeric::integer END
    $$;

ALTER TABLE entity_version
    ADD COLUMN facet_discipline text GENERATED ALWAYS AS (lore_discipline(content)) STORED,
    ADD COLUMN facet_maneuver_level integer GENERATED ALWAYS AS (lore_maneuver_level(content)) STORED;

CREATE INDEX entity_version_facet_discipline_idx ON entity_version (facet_discipline);
