// selftest.js — every rule, on invented cases. Runs before each review; if a rule stops
// behaving, the review does not go out. Run it yourself with: node selftest.js
const { SETTINGS, PROGRAMS } = require("./config");
const { makeClock, setNow, daysIn, DAY, HOUR, MIN } = require("./1-clock");
const { classify } = require("./3-classify");
const C = require("./2-collect");
const T = require("./4-timeline");
const { computeComms } = require("./5-comms");
const R = require("./6-reader");
const PS = require("./7-petition");
const A = require("./8-attribute");
const { chooseCaseManagers, choosePrograms, leaveByOwner } = require("./report");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass++; else { fail++; console.log(`  FAILED: ${name}${detail ? `\n          ${detail}` : ""}`); } };
const at = (s) => Date.parse(s.length <= 16 ? `${s}:00+05:00` : s);   // Pakistan time
const NOW = at("2026-11-03T12:00");
setNow(NOW);
const clock = makeClock();

// ---- a stage list like HubSpot's
const stages = {};
for (const [pid, list] of Object.entries(C.KNOWN_STAGES)) list.forEach(([sid, label], i) => { stages[sid] = { label, pipelineId: pid, order: i }; });
const stageLabel = (sid) => (stages[sid] || {}).label || sid;
const USA = "149481597", CAAU = "26920574", OWNER = "89930419";
const H = (v, t) => ({ value: v, at: at(t) });
function kase({ pipeline = USA, stage = "969395092", program = "USA NIW", name = "Test Client", assigned = "2026-02-01T09:00", created = "2026-01-05T09:00",
  stagesH = null, ownerH = null, cs = "Active", as = "In Progress", csH = [], asH = [], ps = "", psH = [], events = [] } = {}) {
  return {
    id: "1", link: "", client: name, email: "client@gmail.com", phone: "+971500000000", contacts: [{ id: "9", name, email: "client@gmail.com" }],
    props: { dealname: name, pipeline, dealstage: stage, hubspot_owner_id: OWNER, hubspot_owner_assigneddate: new Date(at(assigned)).toISOString(), createdate: new Date(at(created)).toISOString(),
      client_status: cs, application_status: as, immigration_program: program, petition_status: ps },
    history: { dealstage: stagesH || [H(stage, created)], hubspot_owner_id: ownerH || [H(OWNER, assigned)], client_status: csH, application_status: asH, petition_status: psH, lor_status: [] },
    events: events.sort((a, b) => a.at - b.at),
  };
}
const facts = (c, fromMs = at("2026-01-01T00:00")) => T.buildFacts(c, { stages, now: NOW, fromMs, stageLabel });
let eid = 0;
const email = (t, dir, text, o = {}) => {
  const e = { kind: "email", id: `e${eid++}`, at: at(t), dir, actor: dir === "in" ? "client" : "staff", subject: o.subject || "Case", text, toClient: dir === "out", ok: true, ownerId: o.owner || OWNER, bulk: !!o.bulk, flags: [] };
  if (dir === "in") { const k = classify({ from: "client@gmail.com", subject: e.subject, text }); e.needs = k.needs; e.needReason = k.reason; e.flags = k.flags; }
  return e;
};
const call = (t, o = {}) => ({ kind: "call", id: `c${eid++}`, at: at(t), dir: o.dir || "out", connected: !!o.connected, wrongNumber: !!o.wrong, ownerId: o.owner || OWNER, description: o.desc || "", title: "" });
const task = (due, o = {}) => ({ kind: "task", id: `t${eid++}`, at: at(due), dueAt: at(due), createdAt: at(o.created || due) - (o.created ? 0 : 3 * DAY), done: !!o.done, completedAt: o.done && o.completed ? at(o.completed) : 0,
  bulkClosed: !!o.bulk, completedEstimated: false, ownerId: o.owner || OWNER, subject: o.subject || "Follow up", compliance: false, followUp: SETTINGS.FOLLOW_UP_TASK.test(o.subject || "Follow up") });
const note = (t, text, o = {}) => ({ kind: "note", id: `n${eid++}`, at: at(t), ownerId: o.owner || OWNER, text, mentions: o.mentions || [], compliance: false });
const comms = (c, reading = null, f = facts(c)) => computeComms(c, f, reading, { clock, now: NOW });

console.log("CASE DELAY REVIEW SELF-TEST\n");

// ================================================================ the clock
check("24 working hours from Friday 3pm is Monday 3pm", clock.deadline(at("2026-10-23T15:00"), 24) === at("2026-10-26T15:00"));
check("an email the day before Eid waits until after the holiday", clock.deadline(at("2026-03-18T15:00"), 24) === at("2026-03-23T15:00"));
check("a call request in the morning is due by the end of that day", clock.sameWorkingDay(at("2026-10-27T10:00")) === at("2026-10-28T00:00"));
check("a call request after 6pm is due by the end of the next working day", clock.sameWorkingDay(at("2026-10-30T19:00")) === at("2026-11-03T00:00"));
check("a promise for a Saturday moves to the next working day", (() => { const d = clock.promiseDeadline("2026-10-31", ""); return d.moved && d.due === at("2026-11-03T00:00"); })());
check("a task due on a Saturday is due by the end of Monday", clock.endOfDay(at("2026-10-31T10:00")) === at("2026-11-03T00:00"));
check("working days between Friday noon and Monday noon is 1", Math.abs(clock.workingDaysBetween(at("2026-10-23T12:00"), at("2026-10-26T12:00")) - 1) < 1e-9);

// ================================================================ which emails need a reply
check("a client question needs a reply", classify({ from: "a@gmail.com", subject: "Re: x", text: "Can you please advise regarding the next steps?" }).needs);
check("a thank-you does not", !classify({ from: "a@gmail.com", subject: "Re: x", text: "Thanks, noted." }).needs);
check("an automatic reply does not", !classify({ from: "a@gmail.com", subject: "Automatic reply: EB 2 NIW", text: "I am out of office" }).needs);
check("documents sent with nothing asked do not", !classify({ from: "a@gmail.com", subject: "docs", text: "Please find attached the signed agreement.", attachments: true }).needs);

// ================================================================ program and status
check("the USA pipeline is USA", T.programOf({ pipeline: USA, immigration_program: "" }).program === "USA");
check("Immigration Program Australia is Australia", T.programOf({ pipeline: CAAU, immigration_program: "Australia", dealname: "X" }).program === "Australia");
check("Canada Dual is Canada", T.programOf({ pipeline: CAAU, immigration_program: "Canada Dual", dealname: "X" }).program === "Canada");
check("an empty program with '- AUS' in the name is Australia, and noted", (() => { const r = T.programOf({ pipeline: CAAU, immigration_program: "", dealname: "Ali Khan - AUS" }); return r.program === "Australia" && r.note; })());
check("a name that contradicts the program is noted", !!T.programOf({ pipeline: CAAU, immigration_program: "Canada Dual", dealname: "Khalil Ullah - Australia" }).note);
check("Active;On-Hold is on hold", T.statusOf("Active;On-Hold", "In Progress") === "paused");
check("Paused/On-Hold application status is on hold", T.statusOf("Active", "In Progress;Paused/On-Hold") === "paused");
check("Non-Responsive;Bad Debt is closed", T.statusOf("Non-Responsive;Bad Debt", "") === "closed");
check("Active;Non-Responsive is non-responsive", T.statusOf("Active;Non-Responsive", "") === "unresponsive");

// ================================================================ the five-month plan
check("the phases of every program add up to five months", Object.values(PROGRAMS).every((p) => p.phases.reduce((s, ph) => s + ph.days, 0) === 150));
{
  // USA case that entered the pipeline 200 days ago and is still at Phase 2 documents
  const start = NOW - 200 * DAY;
  const c = kase({ stage: "969395092", created: new Date(start + 5 * 3600e3).toISOString().slice(0, 16), stagesH: [{ value: "253814309", at: start }, { value: "253513091", at: start + 3 * DAY }, { value: "969395092", at: start + 24 * DAY }] });
  const f = facts(c);
  check("a USA case 200 days in should be finished by now", /^Finished/.test(f.expectedLabel), f.expectedLabel);
  check("still at Phase 2 documents it is 148 days behind (it should have left by day 52)", Math.round(f.behindMs / DAY) === 148, Math.round(f.behindMs / DAY));
  const pv = f.phaseVisits.find((x) => x.key === "phase:2");
  check("its late days start the day it should have left Phase 2 documents", Math.abs(pv.excessFrom - (start + 52 * DAY)) < HOUR);
}
{
  const start = NOW - 120 * DAY;
  const paused = [{ value: "Active", at: start }, { value: "Active;On-Hold", at: start + 40 * DAY }, { value: "Active", at: start + 100 * DAY }];
  const c = kase({ stage: "969395092", created: new Date(start).toISOString(), stagesH: [{ value: "253814309", at: start }, { value: "969395092", at: start + 10 * DAY }], csH: paused });
  const f = facts(c);
  check("time on hold is not counted against the plan", Math.round(f.behindMs / DAY) === 8, Math.round(f.behindMs / DAY));
}
{
  // owner history: someone else, then Warda; the assigned date was set again later
  const c = kase({ assigned: "2026-08-01T09:00", ownerH: [H("87311865", "2026-02-01T09:00"), H(OWNER, "2026-04-06T09:00"), H(OWNER, "2026-08-01T09:00")] });
  const f = facts(c);
  check("the case manager's period starts when they first took it over, not when the owner was set again", f.ownerStart === at("2026-04-06T09:00"));
  check("the previous owner is known", f.previousOwner === "87311865");
}
{
  // Canada: Express Entry & PNP is HOF's step until the profile is submitted
  const start = NOW - 100 * DAY;
  const c = kase({ pipeline: CAAU, program: "Canada Single", stage: "121557414", as: "Submitted", created: new Date(start).toISOString(),
    stagesH: [{ value: "61555840", at: start }, { value: "61555842", at: start + 2 * DAY }, { value: "121557414", at: start + 80 * DAY }],
    asH: [{ value: "In Progress", at: start }, { value: "Submitted", at: start + 90 * DAY }] });
  const f = facts(c);
  check("a submitted Express Entry profile is HOF's part finished", f.finished && f.behindMs === 0);
  check("the profile step is split where it was submitted", f.visits.filter((v) => v.stageId === "121557414").length === 2);
  check("a case that finished inside the five months has no late days", f.phaseVisits.every((pv) => pv.excessFrom == null));
}
{
  // Australia: the stage was never moved, but the EOI went out
  const start = NOW - 270 * DAY;
  const c = kase({ pipeline: CAAU, program: "Australia", stage: "61555842", created: new Date(start).toISOString(), stagesH: [{ value: "61555840", at: start }, { value: "61555842", at: start + 4 * DAY }],
    events: [email(new Date(start + 40 * DAY).toISOString(), "out", "Dear client", { subject: "Expression of Interest (Australia) Subclass 189 Visa - Dr. X" })] });
  const f = facts(c);
  check("an EOI email on a case still at document collection is 'stage not updated'", f.stale && f.stale.phase === "finished");
  check("and the case is judged where it really is: not behind", f.finished && f.behindMs === 0);
}
{
  const c = kase({ events: [email("2026-06-01T10:00", "out", "Dear client", { subject: "Follow-up on Letter of Recommendation Drafting" })] });
  check("a routine LOR follow-up during Phase 2 is not taken as a later stage", !facts(c).stale);
}

// ================================================================ communication
{
  const c = kase({ events: [email("2026-10-05T10:00", "in", "Can you please confirm which documents are pending?"), email("2026-10-05T16:00", "out", "Dear client, the list is attached.")] });
  const o = comms(c).obligations.filter((x) => x.type === "email");
  check("a client email answered the same day is on time", o.length === 1 && o[0].verdict === "met");
}
{
  const c = kase({ events: [email("2026-10-05T10:00", "in", "Can you please confirm which documents are pending?"), email("2026-10-08T10:00", "out", "Dear client, here is the list.")] });
  check("a client email answered after three days is late", comms(c).obligations.find((x) => x.type === "email").verdict === "late");
}
{
  const c = kase({ events: [email("2026-10-05T10:00", "in", "When will my petition be ready?"), email("2026-10-06T09:00", "in", "Any update please?"), email("2026-10-07T09:00", "in", "Still waiting for your reply.")] });
  const o = comms(c).obligations.filter((x) => x.type === "email");
  check("three client emails in a row are one wait, not three", o.length === 1 && o[0].extra === 2 && o[0].verdict === "missed");
}
{
  const c = kase({ events: [email("2026-10-05T10:00", "in", "Thank you, noted."), email("2026-10-05T11:00", "in", "Please find attached the passport copy.")] });
  check("a thank-you and a document drop create no reply obligation", !comms(c).obligations.some((x) => x.type === "email"));
}
{
  const c = kase({ events: [email("2026-10-05T10:00", "in", "Can you tell me the next step?"), call("2026-10-05T15:00", { connected: true, desc: "explained" })] });
  check("a connected call answers a client email", comms(c).obligations.find((x) => x.type === "email").verdict === "met");
}
{
  const c = kase({ events: [email("2026-10-05T10:00", "in", "Can you tell me the next step?"), call("2026-10-05T15:00")] });
  check("a call that did not connect does not answer an email", comms(c).obligations.find((x) => x.type === "email").verdict !== "met");
}
{
  const c = kase({ events: [email("2026-10-05T10:00", "in", "Can you tell me the next step?"), email("2026-10-05T12:00", "out", "Diwali greetings", { bulk: true })] });
  check("a marketing email does not answer a client", comms(c).obligations.find((x) => x.type === "email").verdict !== "met");
}
{
  const c = kase({ events: [call("2026-10-06T11:00", { dir: "in" }), call("2026-10-06T16:00")] });
  check("a missed client call returned the same day is on time", comms(c).obligations.find((x) => x.type === "callreq").verdict === "met");
}
{
  const c = kase({ events: [call("2026-10-06T11:00", { dir: "in" }), call("2026-10-08T16:00")] });
  check("a missed client call returned two days later is late", comms(c).obligations.find((x) => x.type === "callreq").verdict === "late");
}
{
  const c = kase({ events: [email("2026-10-06T11:00", "in", "Please call me today about the payment.")] });
  check("without the reader, 'please call me' still creates a call request", comms(c).obligations.some((x) => x.type === "callreq" && x.verdict === "missed"));
}
{
  const made = email("2026-09-07T11:00", "out", "I will call you tomorrow to discuss the next steps.");
  const c = kase({ events: [made, call("2026-09-14T10:00", { connected: true, desc: "x" })] });
  const reading = { read: true, callRequests: [], complaints: [], handoffs: [], tone: [], promises: [{ event: made, quote: "I will call you tomorrow", action: "call", when: "tomorrow", dueDate: "2026-09-08", dueTime: "" }] };
  check("a promise to call tomorrow kept a week later is late", comms(c, reading).obligations.find((x) => x.type === "promise").verdict === "late");
  const other = { ...reading, promises: [{ ...reading.promises[0], event: { ...made, ownerId: "123" } }] };
  check("a promise someone else made goes to judgement, not into the score", !comms(c, other).obligations.some((x) => x.type === "promise") && comms(c, other).judgement.length === 1);
}
{
  const c = kase({ events: [task("2026-10-07T10:00", { subject: "Follow up documents" }), email("2026-10-07T15:00", "out", "Dear client, a reminder about the documents.")] });
  const t = comms(c).obligations.find((x) => x.type === "task");
  check("a follow-up task counts as done when the client was contacted on its due day, ticked or not", t && t.verdict === "met");
}
{
  const c = kase({ events: [task("2026-10-07T10:00", { done: true, completed: "2026-10-20T10:00", bulk: true })] });
  const r = comms(c);
  check("a task ticked in a bulk clean-up, with no contact around it, is left for judgement", !r.obligations.some((x) => x.type === "task") && r.judgement.length === 1);
}
{
  const c = kase({ events: [task("2026-10-07T10:00")] });
  check("an open task past its due day with no contact is overdue", comms(c).obligations.find((x) => x.type === "task").verdict === "missed");
}
{
  const ts = [task("2026-05-01T10:00", { done: true, completed: "2026-08-18T14:50:10" }), task("2026-05-05T10:00", { done: true, completed: "2026-08-18T14:50:20" }),
    task("2026-05-09T10:00", { done: true, completed: "2026-08-18T14:50:30" }), task("2026-05-12T10:00", { done: true, completed: "2026-08-18T14:50:40" }), task("2026-05-15T10:00", { done: true, completed: "2026-05-15T12:00" })];
  for (const t of ts) t.bulkClosed = false;
  C.markBulkTasks(ts);
  check("four tasks ticked within two minutes are a bulk clean-up", ts.slice(0, 4).every((t) => t.bulkClosed) && !ts[4].bulkClosed);
}
{
  const c = kase({ events: [email("2026-10-05T10:00", "in", "I am not happy with the delay, this is unacceptable.")] });
  check("a complaint not recorded in a note is not recorded", comms(c).obligations.some((x) => x.type === "complaint" && x.verdict === "missed"));
}
{
  const c = kase({ events: [call("2026-10-05T10:00", { connected: true, desc: "" }), call("2026-10-06T10:00", { wrong: true })] });
  const h = comms(c).hygiene;
  check("a call day with no email to the client breaks the same-day email rule", h.some((x) => x.type === "callemail" && !x.ok));
  check("a wrong number needs no follow-up email", h.filter((x) => x.type === "callemail").length === 1);
  check("a connected call with no notes breaks the call-notes rule", h.some((x) => x.type === "calldesc" && !x.ok));
  check("a call with no next task breaks the next-task rule", h.some((x) => x.type === "calltask" && !x.ok));
}
{
  const c = kase({ events: [call("2026-10-05T10:00", { connected: true, desc: "Discussed the documents" }), email("2026-10-05T12:00", "out", "Recap of our call"), task("2026-10-12T10:00", { created: "2026-10-05T10:30" })] });
  check("a call with a same-day email, a next task and notes passes all three rules", comms(c).hygiene.every((x) => x.ok));
}
{
  const d1 = C.collapseCalls([{ kind: "call", dir: "out", ownerId: "1", at: at("2026-10-05T10:00"), connected: false, description: "" }, { kind: "call", dir: "out", ownerId: "1", at: at("2026-10-05T10:01"), connected: true, description: "spoke about fees" }]);
  check("the dialler's copy of a call is one attempt, connected and described", d1.length === 1 && d1[0].connected && d1[0].description);
}
check("a dialler 'Call id' line is not a description", C.realDescription("Call id : 5c3bba9e-1234-4abc-9def-0123456789ab") === "");
{
  const cases = [];
  for (let i = 0; i < 16; i++) cases.push({ id: String(i), events: [{ kind: "email", dir: "out", from: "marketing@hofmigration.com", subject: "Refer and Earn", at: at("2026-10-01T10:00") },
    { kind: "email", dir: "out", from: "warda@hofmigration.com", subject: "Weekly update", at: at("2026-10-01T10:00") }] });
  C.markBulkEmails(cases, new Set(["warda@hofmigration.com"]));
  check("a mailing to many cases is marketing, a case manager's templated update is not", cases[0].events[0].bulk && !cases[0].events[1].bulk);
}

// ================================================================ follow-up kept up
{
  const c = kase({ stage: "969395092", events: [email("2026-09-01T10:00", "out", "update"), email("2026-10-20T10:00", "out", "update")] });
  const s = comms(c).silences;
  check("seven weeks with no contact while waiting on the client is a gap", s.some((x) => x.from === at("2026-09-01T10:00") && x.holder === "client"));
  check("with no task set, the gap says no follow-up task was set", s.find((x) => x.from === at("2026-09-01T10:00")).sub === "silent_none");
}
{
  const c = kase({ stage: "969395092", events: [email("2026-09-01T10:00", "out", "update"), task("2026-09-08T10:00", { subject: "Follow up documents" }), email("2026-10-20T10:00", "out", "update")] });
  check("a gap with a follow-up task due inside it says the task was not done", comms(c).silences.find((x) => x.from === at("2026-09-01T10:00")).sub === "silent_task");
}
{
  const c = kase({ stage: "969395092", events: [email("2026-09-01T10:00", "out", "update"), task("2026-10-15T10:00", { subject: "Follow up documents", created: "2026-09-01T11:00" }), email("2026-10-20T10:00", "out", "update")] });
  check("a gap where the next task was set six weeks out says it was set too far out", comms(c).silences.find((x) => x.from === at("2026-09-01T10:00")).sub === "silent_far");
}
{
  const evs = []; for (let d = at("2026-02-02T10:00"); d < NOW; d += 7 * DAY) evs.push(email(new Date(d).toISOString(), "out", "weekly update"));
  check("a weekly follow-up leaves no gaps", comms(kase({ stage: "969395092", events: evs })).silences.length === 0);
}
{
  const c = kase({ stage: "969395092", csH: [H("Active", "2026-01-05T09:00"), H("Active;On-Hold", "2026-09-02T09:00"), H("Active", "2026-10-26T09:00")],
    events: [email("2026-09-01T10:00", "out", "update"), email("2026-10-27T10:00", "out", "update"), email("2026-11-02T10:00", "out", "update")] });
  check("time on hold is not a follow-up gap", !comms(c).silences.some((x) => x.from >= at("2026-09-01T00:00") && x.to <= at("2026-10-28T00:00")));
}
{
  // a petition stage held by the petition team allows two weeks; the case manager's own step allows one
  const pet = kase({ stage: "253513092", stagesH: [H("253513092", "2026-01-05T09:00")], events: [email("2026-10-01T10:00", "out", "u"), email("2026-10-12T10:00", "out", "u")] });
  check("with the petition team, 7 working days without an update is within the allowance", !comms(pet).silences.some((x) => x.from === at("2026-10-01T10:00")));
  const own = kase({ stage: "1091997759", stagesH: [H("1091997759", "2026-01-05T09:00")], events: [email("2026-10-01T10:00", "out", "u"), email("2026-10-12T10:00", "out", "u")] });
  check("on the case manager's own step, 7 working days without contact is a gap", comms(own).silences.some((x) => x.from === at("2026-10-01T10:00")));
}

// ================================================================ why a day is late
{
  // 200 days in, at Phase 2 documents, waiting on the client
  const start = NOW - 200 * DAY;
  const base = { stage: "969395092", assigned: new Date(start).toISOString(), created: new Date(start).toISOString(), stagesH: [{ value: "253814309", at: start }, { value: "969395092", at: start + 10 * DAY }] };
  const weekly = []; for (let d = start + DAY; d < NOW; d += 7 * DAY) weekly.push(email(new Date(d).toISOString(), "out", "weekly reminder"));
  const c1 = kase({ ...base, events: weekly });
  const f1 = facts(c1, start - DAY), a1 = A.attribute(f1, comms(c1, null, f1), null, NOW);
  check("chased every week, the late days are the client's", a1.primary === "client" && (a1.buckets.silent_none || 0) < 2 * DAY, JSON.stringify(a1.buckets));
  check("the slow welcome (10 days against 3) is the case manager's own step", Math.round((a1.buckets.cm_work || 0) / DAY) >= 6);
  const c2 = kase({ ...base, events: [email(new Date(start + DAY).toISOString(), "out", "intro")] });
  const f2 = facts(c2, start - DAY), a2 = A.attribute(f2, comms(c2, null, f2), null, NOW);
  check("never chased, the late days are the case manager's missing follow-up", a2.primary === "silent_none");
}
{
  // waiting on WES (external): silence there does not explain the delay
  const start = NOW - 220 * DAY;
  const c = kase({ pipeline: CAAU, program: "Canada Single", stage: "61555845", assigned: new Date(start).toISOString(), created: new Date(start).toISOString(),
    stagesH: [{ value: "61555840", at: start }, { value: "61555845", at: start + 2 * DAY }], events: [] });
  const f = facts(c, start - DAY), a = A.attribute(f, comms(c, null, f), null, NOW);
  check("while an outside body holds the case, the late days are theirs even with no follow-up", a.primary === "external" && !a.buckets.silent_none, JSON.stringify(a.buckets));
}
{
  // with the petition team: a late client email still explains days, follow-up gaps do not
  const start = NOW - 260 * DAY;
  const evs = [email(new Date(NOW - 40 * DAY).toISOString(), "in", "Can you tell me when the draft will be ready?"), email(new Date(NOW - 20 * DAY).toISOString(), "out", "Next week.")];
  const c = kase({ stage: "253513092", assigned: new Date(start).toISOString(), created: new Date(start).toISOString(), stagesH: [{ value: "253814309", at: start }, { value: "253513092", at: start + 2 * DAY }], events: evs });
  const f = facts(c, start - DAY), a = A.attribute(f, comms(c, null, f), null, NOW);
  check("with the petition team, an unanswered client email explains its days", a.buckets.email > 15 * DAY);
  check("and the rest is with the petition team, not missing follow-up", a.buckets.petition > 0 && !a.buckets.silent_none);
  const ps = { found: true, holder: { who: "petition", role: "petition_writer", since: NOW - 50 * DAY, why: "Drafting over time" } };
  const a2 = A.attribute(f, comms(c, null, f), ps, NOW);
  check("Petition Studio showing the writer over time puts those days with the petition team", a2.buckets.petition >= 45 * DAY && !(a2.buckets.email > 0));
}
{
  // late days before the case manager took the case are inherited
  const start = NOW - 300 * DAY;
  const weekly = []; for (let d = NOW - 30 * DAY; d < NOW; d += 7 * DAY) weekly.push(email(new Date(d).toISOString(), "out", "weekly reminder"));
  const c = kase({ stage: "969395092", assigned: new Date(NOW - 30 * DAY).toISOString(), created: new Date(start).toISOString(),
    stagesH: [{ value: "253814309", at: start }, { value: "969395092", at: start + 10 * DAY }], ownerH: [H("1", new Date(start).toISOString()), { value: OWNER, at: NOW - 30 * DAY }], events: weekly });
  const f = facts(c), a = A.attribute(f, comms(c, null, f), null, NOW);
  check("only late days since the case manager took over are explained", Math.round(a.lateMs / DAY) === 30, Math.round(a.lateMs / DAY));
  check("the delay at hand-over is kept as inherited", Math.round(f.inheritedMs / DAY) === 218, Math.round(f.inheritedMs / DAY));
}
{
  // Petition Status says the client has the petition: it is the client's wait, and the case manager must chase
  const start = NOW - 260 * DAY;
  const c = kase({ stage: "1274699902", ps: "Review Completed – Sent to Client", assigned: new Date(start).toISOString(), created: new Date(start).toISOString(),
    stagesH: [{ value: "253814309", at: start }, { value: "1274699902", at: start + 100 * DAY }], psH: [{ value: "Review Completed – Sent to Client", at: start + 100 * DAY }], events: [] });
  const f = facts(c, start - DAY);
  check("a petition sent to the client for approval is the client's to hold", f.typeAt(NOW - DAY) === "client");
  const a = A.attribute(f, comms(c, null, f), null, NOW);
  check("and with no chasing, those late days are the case manager's missing follow-up", a.primary === "silent_none");
}

// ================================================================ the reader is never trusted on its word
{
  const e = { kind: "email", dir: "in", actor: "client", subject: "x", text: "Please call me tomorrow morning about the fee.", at: NOW };
  check("a quote that is really in the line is accepted", R.quoteIsIn("Please call me tomorrow morning", e));
  check("an invented quote is rejected", !R.quoteIsIn("I will cancel my case", e));
  const by = new Map([["C1-E1", { caseIdx: 1, i: 1, e }]]);
  const v = R.verify({ promises: [{ id: "C1-E1", quote: "Please call me tomorrow morning", action: "call" }], callRequests: [{ id: "C1-E1", quote: "Please call me tomorrow" }] }, by);
  check("a client's words can never become a staff promise", v.promises.length === 0 && v.callRequests.length === 1 && v.dropped === 1);
  const n = { kind: "note", ownerId: "5", text: "@Hafsa Zafar kindly share the drafting timeline", mentions: [{ id: "85297841", name: "Hafsa Zafar" }], at: NOW };
  const v2 = R.verify({ handoffs: [{ id: "C1-E2", quote: "kindly share the drafting timeline", who: "Lissa Mugova", asks: "x" }, { id: "C1-E2", quote: "kindly share the drafting timeline", who: "Hafsa Zafar", asks: "share timeline" }] }, new Map([["C1-E2", { caseIdx: 1, i: 2, e: n }]]));
  check("a tag is only accepted for someone actually tagged in the note", v2.handoffs.length === 1 && v2.handoffs[0].mentionId === "85297841");
}

// ================================================================ Petition Studio
{
  const idx = PS.buildIndex([
    { case_id: "1", client_name: "Antoine Abdel Massih", status: "internal_review" },
    { case_id: "2", client_name: "Rashid Khan", status: "ready_to_file", case_manager: { name: "Umer Masaud" } },
    { case_id: "3", client_name: "Rashid Khan", status: "intake", case_manager: { name: "Rahima Nabili" } },
    { case_id: "4", client_name: "Someone", client_email: "nisha@gmail.com", status: "ai_drafting" },
    { case_id: "5", client_name: "Muzammal Hussain", status: "intake" },
  ]);
  const mk = (client, email = "", dealname = client) => ({ id: "9", client, email, contacts: [{ email, name: client }], props: { dealname } });
  check("matched by the client's email first", PS.matchCase(mk("Nisha Joby Titus", "nisha@gmail.com"), idx).hit.row.case_id === "4");
  check("'AbdelMassih' matches 'Abdel Massih'", (PS.matchCase(mk("Antoine AbdelMassih"), idx) || {}).hit.row.case_id === "1");
  check("two cases with one name are told apart by the case manager", PS.matchCase(mk("Rashid Khan"), idx, "Umer Masaud").hit.row.case_id === "2");
  check("two cases with one name and no way to tell are left for checking", !!(PS.matchCase(mk("Rashid Khan"), idx, "Yamina Sadi") || {}).ambiguous);
  check("a fuller name matches a shorter one", PS.matchCase(mk("Muzammal Shahzad Hussain"), idx).hit.row.case_id === "5");
  check("a name that is not there is not guessed", PS.matchCase(mk("Zafar Siddiqui"), idx) === null);
  PS.assess.probeHits = new Map();
  const over = PS.assess({ case_id: "4", status: "ai_drafting", petition_writer: { name: "Hafsa Zafar" } }, { status: "ai_drafting", stage: { age_hours: 310, stage_entered_at: "2026-09-20T08:00:00Z" } }, NOW);
  check("drafting over its 120 business hours is held by the petition writer", over.holder.who === "petition" && over.holder.role === "petition_writer" && over.over);
  const inTime = PS.assess({ case_id: "4", status: "ai_drafting" }, { status: "ai_drafting", stage: { age_hours: 40 } }, NOW);
  check("drafting within its time is not counted as a petition delay", inTime.holder.within);
  const sent = PS.assess({ case_id: "2", status: "ready_to_file" }, { status: "ready_to_file", stage: { age_hours: 10 }, client_review: { sent_at: "2026-06-22T09:00:00Z" } }, NOW);
  check("a petition sent to the client and not approved is the client's", sent.holder.who === "client");
  check("a filed case is done", PS.assess({ case_id: "8", status: "filed" }, null, NOW).holder.who === "done");
}

// ================================================================ the run's choices
{
  const owners = Object.entries(SETTINGS.CASE_MANAGERS).map(([ownerId, name]) => ({ ownerId, name }));
  check("all fifteen case managers are in the review by default", chooseCaseManagers("all", owners).list.length === 15);
  check("Raza Imran is one of them", chooseCaseManagers("Raza Imran", owners).list[0].ownerId === "101619391");
  check("a few names can be chosen", chooseCaseManagers("Warda, Brenda", owners).list.length === 2);
  check("an unknown name stops the run with a reason", chooseCaseManagers("Nobody Here", owners).problems.length === 1);
  check("programs can be chosen", choosePrograms("USA").length === 1 && choosePrograms("all").length === 3);
  const lv = leaveByOwner({ "Warda Badar": ["2026-10-21", "2026-10-22"], "Muhammad": ["2026-10-21"], "Brenda": ["21 Oct"] }, owners);
  check("leave is matched to the case manager by name", lv.map.get("89930419").size === 2);
  check("a leave name that fits two case managers, or a date that is not a date, is reported", lv.problems.length === 2 && !lv.map.has("96187067"));
  const oct20 = Date.parse("2026-10-20T09:00:00+05:00");
  check("a name typed in decorative letters is read from the deal name instead", C.clientName({ firstname: "ĂĽĩ", lastname: "Ăřsąlăŋ" }, "Ali Arsalan -Canada PR") === "Ali Arsalan"
    && C.clientName({ firstname: "José", lastname: "Martínez" }, "José Martínez - USA NIW") === "José Martínez" && C.clientName({}, "NIW - Ahmed Raza") === "Ahmed Raza");
  check("leave days inside a finding's window are counted", daysIn(lv.map.get("89930419"), oct20, oct20 + 3 * DAY) === 2 && daysIn(lv.map.get("89930419"), oct20, oct20 + 2 * HOUR) === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
