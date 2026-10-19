-- M07: audit logging (FR-013).
--
-- approved_by_user_id records who approved an action the actor's role does
-- not allow (a manager approval, M06-05). It is a fact about the audited
-- event, like user_id, so it is a column rather than part of details: the
-- viewer filters on it ("everything Arjun approved").
--
-- audit_logs stays append-only (the triggers from 0001 still apply).

ALTER TABLE audit_logs ADD COLUMN approved_by_user_id INTEGER REFERENCES users (user_id)
  CHECK (approved_by_user_id IS NULL OR approved_by_user_id IS NOT user_id);

CREATE INDEX audit_logs_approved_by ON audit_logs (approved_by_user_id)
  WHERE approved_by_user_id IS NOT NULL;

-- Filtering by action. Like every index it ends in the rowid, so the newest
-- entries of one action are read in order.
CREATE INDEX audit_logs_action ON audit_logs (action);
