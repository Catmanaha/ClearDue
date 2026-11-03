ALTER TABLE customer_grants ADD COLUMN invoice_hash text;
UPDATE customer_grants SET invoice_hash='legacy-revoked',revoked_at=now();
ALTER TABLE customer_grants ALTER COLUMN invoice_hash SET NOT NULL;
