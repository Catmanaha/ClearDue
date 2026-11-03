ALTER TABLE customer_feedback ADD COLUMN reviewed_at timestamptz;
CREATE INDEX feedback_unreviewed_grant_idx
  ON customer_feedback(grant_id) WHERE reviewed_at IS NULL;
