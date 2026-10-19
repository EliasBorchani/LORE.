-- An admin invites someone by email; the link lets them choose a password. The email becomes the account's login.
-- Pending invitations are temporary (like refresh tokens): they are not exported.
CREATE TABLE invitation (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email      text NOT NULL,
    role       text NOT NULL CHECK (role IN ('member', 'admin')),
    token_hash bytea NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    used_at    timestamptz
);

CREATE INDEX invitation_email_idx ON invitation (lower(email));
