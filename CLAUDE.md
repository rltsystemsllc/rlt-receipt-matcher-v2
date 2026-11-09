# RLT Systems — notes for Claude

RLT Systems LLC is Bobby Turner's electrical contracting company on Maui. Jessica runs the back office.

## How we build agents: follow Charafeddine Mouzouni's method

We like his method (Augment session "Build Your AI Sales Employee", Nov 5 2026). Build and change every agent this way:

1. **Pick the right job.** It should repeat weekly or monthly, have a clear "done", use information we already have, have exceptions we can name, and save at least an hour a month.
2. **Prove it by hand first.** Run it with a person watching before it goes on a schedule. "Prove the processes before you automate them."
3. **Write it down.** Every agent works from one shared business brain: business facts, rates, rules, and step-by-step instructions (SOPs / skills).
4. **Ask before the important steps.** The instructions say where to stop and ask Jessica or Bobby. Agents draft and check. People decide and send.
5. **Define "good enough" as tests.** Write down what a correct result looks like. When a mistake slips through, add a test for it.
6. **Learn from every piece of feedback.** Every agent reads the `feedback` and approved `lessons` collections on the Billing Desk before each run:
   - It turns each new note into a proposed rule (a `lessons` doc with its `agent` id).
   - Jessica approves the rule.
   - From then on the agent applies the rule every run, and the rule gets a test.
7. **Earn trust, then schedule.** Trust levels are: 0 read only → 1 all drafts checked → 2 spot-checked → 3 can send. Moving up needs 20 clean runs and Jessica's OK.
8. **One morning briefing.** The Chief of Staff agent sums up everything daily. Other agents stay quiet unless something is wrong.
9. **Don't chase perfect or fancy.** Build what's essential and define done.

### What an agent is here

- **An agent = a Claude conversation connected to one shared folder of plain text.** Every agent reads the same folder, so there's no wiring between agents.
- **The folder parts:**
  - owner (who we are, voice)
  - business (services, customers, rates)
  - cockpit (where things live, what's in progress)
  - SOPs (one per job, with "ask me first" steps)
  - proof (past jobs, references)
  - tests (what "good enough" means)
  - this file (read first)
- **Build order:** pick the job → write the SOP → write the tests → run once by hand while someone watches → run the tests → fix and update the SOP → schedule. A scheduled run reports either "tests passed" or "needs fixing". A person looks, then says go.
- **How people talk to an agent:** in its own Claude conversation, like talking to an employee. Corrections must end with the agent updating its SOP or tests. The full write-up is in docs/RLT-How-We-Build-Agents.pdf.

## Hard rules

- **No sending.** Agents never send, remind, void, delete, or create payment links in QuickBooks. Bobby sends invoices himself.
- **Sheet write-back waits for Bobby.** "Billed" and the invoice # go back to the job log only after Bobby approves and sends.
- **Bookkeeper notes are off limits.** Never read the "Notes to Bookkeeper" column or put it on an invoice.
- **Ask before outward actions.** Emails and anything a customer would see need Jessica's OK first.
- **Email cleanup is archive-only.** Never permanently delete. Never touch starred, bank, government, tax, or medical mail.

## Where things live

- **Billing Desk (dashboard + shared database):** https://claude.ai/artifact/LN2C3MWwTLto4msHkLs65M
  - Collections: agents, agentlog, feedback, lessons, questions, invoices, meta/briefing, meta/method, meta/pipeline.
- **Daily Job Log sheet:** 1E3VWlRAPMh43ynhJkCg_TRuAUDuIEx_RxUef4UfOKT4
- **QuickBooks:** company "RLT Systems LLC" (realm 9341452362822721), not Read Lighting.
- **Billing agent code:** `src/billing-agent/`; tests in `test/billing-agent.test.js`.

## Rates

- **Labor:** Bobby $150/hr, emergency $300/hr, Kenny/helper $95/hr.
- **Receipt materials:** receipt total + 22% markup, taxable (Hawaii GET 4.712%).
- **Stock items:** Home Depot price + 22%. If Home Depot doesn't sell it, Read Lighting's regular price + 22%. Invoice lines say "from stock".
