DROP INDEX command_one_active_invoice;
CREATE UNIQUE INDEX command_one_active_invoice ON commands(merchant,environment,invoice_id) WHERE state IN ('QUEUED','RUNNING','RETRYABLE_FAILURE','UNKNOWN_OUTCOME','MANUAL_REVIEW');
