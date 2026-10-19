-- Characters store choices only (the engine's character JSON); every sheet value is computed by the clients.
-- Not named "character": that word is an SQL type name.
CREATE TABLE player_character (
    id          uuid PRIMARY KEY,
    owner_id    bigint NOT NULL REFERENCES app_user (id),
    name        text NOT NULL,
    content     jsonb NOT NULL,
    version     integer NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    -- Sync token: clients send back the value they last pulled; a different value means the server copy is newer.
    updated_at  timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz
);

CREATE INDEX player_character_owner_idx ON player_character (owner_id, updated_at);

CREATE TABLE player_character_version (
    character_id uuid NOT NULL REFERENCES player_character (id),
    version      integer NOT NULL,
    content      jsonb NOT NULL,
    author_id    bigint NOT NULL REFERENCES app_user (id),
    saved_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (character_id, version)
);

-- Play state (damage, slots spent, toggles...) changes at the table without touching the build choices. Its shape
-- belongs to the clients; no history (the clients keep an undo log inside it).
CREATE TABLE player_character_play (
    character_id uuid PRIMARY KEY REFERENCES player_character (id),
    state        jsonb NOT NULL DEFAULT '{}',
    updated_at   timestamptz NOT NULL DEFAULT now()
);
