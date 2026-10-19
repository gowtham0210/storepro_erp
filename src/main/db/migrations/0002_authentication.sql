-- M05: sign-in, sessions and user management.
--
-- users gains two facts about the account itself:
--   must_change_password  set when an administrator resets the password
--   last_sign_in_at       when the user last signed in successfully
--
-- login_throttles holds failed sign-in counters. It is keyed by the
-- normalised username *as typed*, not by user_id, so guessing at usernames
-- that don't exist is throttled too (and reveals nothing). A row is deleted
-- on successful sign-in.

ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0
  CHECK (must_change_password IN (0, 1));
ALTER TABLE users ADD COLUMN last_sign_in_at INTEGER;

CREATE TABLE login_throttles (
  username_key   TEXT PRIMARY KEY CHECK (username_key = lower(username_key) AND length(username_key) <= 64),
  failed_count   INTEGER NOT NULL CHECK (failed_count >= 1),
  last_failed_at INTEGER NOT NULL,
  locked_until   INTEGER
) STRICT, WITHOUT ROWID;
