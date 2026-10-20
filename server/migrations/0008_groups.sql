-- Groups, rulesets and RPGs (docs/prd-multi.md, M1). Only adds tables and columns: today's data keeps working, and
-- `server migrate-groups` moves it into the first group and ruleset.

-- A game system. Its official content is the catalog rows without a ruleset.
CREATE TABLE rpg (
    id   text PRIMARY KEY,
    name text NOT NULL
);

INSERT INTO rpg (id, name) VALUES ('dnd35', 'D&D 3.5');

-- What `role = 'admin'` means from now on: platform admin (official content, limits, invites without a group).
-- Limits per account, set by the platform admin.
ALTER TABLE app_user
    ADD COLUMN max_groups          integer NOT NULL DEFAULT 10,
    ADD COLUMN max_rulesets        integer NOT NULL DEFAULT 10,
    ADD COLUMN max_pending_invites integer NOT NULL DEFAULT 20;

-- Homebrew for one RPG. Its entities' ids start with `<slug>:`; the slug never changes.
CREATE TABLE ruleset (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9_]{2,30}$'),
    rpg         text NOT NULL REFERENCES rpg (id),
    owner_id    bigint NOT NULL REFERENCES app_user (id),
    name        text NOT NULL,
    visibility  text NOT NULL CHECK (visibility IN ('private', 'public')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz
);

CREATE TABLE ruleset_editor (
    ruleset_id bigint NOT NULL REFERENCES ruleset (id),
    user_id    bigint NOT NULL REFERENCES app_user (id),
    PRIMARY KEY (ruleset_id, user_id)
);

-- A table of players. Not named "group": that word is an SQL keyword. The id is random (addresses: /g/<id>/…).
CREATE TABLE lore_group (
    id          text PRIMARY KEY CHECK (id ~ '^[a-z0-9]{10}$'),
    rpg         text NOT NULL REFERENCES rpg (id),
    name        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz
);

-- Permissions, not fixed roles (owner's choice). A member who leaves keeps the row with `left_at`, so their archived
-- characters still name the group they played in.
CREATE TABLE group_member (
    group_id    text NOT NULL REFERENCES lore_group (id),
    user_id     bigint NOT NULL REFERENCES app_user (id),
    permissions text[] NOT NULL DEFAULT '{}' CHECK (permissions <@ ARRAY[
        'see_characters', 'edit_characters', 'edit_content', 'invite', 'moderator', 'admin']::text[]),
    joined_at   timestamptz NOT NULL DEFAULT now(),
    left_at     timestamptz,
    PRIMARY KEY (group_id, user_id)
);

CREATE INDEX group_member_user_idx ON group_member (user_id);

-- The rulesets a group uses, in order: the last one wins when two override the same entity.
CREATE TABLE group_ruleset (
    group_id   text NOT NULL REFERENCES lore_group (id),
    ruleset_id bigint NOT NULL REFERENCES ruleset (id),
    position   integer NOT NULL,
    PRIMARY KEY (group_id, ruleset_id)
);

-- The primary key stays `id` in M1: homebrew ids are unique through their slug, and official ids only collide across
-- RPGs, which comes with the second RPG (M2).
ALTER TABLE entity
    ADD COLUMN rpg        text NOT NULL DEFAULT 'dnd35' REFERENCES rpg (id),
    ADD COLUMN ruleset_id bigint REFERENCES ruleset (id),
    -- The official id this entity replaces in the groups using its ruleset (a house rule).
    ADD COLUMN overrides  text,
    ADD CONSTRAINT entity_overrides_in_ruleset CHECK (overrides IS NULL OR ruleset_id IS NOT NULL);

CREATE UNIQUE INDEX entity_override_idx ON entity (ruleset_id, overrides) WHERE overrides IS NOT NULL;
CREATE INDEX entity_ruleset_idx ON entity (rpg, ruleset_id);

ALTER TABLE catalog_section ADD COLUMN rpg text NOT NULL DEFAULT 'dnd35' REFERENCES rpg (id);
ALTER TABLE catalog_section DROP CONSTRAINT catalog_section_pkey, ADD PRIMARY KEY (rpg, name);

ALTER TABLE progression_row ADD COLUMN rpg text NOT NULL DEFAULT 'dnd35' REFERENCES rpg (id);
ALTER TABLE progression_row DROP CONSTRAINT progression_row_pkey, ADD PRIMARY KEY (rpg, class_id, level);

-- Null only for characters written before `server migrate-groups`; the app creates every new one in a group.
ALTER TABLE player_character ADD COLUMN group_id text REFERENCES lore_group (id);
CREATE INDEX player_character_group_idx ON player_character (group_id, updated_at);

-- An invitation into a group, with the permissions the new member gets. Without a group, only the platform admin
-- invites (as before).
ALTER TABLE invitation
    ADD COLUMN group_id    text REFERENCES lore_group (id),
    ADD COLUMN permissions text[] NOT NULL DEFAULT '{}',
    ADD COLUMN invited_by  bigint REFERENCES app_user (id);

-- The one-time move of team content into a ruleset (`server migrate-groups`) changed ids: old → new, kept for good.
CREATE TABLE id_migration (
    old_id      text PRIMARY KEY,
    new_id      text NOT NULL,
    migrated_at timestamptz NOT NULL DEFAULT now()
);
