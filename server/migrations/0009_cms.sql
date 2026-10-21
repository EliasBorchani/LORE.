-- The guided editor (docs/prd-cms.md): private drafts, and the states content can depend on.

-- An unfinished entry, seen only by its author. The payload is the editor's (entity, target ruleset, house rule,
-- edited version, spell levels…): the server keeps it as is, like play state. Publishing goes through the normal
-- create / update, then deletes the draft.
CREATE TABLE entity_draft (
    id         uuid PRIMARY KEY,
    author_id  bigint NOT NULL REFERENCES app_user (id),
    group_id   text NOT NULL REFERENCES lore_group (id),
    payload    jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entity_draft_author_idx ON entity_draft (author_id, group_id, updated_at DESC);

-- The states (`toggle.x`, switched on at the table) and situations (`situation.x`, shown apart) a version names, for
-- the editor's « Quand… » picker. Derived like the search columns (0007): computed on write, never exported.
CREATE FUNCTION lore_states(content jsonb) RETURNS text[]
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
        SELECT coalesce(array_agg(DISTINCT m[1] ORDER BY m[1]), '{}')
        FROM regexp_matches(content::text,
                            '(?:^|[^a-z0-9_:.])((?:[a-z][a-z0-9_]*:)?(?:toggle|situation)\.[a-z0-9_]+)', 'g') m
    $$;

ALTER TABLE entity_version
    ADD COLUMN facet_states text[] GENERATED ALWAYS AS (lore_states(content)) STORED;
CREATE INDEX entity_version_facet_states_idx ON entity_version USING gin (facet_states);
