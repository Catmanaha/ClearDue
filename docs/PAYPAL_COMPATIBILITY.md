# PayPal sandbox compatibility and correction evidence

Observed 2026-10-30. Current result: the original project invoice was sent, explicitly approved and corrected from GBP1,250 to GBP1,000. The buyer paid the corresponding hosted sandbox invoice. Fresh PayPal reads confirm PAID,100000p paid,0 due, and owner-scoped reconciliation persisted that result. The original command is SUCCEEDED and the case RESOLVED after audited read-only recovery. The separate reduction remains25000p; no correction was retried. A separately approved unsent draft now proves genuine CREATED webhook signature/delivery, durable processing and duplicate suppression. Actual PAID/UPDATED webhook deliveries have not been observed.

## Authoritative contract

The earlier GitHub OpenAPI snapshot was outdated. The current [official schema](https://developer.paypal.com/api/invoicing/v2/schema.json), version2.12, and [update reference](https://developer.paypal.com/api/invoicing/v2/invoices-update/) describe writable invoice settings and save-item preference. Read-only independent review compared current request schemas with the actual response.

| Field/representation | Bounded implemented policy |
|---|---|
| settings | Documented writable field; preserve the existing empty object. Nonempty unmodeled settings remain unsupported. |
| configuration.save_item_for_future | Documented writable boolean; preserve the actual preference. |
| unilateral, bank-only/VBA flags, group_draft, archived | Legacy response extensions: accept only the observed inactive false values. Keep them separate from the documented PUT and bind them into preflight/readback compatibility checks. Unknown/enabled features remain unsupported. |
| detail.category_code | Only the observed SHIPPABLE value is supported; it is not claimed globally read-only. Check exact compatibility preservation. |
| detail.viewed_by_recipient | Validate boolean observational metadata; exclude from financial fingerprints so viewing does not invalidate approval or block paid reconciliation. PayPal documents a viewed lifecycle stage. |
| Zero tax/discount aggregates | Validate strict nested GBP zero-only response totals. Real tax/discount, shipping, unknown fields and line-level complexity still fail closed. |
| Added due date | Accept only an additive due_date equal to the unchanged valid invoice_date when both terms are DUE_ON_RECEIPT and the approved intent had no due_date. Every other writable field remains exact. Existing/custom/different dates are never normalized away. |

The due-date exception is a one-way postwrite/recovery comparison. It does not relax stale preflight fingerprints or remove the actual date from stored observations. Customer grants remain hashed against the actual writable invoice.

## Actual guarded test

1. User authorized app creation/agreement and local credential storage, then separately approved Invoicing. Existing sandbox seller/buyer details saved privately; no extra accounts created.
2. OAuth required scopes and invoice-list read passed. Exactly one tagged GBP1,250 draft created and its ID privately allowlisted. No replacement invoice created.
3. Real projection/read and send passed. Both recipient/invoicer email notifications were suppressed. Hosted buyer link was obtained from PayPal, not constructed.
4. Prepared the persisted owner-scoped case/proposal and exact before/after payload without approval or financial write. User explicitly approved removal of only the GBP250 Social-media pack, retaining the GBP1,000 Landing page and other supported fields.
5. One approved executor PUT ran. Readback showed GBP1,000 but added same-day due-on-receipt due_date, so the original exact comparison correctly stopped in MANUAL_REVIEW pending investigation. No second PUT was sent.
6. Reproduced the normalization in PostgreSQL, implemented the narrow comparator and tested direct/lost-response recovery plus grant creation. Independent review confirmed the bounds.
7. One-time ignored engineering resolver re-read PayPal, verified original owner/proposal/snapshot/evidence/compatibility and exact intended-state equivalence, then atomically stored the observation, resolved the historical command/case and recorded a read-only recovery audit. It did not rewrite approval intent or send a provider mutation.
8. Buyer personally completed payment and supplied the PayPal success screen. Guarded stage=reconcile, sandbox mode/test=true/write=false, then freshly read the same invoice and persisted payment through the owner-scoped application service: PAID, GBP1,000 paid, GBP0 due. No offline payment, substitute checkout or new invoice was used.

## Verification and private artifacts

Current checks:60 unit tests,21 real PostgreSQL tests,24/24 fixture rules,3 full Chromium browser tests, lint/typecheck and production build passed. Restricted Windows builds intermittently failed EPERM on generated prerender files; the standalone permitted build passed. No live-model calls.

Ignored .local artifacts hold the prepared proposal, actual raw readback, immutable-intent verification, source schema and engineering recovery record. Owner credentials are local/private. Do not publish those files or log buyer/grant tokens. Saved app configuration remains demo with sandbox write/test flags false; capability stages deliberately used per-process flags. Never rerun create, send or correct for this completed operation.

## Genuine webhook test

User explicitly approved the temporary Cloudflare route-only HTTPS endpoint, one CREATED/PAID subscription in the existing sandbox app, and one extra unsent GBP1,250 draft. Public root/customer/health paths were rejected; the database and owner app were never exposed.

Exactly one extra draft was created. A local assertion initially expected UNPAID, but DRAFT correctly projects to UNKNOWN under the existing payment classifier. Read-only recovery verified the unchanged creation/readback fingerprint, total125000p, paid0 and DRAFT status, then registered its separate labelled case. No second create/send/payment occurred; it is not in the financial-write allowlist.

The actual CREATED event nests identity at resource.invoice.id. The previous direct resource.id assumption was reproduced in PostgreSQL and fixed. Signature verification still precedes persistence; routing remains merchant/environment scoped; event payment fields are never treated as authoritative. A bounded independent patch review found no concrete defect.

PayPal redelivery reached the real receiver and passed signature postback verification. Final proof: one durable inbox row, processed=true, one completed reconciliation job, one paypal-sandbox snapshot, zero money commands. A real signed duplicate was logged as duplicate and created no extra row/job/snapshot. Replay requests were bounded; cumulative tunnel error counters included earlier failed attempts and were not used as duplicate-delivery proof.

The temporary subscription was deleted, its retired local ID cleared, and the tunnel/gateway stopped. The unsent test draft and private evidence remain for audit. Final original-invoice reconciliation still confirms100000p paid,0 due and25000p removed. No payment was repeated. A CREATED test is not a claim of observed PAID/UPDATED delivery.
