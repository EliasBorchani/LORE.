-- Accounts are created by an admin (no open sign-up, PRD 5.6).
CREATE TABLE app_user (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    login         text NOT NULL,
    password_hash text NOT NULL,
    role          text NOT NULL CHECK (role IN ('member', 'admin')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    disabled_at   timestamptz
);

CREATE UNIQUE INDEX app_user_login_idx ON app_user (lower(login));

-- Only a hash of each refresh token is stored. A family is one login session: each refresh replaces the token with
-- a new one of the same family, and reusing an already used token revokes the whole family.
CREATE TABLE refresh_token (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    bigint NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    family     text NOT NULL,
    token_hash bytea NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    used_at    timestamptz,
    revoked_at timestamptz
);

CREATE INDEX refresh_token_family_idx ON refresh_token (family);
CREATE INDEX refresh_token_user_idx ON refresh_token (user_id);
