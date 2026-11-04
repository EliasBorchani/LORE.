-- Catalog search, part 4: warlock invocation filter (Complete Arcane), read from the `invocation` block like the
-- maneuver level in 0010. The grade is a word: least, lesser, greater, dark.
CREATE FUNCTION lore_invocation_grade(content jsonb) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$ SELECT nullif(trim(content -> 'invocation' ->> 'grade'), '') $$;

ALTER TABLE entity_version
    ADD COLUMN facet_invocation_grade text GENERATED ALWAYS AS (lore_invocation_grade(content)) STORED;

CREATE INDEX entity_version_facet_invocation_grade_idx ON entity_version (facet_invocation_grade);
