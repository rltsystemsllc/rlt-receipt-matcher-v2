# RLT Billing Agent

Turns Bobby's Daily Job Log (Google Form → Sheet) into **draft** invoices in the RLT Systems
QuickBooks company, then texts Bobby a picture of each one.

Runs alongside Bot 2. Bot 2 gets removed once this one is proven.

## What it does

1. Reads rows in `Form Responses 1` with a blank / "Not Billed" status and no Invoice #.
2. Groups them by customer + project.
3. Matches each group to a QBO customer: the `Customer Map` tab first, then an exact name match, then Claude.
   Only a **high-confidence** match is drafted.
4. Prices it **in code**:
   - Bobby: $150/hr, or $300/hr when Emergency Rate = Yes
   - Kenny: $95/hr (from a "Kenny's Hours" form question)
   - Receipts: billable QBO expenses for that customer, +22%
   - Stock/truck materials: a $0 "PRICE NEEDED" line for Bobby to price in QBO
5. Runs the guardrails, then creates a draft and marks the rows `Draft Created` + Invoice #.
6. Texts Bobby and Jessica a picture of the invoice. Replies:
   - `OK 1042` → rows become `Approved by Bobby`
   - `FIX 1042 wrong customer` → rows become `Needs Fix`

A person still sends every invoice from QBO.

## Guardrails (the harness)

| Rule | Where |
|---|---|
| The only QBO calls are reads, create invoice, and fetch PDF. No send, void, delete, or new customers | `qbo.js` allowlist |
| Refuses to run if the QBO company name doesn't contain `BILLING_AGENT_QBO_COMPANY` | `qbo.verifyCompany` |
| AI never produces a dollar amount; its text is checked before use | `pricing.js`, `ai.js` |
| The "Notes to Bookkeeper" column is never read | `sheet.js` |
| Columns are found by header name, not position | `sheet.js` |
| Rows are locked (`Drafting…`) before the invoice is created, so no duplicates | `index.js` |
| Receipts already billed are tracked in the log tab, so they're never billed twice | `sheet.readBilledExpenseKeys` |
| Blocks: >12 hrs/row, total >$10k, missing/uncertain customer, nothing billable | `guardrails.js` |
| Blocked jobs → `Needs Review` + one text listing why | `index.js` |

To re-run a blocked job: fix the issue (e.g. add a row to `Customer Map`) and clear its Billing Status.

## Schedule (Hawaii time)

- Every 15 min: jobs with Urgent Billing = Yes (draft mode only)
- Fridays 3pm: everything unbilled

## Rollout

1. In the form, add the question **"Kenny's Hours Worked"** (number, optional).
2. Optional: add a `Customer Map` tab with columns `Sheet Name | QBO Customer ID`.
3. Connect QBO to the **RLT Systems** company: `/auth/quickbooks`.
4. Set `BILLING_AGENT_ENABLED=true`, `BILLING_AGENT_MODE=dry_run`, `BILLING_AGENT_TOKEN`, and optionally `ANTHROPIC_API_KEY`.
5. Dry run:
   `curl -X POST $URL/billing-agent/run -H "x-billing-agent-token: $TOKEN" -H "content-type: application/json" -d '{"mode":"dry_run"}'`
   Check the `Billing Agent Log` tab against what you'd have billed.
6. When it looks right, set `BILLING_AGENT_MODE=draft`.
7. Turn off Bot 2: `BOT2_SCHEDULER_ENABLED=false`.

## Tests

`npm test`
