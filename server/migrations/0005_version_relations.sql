-- The relations edited in the app (a spell's levels), as they were at each version, so the history shows who changed
-- them and when. Null for versions written by an import, which keeps relations in its batch files.
ALTER TABLE entity_version ADD COLUMN relations jsonb;
