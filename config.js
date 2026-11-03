// config.js — Case delay review. SAFE TO EDIT.
//
// Every rule is written out here in plain words, and repeated in the "How it was checked"
// tab of every report. If a rule is wrong, change it here, never quietly in the code.
// Which case managers and which programs are chosen when you press Run workflow.

const SETTINGS = {
  // ------------------------------------------------------------------ who and when
  // HubSpot owner id -> name. Ids are used, not names, so a renamed user cannot drop out.
  CASE_MANAGERS: {
    "362254136": "Brenda Murowanidzwa",
    "82943802": "Yamina Sadi",
    "86814673": "Ali Tariq",
    "87160491": "Anwar Saeed",
    "88038567": "Tamjeed Zahid",
    "475397717": "Thushara M S",
    "1844235827": "Rahima Nabili",
    "89930419": "Warda Badar",
    "93944662": "Umer Masaud",
    "93819566": "Hashim Tahir",
    "96187067": "Muhammad Zaryab",
    "97008108": "Maryam Chand",
    "100443134": "Muhammad Asad Mir",
    "100464860": "Fatou Toure",
    "101619391": "Raza Imran",
  },
  // A case is in the review when its current owner is one of the above and the owner was
  // assigned on or after this date (HubSpot's "Owner assigned date").
  FROM_DATE: "2026-01-01",

  // ------------------------------------------------------------------ the clock
  // "24 hours" means 24 working hours: Saturday, Sunday and UAE public holidays are not
  // counted, the same rule as the WhatsApp and email-reply reviews. Friday 3pm is due
  // Monday 3pm.
  TZ_OFFSET_HOURS: 5,                  // Pakistan time
  WEEKEND_DAYS: [6, 0],                // Saturday and Sunday
  HOLIDAYS: [                          // UAE private-sector public holidays, as announced
    "2026-01-01",
    "2026-03-19", "2026-03-20", "2026-03-21",
    "2026-05-26",
    "2026-05-27", "2026-05-28", "2026-05-29",
    "2026-06-15",
    "2026-08-28",
    "2026-12-02", "2026-12-03",
  ],
  // Approved leave, as "Name": ["2026-10-21", ...]. The client keeps waiting while a case
  // manager is away, so the clock keeps running; the rows are marked so cover can be seen.
  LEAVE: {
    // "Warda Badar": ["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-26"],
  },

  // ------------------------------------------------------------------ the communication rules
  // 1. A client email that asks for something gets a response within 24 working hours: an
  //    email to the client, a call that connected, or a WhatsApp (if Chatwoot is connected).
  //    Thank-yous, acknowledgements, automatic replies and documents sent with nothing asked
  //    do not need a reply.
  EMAIL_REPLY_HOURS: 24,
  // 2. When a client asks for a call, or rings and is not answered, a call is made the same
  //    working day. After this hour (Pakistan time) it is due by the end of the next one.
  CALL_SAME_DAY_CUTOFF_HOUR: 18,
  // 3. A promise ("I will call you tomorrow") is kept by the time named. With no clock time,
  //    by the end of that day. A promised day that is a day off moves to the next working day.
  // 4. A follow-up task is done by the end of its due day. It counts as done if it was ticked
  //    by then, or if the client was actually contacted on or before that day.
  // 5. A client complaint is recorded in a note within 24 working hours.
  COMPLAINT_NOTE_HOURS: 24,
  // 6. The case manager bot rules, for every day a call was made:
  //    - an email goes to the client the same day (only a wrong number excuses it)
  //    - an open follow-up task exists at the end of that day
  //    - a call where the client was reached says what was discussed
  CALL_EMAIL_SAME_DAY: true,
  CALL_NEXT_TASK: true,
  CALL_DESCRIPTION: true,
  // 7. Tagged and not answered: a note that tags someone and asks them to do something is
  //    answered by a later note from that person within this many working hours.
  //    HubSpot does not let any program read note comments, so a reply left as a comment
  //    cannot be seen. These are shown separately and never counted in anyone's score.
  MENTION_REPLY_HOURS: 48,
  // 8. Follow-up must not lapse. While a case is live, the client hears from HOF at least
  //    this often (working days), depending on who holds the case at that moment:
  FOLLOW_UP_EVERY: {
    client: 10,      // waiting on the client (documents, tests, payments): chase every 2 weeks
    cm: 5,           // the case manager's own step: something happens every week
    petition: 10,    // with the petition team: keep the client updated every 2 weeks
    external: 15,    // with an outside body (WES, VETASSESS, USCIS, IRCC): update every 3 weeks
  },
  // What counts as hearing from HOF: an email to the client, a call to the client (picked up
  // or not), a meeting, a WhatsApp, or a follow-up task ticked by its owner (case managers
  // often follow up on WhatsApp and tick the task). Marketing emails do not count.
  COMPLETED_TASK_COUNTS_AS_FOLLOW_UP: true,
  FOLLOW_UP_TASK: /follow|update|chase|remind|check.?in|call|whatsapp|contact|reach|status|pending|document|docs|ielts|eca|payment|reminder/i,

  // ------------------------------------------------------------------ what is not a follow-up
  // Marketing and greetings sent to clients. Matched on the subject.
  MARKETING_SUBJECTS: /refer (and|&|n) earn|ramadan (mubarak|kareem)|eid (mubarak|ul|al)|happy (new year|eid|diwali|holidays|independence|national)|(diwali|eid|ramadan|christmas|new year|holiday|festive|season'?s) (greetings|wishes)|(greetings|wishes) from (hof|all of us)|newsletter|webinar|special offer|exclusive offer|discount|black friday|national day|independence day|christmas/i,
  // An email with the same subject, from the same sender, to this many different cases on one
  // day, by someone who is not one of the case managers, is a mailing and does not count.
  // (Replies never count as a mailing, and the number is set high so that a colleague sending
  // the same checklist to several new clients in a day is not mistaken for one.)
  BULK_MIN_CASES: 25,
  // Tasks ticked together: this many tasks on one case completed within two minutes of each
  // other were closed in bulk, so their completion time says nothing about when they were done.
  BULK_TASKS: 4,

  // ------------------------------------------------------------------ who the client is
  INTERNAL_DOMAINS: ["hofmigration.com", "hof-global.com"],
  AUTOMATED_SENDERS: /(^|[._-])(no-?reply|do-?not-?reply|donotreply|notifications?|notify|mailer-daemon|postmaster|bounces?|alerts?|newsletters?|calendar-notification|drive-shares|auto-?confirm|system)([._-]|@)/i,
  AUTOMATED_DOMAINS: ["docusign.net", "docusign.com", "zoom.us", "calendly.com", "hubspot.com", "hs-email.com",
    "linkedin.com", "facebookmail.com", "carnegieevaluations.com", "uscis.dhs.gov", "fireflies.ai", "google.com"],
  AUTOMATED_SUBJECTS: /^\s*(automatic reply|auto-?reply|autoreply|out of (the )?office|ooo\b|undeliverable|undelivered|delivery status notification|mail delivery (failed|subsystem)|returned mail|read:|accepted:|declined:|tentative:|tentatively accepted|invitation:|updated invitation|canceled event|cancelled event|new event:)/i,
  COUNT_DOCUMENTS_ONLY: false,         // true = documents sent with nothing asked also need a reply
  LONG_MESSAGE_CHARS: 500,             // a message this long with no clear question is counted, to be safe
  ACK_MAX_CHARS: 200,                  // a thank-you longer than this is read as a real message

  // ------------------------------------------------------------------ calls
  CONNECTED_DISPOSITION: "f240bbac-87c9-4f6e-bf70-924b57d47db7",   // HubSpot's "Connected"
  WRONG_NUMBER_DISPOSITION: "17b47fee-58de-441e-a44c-c6300d46f273",
  CONNECTED_MIN_SECONDS: 60,           // a call this long counts as connected, unless its outcome says otherwise
  NOT_CONNECTED_DISPOSITIONS: [
    "73a0d17f-1163-4015-bdd5-ec830791da20",  // No answer
    "9d9162e7-6cf3-4944-bf63-4dff82258764",  // Busy
    "17b47fee-58de-441e-a44c-c6300d46f273",  // Wrong number
    "b2cf5968-551e-4856-9783-52b3da59a7d0",  // Left voicemail
    "a4c4c377-d246-4b32-a13b-75a56a4cd0ff",  // Left live message
  ],
  // The ZIWO dialler logs its own copy of each call. Calls by one person within this many
  // minutes are one attempt, and a dialler "Call id" line is not a description.
  SAME_CALL_MINUTES: 10,

  // ------------------------------------------------------------------ the reader
  // Some obligations are only in the words: a client asking for a call, a promise with a time
  // on it, a complaint, a tag asking a colleague to act, or an unprofessional email. A cheap
  // filter picks out only the lines that could hold one; the reader checks those, and every
  // item it returns must quote its line, which is verified in code. It never decides lateness.
  // Off by default. Turn it on only with a Gemini key whose Google project has billing on:
  // Google's terms for the free tier say not to send personal information, and the reader
  // sends clients' own words. While it is off, call requests, complaints and promises are
  // taken from clear phrases only ("please call me", "I will call you tomorrow at 3pm"), and
  // tags and tone are not checked.
  USE_AI_READ: false,
  AI_MODELS: ["gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest"],
  AI_BATCH_LINES: 40,
  AI_BATCH_CHARS: 16000,
  // At most this many requests per run. Delayed cases are read first, most delayed first.
  AI_MAX_REQUESTS: 400,

  // ------------------------------------------------------------------ other channels
  // WhatsApp (Chatwoot) is only ever used to clear a case manager: an email answered there, or
  // a follow-up made there, is not a failure. Nothing found there counts against anyone.
  USE_WHATSAPP: true,
  // Chatwoot is read client by client, so only the clients where WhatsApp could change the
  // answer are looked up: the cases with the most late days put down to an unanswered email or
  // missing follow-up first, up to this many.
  WHATSAPP_MAX_CLIENTS: 600,
  CHATWOOT_URL: process.env.CHATWOOT_URL || "https://inbox.hofmigration.com",
  CHATWOOT_ACCOUNT_ID: process.env.CHATWOOT_ACCOUNT_ID || "",
  // Petition Studio, for USA cases. Read-only.
  USE_PETITION_STUDIO: true,
  PETITION_API_BASE: process.env.PETITION_API_BASE || "https://api.petition.hofmigration.com",
  PETITION_DASHBOARD: "https://petition.hofmigration.com/dashboard",
  PETITION_CONCURRENCY: 3,
  PETITION_SEARCH_LOOKUPS: 250,        // cases not found in the list are searched by name, at most this many

  // ------------------------------------------------------------------ the report
  PORTAL_ID: "23735726",
  REPORT_TO: process.env.REPORT_TO || "razaali@hofmigration.com",
  CC: [],                              // only after hofmigration.com is verified in Resend
  FROM_EMAIL: process.env.FROM_EMAIL || "onboarding@resend.dev",
  TARGET_PCT: 85,
  EMAIL_MAX_BYTES: 95000,              // Gmail clips an email over about 102KB
  OUT_DIR: "out",

  // ------------------------------------------------------------------ HubSpot pacing
  SEARCH_RPS: Number(process.env.SEARCH_RPS || 4),                      // HubSpot allows 5 searches a second for the whole account
  API_RPS: Number(process.env.API_RPS || 8),
  CHUNK: 100,                          // cases read together
  HISTORY_CONCURRENCY: 4,
  READ_BUFFER_DAYS: 30,                // activity is read from this long before the review starts
};

// ====================================================================================
// THE PROGRAMS, THEIR PHASES, AND THE 5-MONTH PLAN
//
// If the client sends everything and nothing goes wrong, HOF's part of a case finishes in
// about five months (IDEAL_DAYS). Those days are shared between the phases below. The split
// follows how long each phase takes in real cases today (the median time per stage across
// 2025-2026 cases), scaled down so the whole case fits in five months.
//
// Each stage says who holds the case while it sits there:
//   cm        the case manager's own step
//   client    waiting on the client (documents, test, payment); the case manager chases
//   petition  with the petition team (USA)
//   external  with an outside body; nobody at HOF can speed it up
//   done      finished
// Days are calendar days. A case "should be at" the phase it would have reached by today
// under this plan, counting from when it entered the service pipeline (time on hold is
// not counted).
// ====================================================================================
const IDEAL_DAYS = 150;

const PROGRAMS = {
  USA: {
    label: "USA (EB-2 NIW)",
    pipeline: "149481597",
    finishLabel: "Petition filed",
    phases: [
      { key: "onboarding", label: "Onboarding", days: 3, stages: { "253814309": "cm", "253513090": "cm" } },
      { key: "docs", label: "Documents and IEE", days: 21, stages: { "253513091": "client", "1368988085": "cm", "969395090": "client", "969395091": "external" } },
      { key: "phase2", label: "Phase 2 documents", days: 28, stages: { "969395092": "client" } },
      { key: "lor", label: "LOR and brainstorming", days: 21, stages: { "1366400344": "petition", "1274781821": "petition" } },
      { key: "writing", label: "Petition writing", days: 40, stages: { "253513092": "petition" } },
      { key: "review", label: "Review and amendments", days: 14, stages: { "969395093": "petition", "1366400343": "petition" } },
      { key: "forms", label: "Forms and merging", days: 10, stages: { "1274699901": "petition", "1274699902": "petition" } },
      { key: "filing", label: "Filing", days: 13, stages: { "253513093": "client", "969395094": "client", "1091997759": "cm" } },
    ],
    // After HOF's part: each has its own allowance (days), or none when an outside body decides.
    after: {
      "969395095": { type: "external" },                 // Petition Filed
      "1180615581": { type: "external" },                // Tracking Notice
      "253513094": { type: "external" },                 // Waiting for Appointment
      "1135877127": { type: "petition", days: 45 },     // RFE: the response is prepared in 45 days
      "1135877128": { type: "cm", days: 14 },           // Re-Send Petition
      "253513096": { type: "done" },                     // Visa Granted
      "969395096": { type: "done" },                     // Visa Denied
    },
  },
  Canada: {
    label: "Canada",
    pipeline: "26920574",
    finishLabel: "Express Entry profile submitted",
    phases: [
      { key: "onboarding", label: "Onboarding", days: 3, stages: { "61555840": "cm", "61555841": "cm" } },
      { key: "docs", label: "Documents and language test", days: 82, stages: { "61555842": "client", "61555843": "client", "61555844": "client", "159997242": "client" } },
      { key: "eca", label: "Credential assessment (ECA)", days: 55, stages: { "61555845": "external" } },
      { key: "profile", label: "Express Entry profile", days: 10, stages: { "121557414": "cm" } },
    ],
    // "Express Entry & PNP" is HOF's step until the profile is submitted; after that the case
    // waits in the pool. SUBMITTED_STATUSES decide which (from Application Status).
    finishStage: "121557414",
    after: {
      "121557414": { type: "external" },                // in the pool, waiting for a draw
      "121557415": { type: "cm", days: 30 },            // NOI/ITA: the application is submitted in 30 days
      "121557416": { type: "external" },                // NOI Submission
      "121557417": { type: "external" },                // Waiting for Nomination
      "121557418": { type: "external" },                // Waiting for COPR
      "245698165": { type: "cm", days: 14 },            // Resubmission
      "121557419": { type: "done" },                     // COPR Received
      "1283232271": { type: "done" },                    // Completely Closed
      "1284467736": { type: "done" },                    // Visa Granted - Completely Closed
    },
  },
  Australia: {
    label: "Australia",
    pipeline: "26920574",
    finishLabel: "EOI lodged",
    phases: [
      { key: "onboarding", label: "Onboarding", days: 3, stages: { "61555840": "cm", "61555841": "cm" } },
      { key: "docs", label: "Documents and English test", days: 57, stages: { "61555842": "client", "61555843": "client", "61555844": "client", "159997242": "client" } },
      { key: "eca", label: "Skills assessment", days: 80, stages: { "61555845": "external" } },
      { key: "profile", label: "EOI and nomination", days: 10, stages: { "121557414": "cm" } },
    ],
    finishStage: "121557414",
    after: {
      "121557414": { type: "external" },
      "121557415": { type: "cm", days: 30 },
      "121557416": { type: "external" },
      "121557417": { type: "external" },
      "121557418": { type: "external" },
      "245698165": { type: "cm", days: 14 },
      "121557419": { type: "done" },
      "1283232271": { type: "done" },
      "1284467736": { type: "done" },
    },
  },
};
// Application Status values that mean the Express Entry profile / EOI is submitted.
const SUBMITTED_STATUSES = ["Submitted", "Approved", "Registered", "Nominated", "Visa Stamped"];

// Which program a case belongs to. The USA pipeline is USA. In the Canada & AUS pipeline the
// Immigration Program field decides; if it is empty or holds both, the deal name decides
// ("- AUS", "Australia"); otherwise Canada.
const PROGRAM_VALUES = {
  Australia: ["Australia", "AUS VV", "AUS STU"],
  Canada: ["Canada Single", "Canada Dual", "SINP", "Canada", "LMIA", "CA VV", "CA STU", "Caregiver Pilot Program", "ITA Fee", "COPR Fee"],
  USA: ["USA NIW"],
};
const NAME_SAYS_AUSTRALIA = /\b(aus|australia|australian)\b/i;
const NAME_SAYS_CANADA = /\b(can|canada|canadian|cad)\b/i;

// ------------------------------------------------------------------ who holds a petition stage
// HubSpot's Petition Status and LOR Status say who holds a USA case while it is with the
// petition team. These values mean the client holds it, so the case manager must chase.
const PETITION_STATUS_CLIENT = ["Waiting on Client – Brainstorm Answers", "Model Plan and Endeavor - Client Review",
  "Review Completed – Sent to Client", "Petition Package - Client Amendments"];
const LOR_STATUS_CLIENT = ["Client Amendment", "Finalized"];

// ------------------------------------------------------------------ client status
// Client Status and Application Status can hold several values at once ("Active;On-Hold").
const STATUS_RULES = {
  closed: ["Refund", "Voluntary Closure", "Bad Debt", "Process Completed", "Inactive"],
  paused: ["On-Hold", "Deferred"],
  unresponsive: ["Non-Responsive"],
  appClosed: ["Completely Closed", "Withdrawn", "Refund", "Bad Debt", "Rejected"],
  appPaused: ["Paused/On-Hold"],
  appClient: ["Waiting for IELTS", "Waiting for TEF", "IELTS Stage", "Non-Payment", "Document Collection", "Phase 2 Document Collection", "Passport Request"],
};

// ------------------------------------------------------------------ stage not updated
// A staff email to the client, or a note, that shows the case has moved further than its
// HubSpot stage. Subjects are used for emails, because a subject like "Expression of
// Interest (Australia) Subclass 189" is clear; notes must say it happened.
// phase: the phase key the case has at least reached; "finished" = HOF's part is done.
const MILESTONES = {
  USA: [
    { phase: "finished", subject: /\b(petition (has been |was )?filed|uscis receipt|receipt notice|i-?797)\b/i, note: /\b(petition (has been |was )?filed|filed (the|his|her) petition|receipt notice (received|issued)|i-?797 received)\b/i },
    { phase: "forms", subject: /\b(forms? (are |is )?ready for (your )?signature|sign(ing)? the (uscis )?forms|g-?1145|i-?140 (form|signature))\b/i, note: /\b(forms (have been |were )?(prepared|completed)|i-?140 prepared)\b/i },
    { phase: "review", subject: /\b(petition (package )?(drafts? )?(is |are )?ready|petition package|draft petition|petition for (your )?review)\b/i, note: /\b(petition (package|draft) (is |has been )?(ready|completed|shared))\b/i },
    { phase: "lor", subject: /\b(brainstorm(ing)? (questions|session|meeting|call)|model plan|proposed endeavou?r)\b/i, note: /\b(brainstorm\w* (session )?(done|completed|held|conducted))\b/i },
  ],
  Canada: [
    { phase: "finished", subject: /\b(express entry (and|&) pnp expression|profile (has been |is )?(created|submitted|launched|live)|launching your profile|expression of interests? (submitted|lodged)|eoi (submitted|lodged))\b/i, note: /\b((ee|express entry) profile (has been |was )?(created|submitted)|profile submitted|eoi (submitted|lodged))\b/i },
    { phase: "profile", subject: /\b((eca|wes) (report|evaluation) (is )?(ready|received|completed)|wes (evaluation )?completed)\b/i, note: /\b((eca|wes) (report )?(received|completed))\b/i },
    { phase: "eca", subject: /\b((eca|wes) (application|order) (submitted|placed|created)|wes reference)\b/i, note: /\b((eca|wes) (application )?(submitted|applied|lodged))\b/i },
  ],
  Australia: [
    { phase: "finished", subject: /\b(expression of interest|eoi (submitted|lodged)|skillselect)\b/i, note: /\b(eoi (has been |was )?(submitted|lodged))\b/i },
    { phase: "profile", subject: /\b((vetassess|engineers australia|acs|aitsl|anmac|skills? assessment)\b[^\n]{0,60}\b(outcome|positive|result|successful))\b/i, note: /\b(skills? assessment (outcome )?(received|positive|completed))\b/i },
    { phase: "eca", subject: /\b((vetassess|engineers australia|acs|aitsl|anmac|skills? assessment)\b[^\n]{0,40}\b(application|submitted|lodged|priority|completed))\b/i, note: /\b(skills? assessment (submitted|lodged|applied))\b/i },
  ],
};

// ====================================================================================
// PETITION STUDIO — who owns each status, and how long it may take (business hours, as the
// API counts them). Same figures as the Petition Studio compliance agent.
// ====================================================================================
const PS_STATUS = {
  intake:          { label: "Onboarding & documents",         owner: "client",                breachHours: null, rank: 2 },
  ai_reading:      { label: "Case analysis (initial reading)", owner: "petition_writer",       breachHours: 24,   rank: 3 },
  profile_review:  { label: "Writer assignment & analysis",   owner: "petition_writer",       breachHours: 72,   rank: 3 },
  advanced_review: { label: "Advanced review / brainstorm",   owner: "brainstorm_specialist", breachHours: 144,  rank: 3 },
  ai_drafting:     { label: "Drafting",                        owner: "petition_writer",       breachHours: 120,  rank: 4 },
  internal_review: { label: "Internal review",                 owner: "reviewer",              breachHours: 96,   rank: 5 },
  forms:           { label: "Forms",                           owner: "forms_specialist",      breachHours: 72,   rank: 6 },
  ready_to_file:   { label: "Ready to file",                   owner: "case_manager",          breachHours: 24,   rank: 7 },
  filed:           { label: "Filed",                           owner: null,                    breachHours: null, rank: 8 },
};
// HubSpot phase keys in the same order, so the two can be compared.
const PS_RANK_OF_PHASE = { onboarding: 1, docs: 2, phase2: 2, lor: 3, writing: 4, review: 5, forms: 6, filing: 7, finished: 8 };
const PS_CLOSED = ["filed", "closed", "cancelled", "withdrawn"];
// The Petition Studio checks that point at one role. Each is one filtered query.
const PS_PROBES = [
  { id: "brainstorm_overdue", filter: { brainstorm: "overdue" }, owner: "brainstorm_specialist", text: "the brainstorm slot passed and nothing was captured" },
  { id: "drafting_escalated", filter: { drafting_health: "escalated" }, owner: "petition_writer", text: "the drafting review loop hit its retry limit" },
  { id: "review_unanswered", filter: { reviewer_queue: "awaiting_me" }, owner: "reviewer", text: "the writer asked for a review and no reviewer responded" },
  { id: "no_reviewer", filter: { reviewer_queue: "no_reviewer" }, owner: "case_manager", text: "no reviewer is assigned" },
  { id: "audit_over_5d", filter: { audit_age: "over_5d" }, owner: "processor", text: "the document audit has been open for more than 5 days" },
  { id: "intake_needs_review", filter: { intake_state: "needs_review" }, owner: "case_manager", text: "the client submitted the intake form and nobody reviewed it" },
  { id: "never_invited", filter: { client_portal: "never_invited" }, owner: "case_manager", text: "the client was never invited to the portal" },
  { id: "brainstorm_needs_booking", filter: { brainstorm_followup: "needs_booking" }, owner: "case_manager", text: "no brainstorm time has been picked" },
  { id: "approval_over_week", filter: { client_approval: "waiting_over_week" }, owner: "client", text: "the petition has been with the client for over a week" },
  { id: "intake_awaiting", filter: { intake_state: "awaiting" }, owner: "client", text: "waiting on the client's intake form" },
  { id: "audit_changes_requested", filter: { audit_state: "changes_requested" }, owner: "client", text: "documents were sent back to the client for changes" },
  { id: "stale_stage", filter: { stage_age: "stale" }, owner: null, text: "no movement in this stage for over two weeks" },
  { id: "verdict_no_go", filter: { analysis_verdict: "no_go" }, owner: "petition_writer", text: "the case analysis verdict is NO GO" },
];
const PETITION_TEAM_ROLES = ["petition_writer", "reviewer", "brainstorm_specialist", "processor", "forms_specialist"];
const ROLE_LABEL = {
  petition_writer: "petition writer", reviewer: "reviewer", brainstorm_specialist: "brainstorm specialist",
  processor: "document processor", forms_specialist: "forms specialist", case_manager: "case manager", client: "client",
};

// ====================================================================================
// HOW DELAY IS EXPLAINED
// Each day a phase runs past its share of the five months is given one reason. When more
// than one applies, the first in this list wins. A case manager's communication failure
// only explains a day when it can hold the case up: when the case is waiting on the client
// or on the case manager. While an outside body holds the case, the days are theirs.
// ====================================================================================
const BUCKETS = [
  { key: "paused",    label: "On hold",                               side: "none" },
  { key: "stale",     label: "Stage not updated in HubSpot",          side: "process" },
  { key: "email",     label: "Client email not answered in time",     side: "cm" },
  { key: "callreq",   label: "Requested call not made",               side: "cm" },
  { key: "promise",   label: "Promise not kept",                      side: "cm" },
  { key: "silent_task", label: "No follow-up: task was due and not done", side: "cm" },
  { key: "silent_far",  label: "No follow-up: next task set too far out", side: "cm" },
  { key: "silent_none", label: "No follow-up: no task was set",       side: "cm" },
  { key: "ps_cm",     label: "Petition Studio step waiting on the case manager", side: "cm" },
  { key: "petition",  label: "With the petition team",                side: "petition" },
  { key: "client",    label: "Waiting on the client (case manager chasing)", side: "client" },
  { key: "external",  label: "Waiting on an outside body",            side: "external" },
  { key: "cm_work",   label: "Case manager's own step not moved",     side: "cm" },
];
// which communication failures can hold up a case, by who holds it
const CAN_DELAY = {
  client: ["email", "callreq", "promise", "silent_task", "silent_far", "silent_none"],
  cm: ["email", "callreq", "promise", "silent_task", "silent_far", "silent_none"],
  petition: ["email", "callreq", "promise"],
  external: [],
};

module.exports = {
  SETTINGS, IDEAL_DAYS, PROGRAMS, SUBMITTED_STATUSES, PROGRAM_VALUES, NAME_SAYS_AUSTRALIA, NAME_SAYS_CANADA,
  PETITION_STATUS_CLIENT, LOR_STATUS_CLIENT, STATUS_RULES, MILESTONES,
  PS_STATUS, PS_RANK_OF_PHASE, PS_CLOSED, PS_PROBES, PETITION_TEAM_ROLES, ROLE_LABEL, BUCKETS, CAN_DELAY,
};
