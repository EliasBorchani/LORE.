-- Catalog storage, from the Catalog model ("Storage"). Facets, tags, keywords and the search index come with search.

CREATE TABLE entity (
    id              text PRIMARY KEY,
    type            text NOT NULL,
    provenance      text,
    source          text,
    current_version integer NOT NULL
);

CREATE INDEX entity_type_idx ON entity (type, id);

CREATE TABLE entity_version (
    entity_id  text NOT NULL REFERENCES entity (id),
    version    integer NOT NULL,
    content    jsonb NOT NULL,
    author     text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    note       text,
    PRIMARY KEY (entity_id, version)
);

-- No foreign keys on relations and class tables: a batch import may point to entities that arrive in a later batch.
CREATE TABLE entity_relation (
    from_id  text NOT NULL,
    to_id    text NOT NULL,
    relation text NOT NULL,
    extra    jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX entity_relation_from_idx ON entity_relation (from_id);

CREATE TABLE progression_row (
    class_id text NOT NULL,
    level    integer NOT NULL,
    content  jsonb NOT NULL,
    PRIMARY KEY (class_id, level)
);

-- Rule data that is not an entity yet (bonus types, statistics, rules...), one row per top-level catalog key.
CREATE TABLE catalog_section (
    name    text PRIMARY KEY,
    content jsonb NOT NULL
);
