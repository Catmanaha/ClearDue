# Private setup and operations

Configure `.env` privately from `.env.example`. Never paste or commit secrets. External calls default off.

## Local demo and database
Docker Desktop must be running. Compose binds PostgreSQL only to127.0.0.1 and persists its volume.
For another PostgreSQL17 instance set DATABASE_URL, create a dedicated cleardue_test database and set TEST_DATABASE_URL. Do not substitute SQLite.
Migrations run separately before web/worker. Seed is idempotent and preserves progress. Start worker independently.
Reset only synthetic demo data with `RESET_DEMO_DATA=true pnpm db:reset:demo` (PowerShell: set `$env:RESET_DEMO_DATA='true'` first). Stop worker during reset; queue schema must already be initialized. No reset on startup. Back up data before deletion; this reset is intentionally gated.

## Restricted owner/judge accounts
Set random32+ BETTER_AUTH_SECRET and OWNER_EMAILS. Public signup is disabled. For CLI provisioning set CLEARDUE_OWNER_EMAIL to an allowlisted email and CLEARDUE_OWNER_PASSWORD to a private12+ password, then `pnpm db:owner`; remove the password environment variable afterward. The CLI prints only an account ID and never creates a login session. Keep buyer and judge credentials outside public source/submission. The judge can use a privately provisioned account and import the supplied synthetic case; cases are scoped to their owning account. Default demo seed belongs to demo-owner; do not expect a separate judge account to read that actor's data.
Production always requires Better Auth, including a production build running locally. Use `pnpm dev` for the credential-free demo. Database-backed sessions and rate limits persist; secure cookies on HTTPS origins. Case APIs recheck actor ownership and merchant/environment.

## Sandbox capability flow
Use only project-specific sandbox seller and buyer accounts. Set PAYMENT_MODE=sandbox, project PAYPAL_CLIENT_ID/SECRET, PAYPAL_MERCHANT_ID, PAYPAL_SELLER_EMAIL and PAYPAL_BUYER_EMAIL. Explicitly enable PAYPAL_SANDBOX_TEST_ENABLED and PAYPAL_SANDBOX_WRITE_ENABLED only for intended writes.

`pnpm test:paypal` is the executable alternative to Postman. Stages use PAYPAL_CONTRACT_STAGE:
1. `create`: makes one tagged synthetic invoice. Writes require both flags. On unknown outcome, reconcile privately; never rerun blindly. Private response saved in .local/paypal-created.json.
2. Explicitly add its actual ID to PAYPAL_PROJECT_INVOICE_IDS and PAYPAL_CONTRACT_INVOICE_ID. No unrelated invoice IDs.
3. `send`: sends only an allowlisted tagged synthetic draft; update notifications are suppressed. Obtain actual supported recipient payment URL from read details.
4. `read`: conservative projection may reject unsupported fields. Preserve raw response privately for schema review; do not weaken guards just to pass.
5. `prepare`: configure CLEARDUE_OWNER_ID from the restricted account. Persist the owner-scoped case, investigation and exact GBP1,250 -> GBP1,000 proposal plus private before/after/binding artifact. This does not approve or execute the correction. Review the concrete proposal with the owner.
6. Only after explicit approval, `correct` with PAYPAL_CONTRACT_APPROVE_CORRECTION=true consumes that exact prepared proposal through the command/queue pipeline. A running worker may claim it first; inspect its persisted result rather than rerunning. Existing commands and mismatched bindings refuse a repeat correction.
7. Buyer personally opens the corresponding hosted sandbox invoice, signs in as sandbox buyer and pays. Never use a separate checkout or offline record-payment API.
8. `reconcile` with PAYPAL_SANDBOX_WRITE_ENABLED=false refreshes authoritative payment through the prepared owner/case binding and persists it in ClearDue. Require PAID,100000p paid,0 due; record25000p removed separately. `read` only saves an API observation and does not replace this persisted reconciliation. The existing project invoice has completed this flow; see PAYPAL_COMPATIBILITY.md. Never rerun create/send/correct for it.

Never enable live API hosts; adapter fixes api-m.sandbox.paypal.com. No generic HTTP executor is exposed. PUT is full replacement, suppresses notifications and preserves only explicitly supported writable fields; unsupported inputs fail closed. Provider-side conditional locking is unverified; preflight/readback cannot eliminate external races.

## Webhooks and recovery
An authorized reachable HTTPS443 endpoint `/api/webhooks/paypal` and configured PAYPAL_WEBHOOK_ID are required. Subscribe actual sandbox invoicing events in the intended project app. Postback signature verification calls PayPal's documented service; this app never fetches arbitrary certificate URLs. Verified inbox + queue insertion commit before acknowledgment. Simulator events cannot use a bypass. INVOICING.INVOICE.PAID is a trigger for a fresh read, not completion evidence. Capture real delivery proof only after setup.

For a specifically approved temporary local test, `pnpm webhook:gateway` provides a route-only loopback ingress on port3400 to the existing Next web on3000. Set PAYMENT_MODE=sandbox for the gateway and existing web/worker, keep provider writes false, and configure the exact webhook ID before delivery. WEBHOOK_GATEWAY_PORT and WEBHOOK_UPSTREAM_PORT optionally change local ports; no arbitrary upstream host is accepted. The gateway forwards only exact POST `/api/webhooks/paypal`, JSON up to128KB and required PayPal signature headers. All other routes/methods, missing headers and oversized bodies are rejected; cookies/auth/redirects/internal response details are not forwarded. Signature verification and durable business processing remain in Next. No request bodies/headers are logged.

Only after approval, a [Cloudflare Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) can point at this ingress, never directly at Next or PostgreSQL. Vendor documentation describes temporary test URLs, no required account/domain and access for anyone holding the URL; it stops when the process stops. Register that exact HTTPS webhook path in the sandbox app, with only required invoice event subscriptions. This is development tooling, not production/judge hosting. Stop the tunnel/ingress and remove or disable its sandbox subscription after testing. Do not alter global Cloudflare configuration or assume availability/lifetime guarantees.

The existing original invoice has already been paid. A read-only24h event inspection found no replayable PAID event before any webhook subscription existed. Do not pay it again, synthesize a successful event or rerun its correction. Obtain separate explicit approval before creating an additional unsent sandbox draft solely to generate a genuine event; label and track it separately from the completed payment story.

Worker runs a bounded5-minute recovery sweep (up to20 commands,10 recent stale cases within7 days); all authoritative refresh paths share reconciliation. Stale RUNNING becomes UNKNOWN_OUTCOME; no blind retry. Execution/recovery dispatch count is capped at3; queue jobs have at most2 retries. Exhaustion -> audited manual review; manual-review cases leave routine polling. UNKNOWN match -> success; mismatch -> manual review with dependent commands blocked. There is intentionally no generic force-retry financial button. Manual incident resolution requires verified provider state and an audited engineering recovery; no safe automatic rerun is claimed.

## Live AI
The user requires no additional spend. Astropods signup credits are the selected local testing route; the authenticated account has a $10 grant and no payment method. Credits are finite, not an unlimited free AI plan. Do not add a card, buy credits, enable auto-recharge or add paid fallback. Fixture mode remains available and clearly labelled; it is not live AI proof.

This workspace now enables live credit-only AI and internal Studio locally, with labelled demo payments and sandbox writes disabled. Fresh clones still start from gated .env.example defaults. Existing fixture investigations retain their recorded provenance; enabling live mode does not relabel historical findings. Current credit display after testing is about$0.02 used/$9.98 remaining/$0 payable.

Set AI_PROVIDER=astropods, ASTRO_GATEWAY_URL=https://aig.astropods.ai, private ASTRO_GATEWAY_API_KEY, explicit ASTRO_GATEWAY_MODEL and ASTROPODS_CREDIT_ONLY_CONFIRMED=true only after verifying the account's credit/no-card state. The adapter fixes the SDK endpoint to https://aig.astropods.ai/v1 and rejects other origins, paths, credentials and redirects. Both investigators and Studio use this explicitly selected provider; absent Astro settings never fall back to OpenAI. AI_PROVIDER=openai remains an explicit alternative using OPENAI_API_KEY/OPENAI_MODEL, not an automatic fallback.

For authorized calls select AI_MODE=live, enable LIVE_AI_ENABLED and set positive LIVE_AI_DAILY_CALL_LIMIT, LIVE_AI_DAILY_TOKEN_LIMIT and LIVE_AI_MAX_OUTPUT_TOKENS. Current user-approved testing ceilings are32 calls,240000 conservatively reserved tokens per UTC day and2000 output tokens/call, model gpt-5-6-luna. Failed calls consume reservations; SDK retries are disabled. Complete32KB bundles only, no retrieval/truncation; generated source-span metadata and the response schema are included in the reservation. Persist requested and returned model/provider/prompt/usage separately. These ceilings bound usage, not a claim of model accuracy.

The official CLI can remain project-local in ignored .local/astropods, not globally installed. The repository-owned development bootstrap below replaces the old ignored scratch helper. Renewal after expiry on1 November produced a key expiring2026-11-02T16:43:13Z (16:43 London). Earlier starts while the old key was valid reused its cached expiry; never infer renewal merely from successful startup/import. The new key passed real analysis and Studio verification. Never print Docker environment output or run `ast gateway connect`, which rewrites unrelated global assistant settings. A renewable local development credential is not a durable hosted judging credential.

### Reproducible Astropods development setup

Use the official [CLI installation/authentication](https://docs.astropods.com/authentication) and [Gateway](https://docs.astropods.com/ai-gateway) documentation. Download the official standalone CLI for your platform, verify its published checksum, and keep it at an explicit project-local path such as .local/astropods/ast.exe. Do not run a global installer or modify another assistant's configuration. A new account's credit eligibility/amount must be checked; our observed grant is not a promise to every new user.

From the repository root on Windows, after Docker Desktop starts:

```powershell
$clearDueAst = (Resolve-Path .local/astropods/ast.exe).Path
& $clearDueAst login --no-browser
# Complete the device authorization yourself. Check the intended account privately.
& $clearDueAst billing get --json
& $clearDueAst billing status --json
Push-Location dev/astropods-gateway
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
& $clearDueAst spec validate
if ($LASTEXITCODE -ne 0) { throw 'Gateway spec validation failed.' }
& $clearDueAst project start --background --skip-startup --non-interactive
Pop-Location
pnpm ai:gateway:import --cli "$clearDueAst" --model gpt-5-6-luna --confirm-credit-only
```

The tiny bootstrap exposes only a fixed health response, has no business data or model calls, and never mounts the app's .env. Its Docker build context excludes private .env/.ast files. Do not put PayPal or application credentials in the bootstrap's empty .env. The CLI may publish the health port on all host interfaces; this is not the ClearDue app endpoint and must never be extended into an environment/credential server.

The import command makes read-only CLI billing checks and requires active free credit, zero cash payable and no card. It verifies the fixed repository directory, compose project/service, Gateway origin and explicit model before reading only the managed Gateway variables in memory. It changes only ASTRO_GATEWAY_URL/API_KEY/MODEL in the root ignored .env. It does not change provider choice, enabled flags, budgets or PayPal settings. Child output and credentials are not logged. Existing differing settings require --replace; duplicate or multiline dotenv files are refused rather than guessed. Keep .env closed in editors while importing; the command checks for concurrent changes but does not lock arbitrary editors.

Then deliberately configure AI_PROVIDER=astropods, AI_MODE=live, LIVE_AI_ENABLED=true, ASTROPODS_CREDIT_ONLY_CONFIRMED=true and your approved positive daily/output limits. Restart both web and worker. Run `pnpm setup:check`; it reports configuration presence, not a successful model request. Licence rights remain separate. Use fixture mode when genuine provider access is unavailable; never present it as live analysis.

For renewal, stop/start only this development project from dev/astropods-gateway, read the actual expiry the CLI reports, and rerun the import command with --replace. Restart web/worker afterward. The CLI can reuse a still-valid cached key; do not infer a new expiry from the command's success. If renewal/authentication fails, keep the failure explicit. No model call or invoice change is needed to import a key. A long-lived judge-access arrangement remains to be finalized before release; do not rely on today's copied development key through December.

`pnpm eval:live` selects six nominal held-out header variants and saves private findings/usage/latency. These cases have now informed fixes, so subsequent runs are regression evidence, not unseen accuracy estimates. Preserve failed runs, score semantic support/unsafe proposals/abstention manually and reserve genuinely new variants for future held-out claims. The script exits nonzero on incomplete/rejected output and never substitutes fixture success. Source IDs select exact request-local document versions/spans; normal validation still runs. Exact citations alone do not establish semantic support. No hidden reasoning or model write tools are persisted/exposed.

`pnpm eval:fresh --plan` reads the configured limits and numeric daily ledger, and calculates the complete dated-approval case's exact conservative reservation without inference. It requires the live profile to be configured. `pnpm eval:fresh --run` attempts only that one case if it fits, remains subject to the atomic server budget gate, and saves a timestamped private report without replacing earlier evaluation reports. No argument defaults to planning; unknown arguments fail. Expected NO_CHANGE/NONE labels and rationale are in scripts/fixtures/fresh-approval.ts. The first run passed on30 October without a prompt change; future runs are regression evidence. Review semantic support separately. Neither command creates a business case, invoice command, email or payment.

## Studio
`AG_STUDIO_ENABLED=true` mounts AG Studio 3 with three custom widgets for cases, evidence and resolution outcomes. Configure `AG_STUDIO_LICENSE_KEY` for permitted use and verify its domain, AI coverage and expiry. Without a key the SDK shows its internal evaluation notice. The authenticated Studio Agent Framework tool changes validated filters, sorting and layout. It has no invoice actions. The app saves only the supported dashboard settings.

The hosted judge rehearsal verified an authenticated Studio tool call and follow-up reply through Astropods Gateway under an active Pro + AI trial. Recheck the trial through the required judging dates. The optional read-only judge email must be allowlisted in a simulated workspace. That account can inspect saved cases and adjust its view in the browser. Case changes, saved view changes and new AI requests require a separate owner login.

## Data and logs
Only synthetic project data is intended. Text/JSON imports render as text; reject other types. Evidence/proposals are immutable; additions make new records and stale prior approval. Customer grants use random tokens hashed in DB, expire48h and can be revoked. URL fragments keep tokens out of server URLs; referrer policy no-referrer; sensitive APIs no-store. Next incoming request logging disabled. Operational logs use fixed redacted messages; no raw evidence/secrets. Audit is append-oriented by convention, not tamper-proof.
Retention: demo data persists until explicit guarded reset. Before real customer use, implement reviewed retention/deletion, export, backup/restore and access policies. No regulatory compliance or production-readiness claim is made.

## Production browser rehearsal

Run `pnpm test:e2e:production` after migrating the dedicated `TEST_DATABASE_URL` ending exactly `/cleardue_test` (the integration suite prepares it). It builds and starts the actual production web app on loopback3100 plus a fixture-only worker. Do not run other web/worker test instances on that port or database concurrently. It creates an isolated synthetic allowlisted owner, writes only ignored test credentials/results under `.local/production-test`, and preserves existing cases instead of resetting them. Test owner accounts remain in the disposable test database until its normal integration reset.

The profile deliberately sets LOCAL_DEMO_ACCESS=true while NODE_ENV=production; unauthenticated access must still return401. It blanks model/PayPal credentials and disables external flags. The browser suite uses real Better Auth sessions, tests private response headers/cross-owner access, runs investigation/approved fixture correction/customer feedback, and verifies Studio case selection/source links with page-error capture. A shared production demo cannot simulate payments: that endpoint stays restricted to explicit local development demo access. The customer page now reports that capability rather than offering a button that production rejects.

The suite does not prove hosting, sandbox payment/webhook delivery, live AI, Studio entitlement or a fresh-machine setup. Test traces stay private and can contain synthetic session/grant tokens; do not publish them. CI must provide its dedicated PostgreSQL database and Chromium. Existing authentication rate limits remain enabled; the suite reuses one session per worker instead of signing in for every scenario.
