# Case delay review

Every case owned by the case managers is checked against a five-month plan. When a case is
late, each late day is traced to one reason. The reason can be the client, the petition team,
an outside body, a HubSpot stage that was never moved, or a part of the case manager's
communication.

You get one email with the headline findings and an Excel workbook attached. Read-only: nothing
in HubSpot, Petition Studio or Chatwoot is changed.

**Case managers (15):** Brenda Murowanidzwa · Yamina Sadi · Ali Tariq · Anwar Saeed ·
Tamjeed Zahid · Thushara M S · Rahima Nabili · Warda Badar · Umer Masaud · Hashim Tahir ·
Muhammad Zaryab · Maryam Chand · Muhammad Asad Mir · Fatou Toure · Raza Imran (owner 101619391).

**Cases:** deals in the two service pipelines (USA NIW, and Canada & AUS) whose owner was
assigned on or after 1 January 2026. That is about 2,600 cases: roughly 1,130 USA, 1,320 Canada
and 130 Australia.

---

## Setting it up (once)

1. Create a new **private** repo, for example `hof-case-delay-review`.
2. Upload these files to the root of the repo:
   - `config.js`, `0-hubspot.js`, `1-clock.js`, `2-collect.js`, `3-classify.js`, `4-timeline.js`
   - `5-comms.js`, `6-reader.js`, `7-petition.js`, `8-attribute.js`, `9-whatsapp.js`
   - `10-workbook.js`, `11-email.js`, `report.js`, `selftest.js`, `package.json`
3. Click **Add file → Create new file** and name it `.github/workflows/case-delay-review.yml`
   (typing the slashes creates the folders). Paste in the contents of `case-delay-review.yml`.
4. Go to **Settings → Secrets and variables → Actions** and add these secrets. Most of them
   are the same ones your other agents already use.

| Secret | |
|---|---|
| `HUBSPOT_TOKEN` | the HOF private app token |
| `RESEND_KEY` | the key your other reports send with |
| `PETITION_API_KEY` | the Petition Studio `x-api-key`, for the USA check |
| `GEMINI_KEY` | for the reader (see below). **Use a paid-tier key**: case emails are sent to it |
| `GEMINI_KEY_2` | optional second key, used in turn |
| `CHATWOOT_TOKEN` | optional, so WhatsApp replies and follow-ups are seen |
| `CHATWOOT_URL` | `https://inbox.hofmigration.com` |

Without `PETITION_API_KEY`, USA cases are still reviewed, but who holds a petition comes only
from HubSpot's stage and Petition Status. Without `CHATWOOT_TOKEN`, a client answered only on
WhatsApp counts as not answered. The email says which of these were off.

## Running it

Go to **Actions → Case delay review → Run workflow**.

1. **First time: choose `discover`.** It checks the token can read everything it needs. It also
   counts the cases for each case manager and program, and shows which fields Petition Studio
   returns. No client text is printed. If anything says `!!`, send me the log.
2. **Then choose `report`.** With every box on its default it reviews all 15 case managers and
   all three programs, for cases assigned since 2026-01-01.

| Box | |
|---|---|
| case_managers | `all`, or names / owner ids separated by commas (`Warda, Brenda`) |
| programs | all · USA · Canada · Australia |
| from_date | cases whose owner was assigned on or after this date |
| limit | `all`, or a number (e.g. `50`) for a quick test run |
| send_email | true / false |

A full run takes about 45 to 90 minutes. Every case's history is read one by one, HubSpot is
paced so your other agents keep working, and the reader works through the flagged lines in
batches, most delayed cases first. The email goes to razaali@hofmigration.com. The
workbook is also kept for 7 days on the run's page, under **Artifacts**. It contains client
names, so keep the repo private.

---

## The five-month plan

If the client sends everything and nothing goes wrong, HOF's part finishes in 150 days. The
days are shared between the phases in proportion to how long each phase takes in real cases
today (the median time per stage across 2025 and 2026 cases).

| Program | Phases (days) | Finish line |
|---|---|---|
| USA | Onboarding 3 · Documents and IEE 21 · Phase 2 documents 28 · LOR and brainstorming 21 · Petition writing 40 · Review and amendments 14 · Forms and merging 10 · Filing 13 | Petition filed |
| Canada | Onboarding 3 · Documents and language test 82 · Credential assessment (ECA) 55 · Express Entry profile 10 | Profile submitted |
| Australia | Onboarding 3 · Documents and English test 57 · Skills assessment 80 · EOI and nomination 10 | EOI lodged |

After the finish line, an outside body decides (USCIS, IRCC, the draw). Stages where HOF still
has work get their own allowance: an RFE response 45 days, an ITA application 30 days, a
resubmission 14 days.

- **Should be at** is the phase a case would have reached by today under the plan, counting
  from when it entered the service pipeline. Time on hold is not counted.
- **Behind plan** means the case is still in an earlier phase than that.
- **Days behind** is how long past the date it should have left its current phase.
- **Inherited** is how far behind the case already was when the current case manager took it
  over (taken from the owner history). Inherited delay is shown, but never counted against
  anyone. Many cases were reassigned in January, June, July and October.
- **Finish if no more delay** is where the case would end up from today at the plan's pace.

## Who holds a case, and why a day is late

Each stage is marked with who holds the case there:

- **The case manager:** welcome call, awaiting dispatch, building the Express Entry profile,
  submitting after an ITA.
- **The client:** documents, IELTS, payments. The case manager chases.
- **The petition team:** LOR, brainstorm, writing, review, forms, merging.
- **An outside body:** IEE in process, ECA or skills assessment, after filing.

Some fields can change who holds a case at a given moment:

- For USA cases, HubSpot's Petition Status says when the client holds a petition stage, for
  example "Review Completed – Sent to Client".
- Petition Studio says which role holds it now, and for how long.
- Client Status Non-Responsive counts as waiting on the client.

Each late day since the case manager took the case gets **one** reason. When several apply, the
first one in this list wins:

1. On hold
2. Stage not updated in HubSpot
3. Client email not answered in time
4. Requested call not made
5. Promise not kept
6. No follow-up: a task was due and not done
7. No follow-up: the next task was set too far out
8. No follow-up: no task was set
9. A Petition Studio step waiting on the case manager
10. With the petition team
11. Waiting on the client, with the case manager chasing
12. Waiting on an outside body
13. The case manager's own step not moved

A communication failure only explains a day when it could actually hold the case up:

- **Waiting on the client, or on the case manager:** every communication failure counts.
- **With the petition team:** an unanswered email, a call not made or a broken promise counts,
  because the client is left waiting. A gap in follow-up does not.
- **With an outside body:** none of them count. Those days belong to the outside body.

## The communication rules

These are the case review agent's rules, plus the case manager bot's rules.

| Rule | What is checked |
|---|---|
| Email replies | A client email that asks for something gets a response within **24 working hours**: an email, a connected call or a WhatsApp. Thank-yous, automatic replies and documents sent with nothing asked do not need one. These are the same rules as the daily email-reply report. |
| Requested calls | A client asking for a call, or ringing unanswered, gets a call **the same working day** (after 6pm, by the end of the next). A call made counts even if the client does not pick up. |
| Promises | "I'll call you tomorrow" is kept by the time named. |
| Tasks | Done by the end of the due day: ticked, or the client contacted by then. |
| Complaints | Recorded in a note within 24 working hours. |
| After every call | An email reaches the client that day, a next follow-up task is set, and a connected call has notes. Only a wrong number excuses the email. |
| Follow-up kept up | While live, the client hears from HOF at least every **10** working days while waiting on the client, **5** on the case manager's own step, **10** with the petition team, and **15** with an outside body. |
| Tags | A note that tags someone and asks them to act gets a later note, email or call from them within 48 working hours. Not scored: HubSpot does not let any program read comments. |
| Tone | Only genuinely rude, dismissive or aggressive wording to a client. |

"Working hours" never count Saturday, Sunday or UAE public holidays.

A follow-up gap also says whether the task was the problem:

- a follow-up task was due and not done
- the next task was set too far out
- no task was set at all

## Petition Studio (USA)

Every USA case is matched to its Petition Studio case, by the client's email first and then by
name. A name matching two cases is told apart by the case manager. If it still matches more
than one, it is listed for you to check, not guessed. For each matched case, the review reads:

- its status
- the business hours it has spent in that status, against Petition Studio's own limit
- who holds it now

Petition Studio's own checks are also read: brainstorm overdue, review unanswered, document
audit open, client never invited, approval waiting and so on.

That decides whether a late day sits with the petition team, with the client or with the case
manager. This covers the brainstorm, review, forms and filing steps as well as petition writing.
When Petition Studio is two phases ahead of HubSpot, the stage was simply not updated.

## Things the real data showed, and how they are handled

- **Stages left behind.** Some cases look stalled but have moved on. One Australia case sat at
  "ECA Documents Collection" in HubSpot, but its emails showed the skills assessment lodged and
  the EOI submitted in March. When a staff email subject shows a later step than the stage
  ("Expression of Interest", "Petition package ready for review", "Express Entry profile
  launched"), the case is judged where it really is. The rest is counted as "stage not updated".
- **Tasks ticked in bulk.** On some cases dozens of follow-up tasks were all marked complete in
  the same minute, months late. A tick in a clean-up says nothing about when the follow-up
  happened, so those tasks are judged on the contact logged around them.
- **Marketing.** "Refer and Earn", Eid and Diwali greetings, and any mailing that someone who is
  not a case manager sends to 25+ cases on one day are not follow-ups.
- **The dialler's copy of each call** is folded into one attempt, and its "Call id" line is not
  a call note.
- **Clients with two cases** (a Canada and an Australia file on one contact) are read from each
  deal only, so one case's emails are never counted on the other.

## The workbook

| Tab | |
|---|---|
| Summary | Cases by program; where the late days come from; which part of communication; top root problems; what could and could not be seen |
| By case manager | Cases by program; behind plan; inherited; late days by who they sit with; email replies, calls, follow-up and after-call rules; top cause; worst cases |
| By deal stage | Every stage: the cases there, its allowance, median days, how many are behind, **where they should be by now**, and **why** (late days by reason) |
| Why the delay | Every case behind plan: where it should be, the plan's finish date, the finish date if there is no more delay, late days by reason, and what happened in words |
| Communication | Each part of communication: due, on time, late, not done, and the late days it explains, overall and for each case manager |
| Root problems | The patterns behind the delays, largest first, with where, who and what to do |
| Every finding | Each late or missed obligation, follow-up gap and after-call miss, with the client's words, the times, and any approved leave it overlaps |
| Petition Studio | Every USA case: found or not, status, business hours against the limit, who holds it |
| For your judgement | Things not counted: promises with no clear time, tags with no reply seen, stages out of date, Petition Studio matches to check, Express Entry profiles in the pool for over a year |
| All cases | Every case, one row each |
| How it was checked | Every rule, written out |

## The reader

Some obligations are only in the words: a client asking for a call, a promise with a time, a
complaint, a tag asking a colleague to act, or an unprofessional email. A filter picks out only
the lines that could hold one. Those lines are read by Gemini in batches, most delayed cases
first. The reader is never trusted on its word:

- every item must quote its line, and the quote is checked in code
- a client's words can never become a staff promise
- it never decides whether anything was late

Without `GEMINI_KEY`, call requests come only from clear phrases ("please call me"). Promises,
tags and tone are not checked, and the email says so.

## Things to confirm before using it in reviews

- **The phase split** (in `PROGRAMS`, config.js). It follows today's real timings scaled to five
  months. If you think, say, petition writing should get 30 days and Phase 2 documents 38,
  change the two numbers. Keep each program's total at 150.
- **Who holds each stage.** Forms Filing and Merging are marked as the petition team, and Awaiting
  Dispatch Date as the case manager.
- **The follow-up allowances** (`FOLLOW_UP_EVERY`). 10 working days while waiting on the client is
  generous; set it to 5 for weekly chasing.
- **Leave.** Add approved leave under `LEAVE` in config.js, for example
  `"Warda Badar": ["2026-10-21", "2026-10-22"]`. The client keeps waiting while a case manager is
  away, so the clock keeps running. Every finding that falls in the leave is marked in the
  On leave column of Every finding, so you can see where cover was needed.
- **2027 holidays.** Add them to `HOLIDAYS` once announced. The report warns when a year has none.

## Limits

- Calls, emails and WhatsApps not logged in HubSpot (or Chatwoot) cannot be seen.
- Note comments cannot be read.
- Who held a petition stage in the past comes from Petition Status history. Petition Studio
  shows only where each case is today.
- The built-in Resend sender reaches only your own address. To send to your manager, verify
  hofmigration.com in Resend, then set `FROM_EMAIL` and `CC` in config.js.

## Changing a rule

Every rule is in `config.js`, in plain words, and every rule has a test in `selftest.js`. The
test runs before each review and shows `100 passed, 0 failed`. If a rule stops behaving, the
review does not go out.
