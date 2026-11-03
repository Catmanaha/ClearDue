CREATE TABLE intake_receipts (
  owner_id text NOT NULL,
  merchant text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('demo', 'sandbox')),
  request_key text NOT NULL,
  input_hash text NOT NULL,
  case_id text NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, merchant, environment, request_key)
);
