import { pgTable, text, jsonb, integer, timestamp, boolean, primaryKey } from 'drizzle-orm/pg-core';
import type { Invoice, Operation, WritableInvoice } from '../domain/invoice';
import type { Evidence, Finding } from '../domain/evidence';
import type { CommandState, Environment } from '../domain/core';

const time = (name: string) => timestamp(name, { withTimezone: true }).defaultNow().notNull();
export const cases = pgTable('cases', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  merchant: text('merchant').notNull(),
  environment: text('environment').$type<Environment>().notNull(),
  invoiceId: text('invoice_id').notNull(),
  customer: text('customer').notNull(),
  title: text('title').notNull(),
  kind: text('kind').notNull(),
  state: text('state').notNull().default('NEW'),
  providerInvoice: jsonb('provider_invoice').notNull(),
  invoice: jsonb('invoice').$type<Invoice>().notNull(),
  createdAt: time('created_at'),
  updatedAt: time('updated_at'),
});
export const intakeReceipts = pgTable(
  'intake_receipts',
  {
    ownerId: text('owner_id').notNull(),
    merchant: text('merchant').notNull(),
    environment: text('environment').$type<Environment>().notNull(),
    requestKey: text('request_key').notNull(),
    inputHash: text('input_hash').notNull(),
    caseId: text('case_id')
      .notNull()
      .references(() => cases.id, { onDelete: 'cascade' }),
    createdAt: time('created_at'),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.merchant, t.environment, t.requestKey] })],
);
export const evidence = pgTable('evidence', {
  id: text('id').primaryKey(),
  caseId: text('case_id')
    .notNull()
    .references(() => cases.id),
  label: text('label').notNull(),
  kind: text('kind').$type<Evidence['kind']>().notNull(),
  version: integer('version').notNull(),
  hash: text('hash').notNull(),
  text: text('body').notNull(),
  createdAt: time('created_at'),
});
export const snapshots = pgTable('snapshots', {
  id: text('id').primaryKey(),
  caseId: text('case_id')
    .notNull()
    .references(() => cases.id),
  fingerprint: text('fingerprint').notNull(),
  raw: jsonb('raw').notNull(),
  projection: jsonb('projection').$type<Invoice>().notNull(),
  provenance: text('provenance').notNull(),
  createdAt: time('created_at'),
});
export const investigations = pgTable('investigations', {
  id: text('id').primaryKey(),
  caseId: text('case_id')
    .notNull()
    .references(() => cases.id),
  evidenceHash: text('evidence_hash').notNull(),
  invoiceHash: text('invoice_hash').notNull(),
  status: text('status').notNull(),
  provenance: text('provenance').notNull(),
  promptVersion: text('prompt_version').notNull(),
  model: text('model'),
  result: jsonb('result').$type<Finding>(),
  error: text('error'),
  usage: jsonb('usage'),
  createdAt: time('created_at'),
});
export const proposals = pgTable('proposals', {
  id: text('id').primaryKey(),
  caseId: text('case_id')
    .notNull()
    .references(() => cases.id),
  investigationId: text('investigation_id')
    .notNull()
    .references(() => investigations.id),
  version: integer('version').notNull(),
  invoiceHash: text('invoice_hash').notNull(),
  evidenceHash: text('evidence_hash').notNull(),
  operation: jsonb('operation').$type<Operation>().notNull(),
  explanation: text('explanation').notNull(),
  state: text('state').notNull().default('DRAFT'),
  createdAt: time('created_at'),
});
export const commands = pgTable('commands', {
  id: text('id').primaryKey(),
  proposalId: text('proposal_id')
    .notNull()
    .references(() => proposals.id),
  caseId: text('case_id')
    .notNull()
    .references(() => cases.id),
  actorId: text('actor_id').notNull(),
  merchant: text('merchant').notNull(),
  environment: text('environment').$type<Environment>().notNull(),
  invoiceId: text('invoice_id').notNull(),
  operation: jsonb('operation').$type<Operation>().notNull(),
  beforeHash: text('before_hash').notNull(),
  evidenceHash: text('evidence_hash').notNull(),
  intendedAfter: jsonb('intended_after').$type<WritableInvoice>().notNull(),
  state: text('state').$type<CommandState>().notNull(),
  attempts: integer('attempts').notNull().default(0),
  error: text('error'),
  createdAt: time('created_at'),
  updatedAt: time('updated_at'),
});
export const audit = pgTable('audit', {
  id: text('id').primaryKey(),
  caseId: text('case_id').references(() => cases.id),
  actorId: text('actor_id').notNull(),
  event: text('event').notNull(),
  data: jsonb('data').notNull(),
  createdAt: time('created_at'),
});
export const webhooks = pgTable('webhook_inbox', {
  id: text('id').primaryKey(),
  invoiceId: text('invoice_id').notNull(),
  merchant: text('merchant').notNull(),
  payload: jsonb('payload').notNull(),
  processed: boolean('processed').notNull().default(false),
  createdAt: time('created_at'),
});
export const grants = pgTable('customer_grants', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull(),
  caseId: text('case_id')
    .notNull()
    .references(() => cases.id),
  explanation: text('explanation').notNull(),
  invoiceHash: text('invoice_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: time('created_at'),
});
export const feedback = pgTable('customer_feedback', {
  id: text('id').primaryKey(),
  grantId: text('grant_id')
    .notNull()
    .references(() => grants.id),
  message: text('message').notNull(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: time('created_at'),
});
export const dashboard = pgTable('dashboard_state', {
  ownerId: text('owner_id').primaryKey(),
  state: jsonb('state').notNull(),
  updatedAt: time('updated_at'),
});
