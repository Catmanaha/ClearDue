# Judge walkthrough

Use the private login supplied with the hackathon entry. The hosted workspace is read-only and uses simulated invoices and payments.

1. On the case queue, start with **Review the questioned extra**. Read the finding, then open the cited customer message. The customer asked to check with a business partner; the owner needs clarification or a reviewed correction.
2. Return to **All cases** and choose **Compare the approved extra**. Open the record containing explicit approval and see why the original charge stays.
3. For the separately saved AI finding, open **Judge access check (live)**. In **Case analytics**, select the same case and follow **Read cited quote** to its original record.

The first two examples use saved fixture analysis and say **Example analysis · no AI**. Their £1,250 invoices remain unpaid and unchanged. The saved AI finding has its own provenance label. Viewing these cases makes no model calls and cannot approve corrections or payments. The video separately presents the verified PayPal sandbox correction and payment in test funds.

## Operator preparation

Configure the existing judge address in `READ_ONLY_JUDGE_EMAIL` and `OWNER_EMAILS`. Run `pnpm db:judge-examples` with `PAYMENT_MODE=demo`, `AI_MODE=fixture`, `LIVE_AI_ENABLED=false` and both PayPal sandbox gates disabled. The command creates separate cases through normal intake and investigation services. Repeating it reuses matching saved examples. It refuses changed examples instead of replacing their evidence or findings.

The container's manual setup task accepts `CLEARDUE_SETUP_TASK=judge-examples`; this mode forces fixture analysis and disables model and PayPal writes in its child process. Ordinary empty-database bootstrap retains its occupied-database refusal. Starting links appear only when both findings match their current evidence and invoice versions.

## Verification on 4 November 2026

The isolated release passed lint, types, 100 unit tests, 24 fixture cases, 38 PostgreSQL integration tests, the optimized build and all four production browser tests. Both container targets built. The setup rehearsal preserved existing test records on replay and confirmed that ordinary bootstrap refuses an occupied database. Desktop and 390px mobile layouts were inspected. These checks made no model calls or provider invoice operations. Independent human usability observation remains pending.

The hosted update passed HTTPS health, protected sign-in, both comparison links, cited-source navigation and 390px layout. All eight original cases retained their financial, evidence, analysis and command data; only scheduled invoice-observation timestamps advanced. The saved dashboard view was unchanged. Ten cases are now available. The hosted walkthrough blocked all non-read requests after sign-in and made zero model calls.
