# ClearDue

**Fix the reason. Then get paid.** Evidence-backed invoice resolution for creative agencies and freelancers using PayPal.

ClearDue compares an agreement, customer messages and an invoice; shows exact sources; requires owner approval for a narrowly supported correction; and reconciles the resulting invoice/payment state. It does not decide legal entitlement or formal PayPal disputes.

The [current screenshot selection](docs/screenshots/README.md) shows separate-record intake, evidence chronology, linked AG Grid/Studio exploration and customer feedback, with capture dates and explicit provenance.

## Run locally

Requires Node 22.12+ (tested 22.18.0), pnpm 11.25.0 and PostgreSQL 17 (Docker Desktop works). No PayPal, OpenAI or Studio credentials are needed for the explicit local fixture demo.

```powershell
pnpm install --frozen-lockfile
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
docker compose up -d db
pnpm db:migrate
pnpm db:seed
pnpm dev
```

In another terminal, run `pnpm worker`. Open [ClearDue](http://127.0.0.1:3000). Use `127.0.0.1`, matching APP_URL. The local demo bypass is limited to explicit development on loopback. Production requires an allowlisted sign-in.

Run `pnpm setup:check` after migrating. It checks local prerequisites without contacting a model or PayPal; it does not certify provider access, worker liveness or licence rights. For genuine credit-only AI and reproducible local Gateway setup, follow [the provider instructions](docs/SETUP.md#reproducible-astropods-development-setup). No pre-existing ignored helper files are required.

Open Juniper & Co., investigate, inspect the quoted message, explicitly select the extra and attest source review, then approve. The worker verifies a simulated GBP1,250 -> GBP1,000 correction. Create a customer link, open the mobile-friendly resolution page, and use the conspicuously labeled demo payment simulator. Refresh after worker reconciliation. Analytics separates GBP1,000 simulated paid and GBP250 removed. Marlow Goods is the explicit-approval counterexample.

All critical state is in PostgreSQL. Stop/restart web/worker without losing cases or approvals. Compose volumes persist. A DATABASE_URL to an existing dedicated PostgreSQL instance is supported; migrations require schema privileges. Never point tests at customer data.

## Verification

```powershell
pnpm verify
# Dedicated test DB from compose; this explicitly permits clearing only cleardue_test:
$env:ALLOW_TEST_DATABASE_RESET='true'
pnpm test:integration
pnpm test:e2e
pnpm test:e2e:production
```

Install the browser once with `pnpm exec playwright install chromium`. Integration tests initialize the dedicated database, so run them before browser tests. Browser tests launch their own web and worker on port3100. `pnpm verify:local` includes all three groups. See the [evaluation report](docs/EVALUATION.md) for the recorded model checks and their scope.

The separate production profile builds optimized Next.js, uses real owner authentication and a fixture worker, and checks anonymous denial, a guarded correction, customer feedback and Studio/source navigation. Run it after the other browser suite has stopped; it uses the same dedicated test database and port. It does not prove live AI, PayPal delivery, licensing or hosting. Latest local checks include100 unit,24 fixture,34 PostgreSQL,15 development browser and3 production browser passes, with lint/types/build; these groups retain their dated scope. The1 November container refresh and isolated restore matched all33 application/job tables, including case-save receipts. Remote CI and independent-machine setup remain separate gates.

Next's webpack builder is selected after a reproducible Turbopack CSS child-process failure in this Windows environment. ESLint 9 is pinned for Next plugin compatibility. No runtime security notice is waived on that basis.

## Integrations and release gates

- [Private configuration and sandbox buyer steps](docs/SETUP.md)
- [PayPal compatibility notes](docs/PAYPAL_COMPATIBILITY.md)
- [Evaluation report and limitations](docs/EVALUATION.md)

An actual PayPal sandbox correction, hosted test payment, authoritative PAID readback and genuine CREATED webhook deduplication passed. The hosted judge workspace uses ClearDue sign-in, live AI through Astropods and simulated invoices and payments. The recorded demo identifies the separate PayPal sandbox result. Use the access details supplied privately with the entry for the hosted walkthrough.

Studio now contains three custom widgets: an AG Grid Community case explorer, a linked evidence/outcome trail and a separate resolution ledger. Selection/layout persistence passed production browser checks. Fresh live tool/reply checks passed for needs-evidence on empty demo data and confirmed-outcomes on saved sandbox data, including correct mode disclosure and separate amounts. Two additional synthetic investigator cases passed assistant-reviewed source checks; [evaluation details and import bundles](docs/EVALUATION.md) retain their limits. These observations do not establish independent human validation, general model accuracy or commercial entitlement.

MIT applies to newly authored ClearDue code. AG Studio and its commercial dependencies retain their own terms; see [third-party notices](THIRD_PARTY_NOTICES.md).

Portions of this software are copyright 2015-2026 by AG Grid Ltd.
