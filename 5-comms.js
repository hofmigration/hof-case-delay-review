// 5-comms.js — the communication on a case, and whether it held up.
//
// Every obligation comes from something that happened: a client email that asked for
// something, a client asking for a call or ringing unanswered, a promise, a task falling
// due, a complaint, a call that needed a follow-up email and task, a colleague being tagged.
// Whether each one was met, and when, is decided from the timestamps alone. On top of that,
// follow-up must not lapse: while a case is live, the client hears from HOF regularly.
// No network in here, so every rule is tested on invented cases.
const { SETTINGS } = require("./config");
const { DAY, HOUR, OFF, dayStart, dateKey, fmtWhen } = require("./1-clock");

// a client asked to be called, in so many words (used when the reader is off)
const STRICT_CALL = /\b(call me|give me a (call|ring)|please call|pls call|plz call|kindly call|can you (please )?call|could you (please )?call|ring me|phone me|mujhe call|call kar(o|ein|en)|call back (to )?me)\b/i;

// a promise to the client with a day on it, in so many words (used when the reader is off):
// "I will call you tomorrow at 3pm", "we will send it on Monday", "I will follow up with you
// on Monday", "we will reconnect on Tuesday". Left out: anything hedged or conditional ("if",
// "once", "try to", "hopefully", "not") before or right after it, and "next Monday" or
// "next week" (which week?).
const STRICT_PROMISE = /\b(?:i|we)\s*(?:'ll|’ll|\swill|\sshall)\s+(?:(?:also|surely|definitely|again)\s+)?(call|ring|phone|give you a (?:call|ring)|email|send|share|update|get back to|revert|confirm|follow up|reach out|contact|get in touch|speak|talk|meet|connect|reconnect|have an? (?:\w+ )?(?:call|meeting|session|discussion))\b[^.!?\n]{0,80}?\b(today|tonight|tomorrow|this (?:morning|afternoon|evening)|(?:by |before )?(?:the )?end of (?:the )?(?:day|today)|eod|(?:on |by |this )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i;
const HEDGE = /\b(if|unless|once|as soon as|whenever|try|trying|might|possibly|hopefully|not|cannot|unable|next)\b|n[’']t\b/i;
const HEDGE_AFTER = /^(?:[^,;]*?\b(?:if|unless|once|provided|as soon as|subject to)\b|\s*(?:[,;]\s*)?(?:if|unless|once|provided|as soon as|subject to)\b|\s*(?:of )?next week\b)/i;
const AT_TIME = /\b(?:at|by|before|around)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/i;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
// how a kind of promise is kept: a call; an email (or WhatsApp); a conversation (a call or a
// meeting); or any contact at all
const promiseAction = (verb) => (/^(call|ring|phone|give you a)/i.test(verb) ? "call"
  : /^(speak|talk|meet|connect|reconnect|have an? )/i.test(verb) ? "talk"
  : /^(follow up|reach out|contact|get in touch)/i.test(verb) ? "contact" : "email");
function phrasePromises(events) {
  const out = [];
  for (const e of events) {
    if (!emailToClient(e) || !e.text) continue;
    for (const sentence of String(e.text).split(/(?<=[.!?])\s+|\n+/)) {
      const m = STRICT_PROMISE.exec(sentence);
      if (!m) continue;
      const end = m.index + m[0].length;
      if (HEDGE.test(sentence.slice(0, end)) || HEDGE_AFTER.test(sentence.slice(end))) continue;
      const word = m[2].toLowerCase(), d0 = dayStart(e.at);
      let add = 0;
      if (word.includes("tomorrow")) add = 1;
      else { const k = WEEKDAYS.findIndex((w) => word.includes(w)); if (k >= 0) add = ((k - new Date(d0 + OFF).getUTCDay() + 7) % 7) || 7; }
      const tm = AT_TIME.exec(sentence);
      const hour = tm ? (+tm[1] % 12) + (/p/i.test(tm[3]) ? 12 : 0) : null;
      out.push({ event: e, quote: sentence.trim().slice(0, 220), action: promiseAction(m[1]), byPhrase: true,
        when: `${m[2]}${tm ? ` ${tm[0].trim()}` : ""}`, dueDate: dateKey(d0 + add * DAY + 12 * HOUR), dueTime: tm && hour < 24 ? `${hour}:${tm[2] || "00"}` : "" });
      break;                                   // one promise per email
    }
  }
  return out;
}

const emailToClient = (e) => e.kind === "email" && e.dir === "out" && e.toClient && e.ok !== false && !e.bulk;
const isOurCall = (e) => e.kind === "call" && e.dir === "out";
const isWhatsApp = (e) => e.kind === "whatsapp" && e.dir === "out";
// hearing from HOF: an email to the client, a call (picked up or not), a meeting or a WhatsApp
const isTouch = (e) => emailToClient(e) || isOurCall(e) || e.kind === "meeting" || isWhatsApp(e);
// what answers a client's email: an email to them, a call that connected, or a WhatsApp
const answersEmail = (e) => emailToClient(e) || (isOurCall(e) && e.connected) || isWhatsApp(e);
const clientEmailNeedingReply = (e) => e.kind === "email" && e.dir === "in" && e.actor === "client" && e.needs;
const completedKnown = (t) => t.done && t.completedAt && !t.bulkClosed && !t.completedEstimated;

function firstAfter(events, t, test, until = Infinity) { return events.find((e) => e.at > t && e.at <= until && test(e)) || null; }

function decide(o, clock, now) {
  let verdict;
  if (o.metAt != null) verdict = o.metAt <= o.due ? "met" : "late";
  else verdict = now > o.due ? "missed" : "pending";
  const end = o.metAt != null ? o.metAt : now;
  return { ...o, verdict, waitWorkMs: clock.workingBetween(o.start, end),
    overMs: verdict === "late" || verdict === "missed" ? clock.workingBetween(o.due, end) : 0,
    overFrom: verdict === "late" || verdict === "missed" ? o.due : null, overTo: verdict === "late" || verdict === "missed" ? end : null };
}

// c: the case record; f: its facts (4-timeline); reading: what the reader found (or null);
// extra: WhatsApp messages from Chatwoot, as events
function computeComms(c, f, reading, { clock, now, extra = [] }) {
  const owner = String(c.props.hubspot_owner_id || "");
  const ev = extra.length ? [...c.events, ...extra].sort((a, b) => a.at - b.at) : c.events;
  const from = f.reviewStart;
  const inWindow = (t) => t >= from && t <= now;
  const out = [];          // decided obligations
  const judgement = [];    // for Ali's judgement, never counted
  const add = (o) => { if (inWindow(o.start)) out.push(decide(o, clock, now)); };
  const readOk = !!(reading && reading.read);

  // ---- 1. client emails: one wait per stretch, timed from the first, until someone answers
  {
    let open = null;
    const close = (answer) => {
      const start = open[0].at;
      add({ type: "email", start, due: clock.deadline(start, SETTINGS.EMAIL_REPLY_HOURS), metAt: answer ? answer.at : null, metBy: answer,
        trigger: open[0], quote: open[0].text, extra: open.length - 1, reason: open[0].needReason });
      open = null;
    };
    for (const e of ev) {
      if (clientEmailNeedingReply(e)) { if (!open) open = [e]; else open.push(e); }
      else if (open && answersEmail(e)) close(e);
    }
    if (open) close(null);
  }

  // ---- 2. calls the client asked for, or rang and missed: a call the same working day
  {
    const reqs = ev.filter((e) => e.kind === "call" && e.dir === "in" && !e.connected).map((e) => ({ event: e, quote: "", missedCall: true }));
    if (readOk) reqs.push(...(reading.callRequests || []));
    else for (const e of ev) if (e.kind === "email" && e.actor === "client" && STRICT_CALL.test(`${e.subject} ${e.text}`)) reqs.push({ event: e, quote: (STRICT_CALL.exec(`${e.subject} ${e.text}`) || [""])[0], byPhrase: true });
    const seen = new Set();
    for (const r of reqs) {
      if (seen.has(r.event.id)) continue;
      seen.add(r.event.id);
      const start = r.event.at, due = clock.sameWorkingDay(start);
      const call = firstAfter(ev, start, isOurCall);
      add({ type: "callreq", start, due, metAt: call ? call.at : null, metBy: call, trigger: r.event, quote: r.quote, missedCall: !!r.missedCall });
    }
  }

  // ---- 3. promises, held to the time named. Only the case manager's own count.
  for (const p of readOk ? reading.promises || [] : phrasePromises(ev)) {
    const made = p.event;
    if (!inWindow(made.at)) continue;
    if (String(made.ownerId) !== owner) { judgement.push({ why: "A promise made by someone else on the case", event: made, quote: p.quote }); continue; }
    const dl = clock.promiseDeadline(p.dueDate, p.dueTime);
    if (!dl || dl.due <= made.at) { judgement.push({ why: `A promise with no clear time ("${p.when || "no time given"}")`, event: made, quote: p.quote }); continue; }
    if (p.action === "other") { judgement.push({ why: "A promise HubSpot cannot show was kept", event: made, quote: p.quote }); continue; }
    const test = p.action === "call" ? isOurCall : p.action === "talk" ? (e) => isOurCall(e) || e.kind === "meeting"
      : p.action === "contact" ? isTouch : (e) => emailToClient(e) || isWhatsApp(e);
    const met = firstAfter(ev, made.at, test);
    add({ type: "promise", start: made.at, due: dl.due, moved: dl.moved, metAt: met ? met.at : null, metBy: met, trigger: made, quote: p.quote, action: p.action, when: p.when });
  }

  // ---- 4. the case manager's tasks: done by the end of the due day. Done means ticked by
  // then, or the client was actually contacted by then. Tasks ticked in bulk (a clean-up)
  // say nothing about when the work was done, so the contact decides.
  const ownerTasks = ev.filter((e) => e.kind === "task" && String(e.ownerId) === owner && !e.compliance);
  for (const t of ownerTasks) {
    if (!(t.dueAt >= from && t.dueAt <= now)) continue;
    const due = clock.endOfDay(t.dueAt);
    const touchBy = ev.find((e) => isTouch(e) && e.at >= Math.min(t.createdAt || t.dueAt, t.dueAt) && e.at <= due);
    if ((completedKnown(t) && t.completedAt <= due) || touchBy) {
      add({ type: "task", start: t.dueAt, due, metAt: Math.min(completedKnown(t) ? t.completedAt : Infinity, touchBy ? touchBy.at : Infinity), trigger: t, quote: t.subject, byContact: !!touchBy && !(completedKnown(t) && t.completedAt <= due) });
      continue;
    }
    const laterTouch = firstAfter(ev, due, isTouch);
    const later = Math.min(completedKnown(t) ? t.completedAt : Infinity, laterTouch ? laterTouch.at : Infinity);
    if (later !== Infinity) add({ type: "task", start: t.dueAt, due, metAt: later, trigger: t, quote: t.subject });
    else if (!t.done) add({ type: "task", start: t.dueAt, due, metAt: null, trigger: t, quote: t.subject });
    else judgement.push({ why: "A task ticked in a bulk clean-up with no contact logged around it", event: t, quote: t.subject });
  }

  // ---- 5. complaints recorded in a note within 24 working hours
  {
    const complaints = readOk ? (reading.complaints || [])
      : ev.filter((e) => e.kind === "email" && e.actor === "client" && (e.flags || []).includes("complaint")).map((e) => ({ event: e, quote: e.text, byPhrase: true }));
    for (const k of complaints) {
      if (k.event.kind === "note") continue;              // already recorded in a note
      const start = k.event.at, due = clock.deadline(start, SETTINGS.COMPLAINT_NOTE_HOURS);
      const note = firstAfter(ev, start, (e) => e.kind === "note" && !e.compliance);
      add({ type: "complaint", start, due, metAt: note ? note.at : null, metBy: note, trigger: k.event, quote: k.quote });
    }
  }

  // ---- 6. the case manager bot rules, for every day the case manager made a call
  const hygiene = [];
  {
    const byDay = new Map();
    for (const e of ev) if (isOurCall(e) && String(e.ownerId) === owner && inWindow(e.at)) {
      const d = dayStart(e.at);
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(e);
    }
    for (const [d, calls] of byDay) {
      const lastCall = calls[calls.length - 1];
      if (SETTINGS.CALL_EMAIL_SAME_DAY && !calls.every((x) => x.wrongNumber)) {
        const email = ev.find((e) => emailToClient(e) && dayStart(e.at) === d);
        hygiene.push({ type: "callemail", at: lastCall.at, ok: !!email, trigger: lastCall, calls: calls.length });
      }
      if (SETTINGS.CALL_NEXT_TASK) {
        const end = d + DAY;
        const next = ev.find((e) => e.kind === "task" && !e.compliance && (e.createdAt || e.dueAt) <= end && e.dueAt >= lastCall.at
          && !(completedKnown(e) && e.completedAt < lastCall.at));
        hygiene.push({ type: "calltask", at: lastCall.at, ok: !!next, trigger: lastCall });
      }
      if (SETTINGS.CALL_DESCRIPTION) for (const x of calls.filter((x) => x.connected))
        hygiene.push({ type: "calldesc", at: x.at, ok: !!x.description, trigger: x });
    }
  }

  // ---- 7. tagged and not answered (comments cannot be read, so never scored)
  const handoffs = [];
  for (const h of (readOk && reading.handoffs) || []) {
    const n = h.event;
    if (!inWindow(n.at)) continue;
    if (!(String(n.ownerId) === owner || String(h.mentionId) === owner)) continue;
    const due = clock.deadline(n.at, SETTINGS.MENTION_REPLY_HOURS);
    const ans = firstAfter(ev, n.at, (e) => String(e.ownerId) === String(h.mentionId) && (e.kind === "note" || e.kind === "email" || e.kind === "call"));
    const o = decide({ type: "handoff", start: n.at, due, metAt: ans ? ans.at : null, metBy: ans, trigger: n, quote: h.asks || n.text,
      mentionId: String(h.mentionId), mentionName: h.mentionName, owes: String(h.mentionId) === owner ? "cm" : "team" }, clock, now);
    handoffs.push(o);
  }

  // ---- 8. unprofessional wording in an email to the client
  const tone = ((readOk && reading.tone) || []).filter((t) => inWindow(t.event.at)).map((t) => ({ type: "tone", at: t.event.at, trigger: t.event, quote: t.quote, category: t.category, ownerId: t.event.ownerId }));

  // ---- 9. follow-up must not lapse
  const silences = [];
  const touches = ev.filter(isTouch).map((e) => ({ at: e.at, what: e.kind }));
  if (SETTINGS.COMPLETED_TASK_COUNTS_AS_FOLLOW_UP)
    for (const t of ev) if (t.kind === "task" && completedKnown(t) && t.followUp) touches.push({ at: t.completedAt, what: "task" });
  touches.sort((a, b) => a.at - b.at);
  {
    const marks = [
      ...touches.map((t) => ({ at: t.at, k: "touch" })),
      ...f.paused.flatMap((p) => [{ at: p.from, k: "pause" }, { at: p.to, k: "resume" }]),
      { at: now, k: "end" },
    ].filter((m) => m.at <= now).sort((a, b) => a.at - b.at || (a.k === "resume") - (b.k === "resume"));
    // the clock starts when the case manager's period starts: whoever had the case before,
    // the new owner has the full allowance from taking it over
    let prev = from, paused = f.paused.some((p) => p.from <= from && from < p.to);
    if (paused) { const p = f.paused.find((x) => x.from <= from && from < x.to); prev = p.to; }
    const evaluate = (gapEnd, open) => {
      if (gapEnd <= prev) return;
      // the allowance is set by who holds the case when it runs out (a case that moves from the
      // welcome call to document collection gets the document-collection allowance), and the
      // whole of the last day is allowed
      let type = f.typeAt(prev), allow, overdueFrom;
      for (let k = 0; k < 3; k++) {
        if (type === "done" || f.done) return;
        allow = SETTINGS.FOLLOW_UP_EVERY[type] || SETTINGS.FOLLOW_UP_EVERY.cm;
        overdueFrom = clock.endOfDay(clock.deadline(prev, allow * 24) - 1);
        const later = f.typeAt(Math.min(overdueFrom, gapEnd) - 1);
        if (later === type) break;
        type = later;
      }
      if (gapEnd <= overdueFrom) return;
      const gapWd = clock.workingDaysBetween(prev, gapEnd);
      // what the tasks say about this gap, as things stood when the allowance ran out:
      //   a follow-up task was due by then and not done          -> task was due and not done
      //   the next task was set, but for after the allowance     -> set too far out
      //   a task fell due later in the gap and was not done      -> task was due and not done
      //   no task at all                                          -> no task was set
      const notDone = (t) => !(completedKnown(t) && t.completedAt <= clock.endOfDay(t.dueAt));
      const dueBy = ownerTasks.filter((t) => t.dueAt >= prev && t.dueAt <= overdueFrom && notDone(t));
      const far = ownerTasks.find((t) => (t.createdAt || t.dueAt) <= overdueFrom && t.dueAt > overdueFrom && !(completedKnown(t) && t.completedAt <= overdueFrom));
      const dueLater = ownerTasks.filter((t) => t.dueAt > overdueFrom && t.dueAt < gapEnd && notDone(t));
      let sub = "silent_none", task = null;
      if (dueBy.length) { sub = "silent_task"; task = dueBy[0]; }
      else if (far) { sub = "silent_far"; task = far; }
      else if (dueLater.length) { sub = "silent_task"; task = dueLater[0]; }
      silences.push({ type: "silence", from: prev, to: gapEnd, overdueFrom, allowWd: allow, gapWd, holder: type, sub, task, open });
    };
    for (const m of marks) {
      if (m.k === "pause") { if (!paused) evaluate(m.at, false); paused = true; continue; }
      if (m.k === "resume") { paused = false; prev = Math.max(prev, m.at); continue; }
      if (paused) { if (m.k === "touch") prev = Math.max(prev, m.at); continue; }
      if (m.k === "touch") { if (m.at >= from) { evaluate(m.at, false); prev = Math.max(prev, m.at); } continue; }
      if (m.k === "end") evaluate(now, true);
    }
  }

  // ---- how the case was handled, for context
  const inP = ev.filter((e) => inWindow(e.at));
  const clientSide = ev.filter((e) => (e.kind === "email" && e.actor === "client") || (e.kind === "call" && (e.dir === "in" || e.connected)));
  const lastClient = clientSide.length ? clientSide[clientSide.length - 1].at : null;
  const lastTouch = touches.length ? touches[touches.length - 1].at : null;
  const stats = {
    emailsIn: inP.filter((e) => e.kind === "email" && e.actor === "client").length,
    emailsNeedingReply: inP.filter(clientEmailNeedingReply).length,
    emailsOut: inP.filter(emailToClient).length,
    bulkEmails: inP.filter((e) => e.kind === "email" && e.bulk).length,
    callsOut: inP.filter(isOurCall).length,
    callsConnected: inP.filter((e) => isOurCall(e) && e.connected).length,
    callsIn: inP.filter((e) => e.kind === "call" && e.dir === "in").length,
    whatsapp: inP.filter(isWhatsApp).length,
    notes: inP.filter((e) => e.kind === "note").length,
    touches: touches.filter((t) => inWindow(t.at)).length,
    openTasks: ev.filter((e) => e.kind === "task" && !e.done && String(e.ownerId) === owner).length,
    overdueTasks: ev.filter((e) => e.kind === "task" && !e.done && String(e.ownerId) === owner && clock.endOfDay(e.dueAt) < now).length,
    bulkClosedTasks: ev.filter((e) => e.kind === "task" && e.bulkClosed).length,
    lastClient, lastTouch,
    longestSilenceWd: silences.reduce((m, s) => Math.max(m, s.gapWd), 0),
    followUpsSinceClient: lastClient ? touches.filter((t) => t.at > lastClient).length : touches.length,
    clientSilentWd: lastClient ? clock.workingDaysBetween(lastClient, now) : null,
  };
  return { obligations: out, silences, hygiene, handoffs, tone, judgement, stats };
}

// ---- how each finding reads ----
const LABEL = {
  email: { late: "Late reply to client email", missed: "Client email not answered" },
  callreq: { late: "Call made after the day it was asked for", missed: "Requested call never made" },
  promise: { late: "Promise kept late", missed: "Promise not kept" },
  task: { late: "Task done late", missed: "Task overdue" },
  complaint: { late: "Complaint recorded late", missed: "Complaint not recorded" },
  handoff: { late: "Tag answered late", missed: "Tagged, no reply seen" },
};
const PART = {
  email: "Email replies", callreq: "Requested calls", promise: "Promises", task: "Tasks", complaint: "Complaints",
  callemail: "Email after a call", calltask: "Next task after a call", calldesc: "Call notes", silence: "Follow-up kept up",
  handoff: "Tags answered", tone: "Tone of emails",
};
const channel = (e) => !e ? "" : e.kind === "email" ? "an email" : e.kind === "call" ? (e.connected ? "a call" : "a call that did not connect")
  : e.kind === "whatsapp" ? "a WhatsApp" : e.kind === "note" ? "a note" : e.kind === "meeting" ? "a meeting" : e.kind;
const short = (s, n = 110) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

function comment(o, firstName, { hrs, fmtDue }) {
  const q = o.quote ? ` ("${short(o.quote, 90)}")` : "";
  const next = o.metAt != null ? `The first was ${channel(o.metBy) || "the task being ticked"} on ${fmtWhen(o.metAt)}.` : "There has been none since.";
  switch (o.type) {
    case "email":
      return o.verdict === "late"
        ? `Client emailed ${fmtWhen(o.start)}${q}. First response was ${channel(o.metBy)} on ${fmtWhen(o.metAt)}: ${hrs(o.waitWorkMs)} working hours against ${SETTINGS.EMAIL_REPLY_HOURS} allowed.${o.extra ? ` The client wrote ${o.extra} more time${o.extra > 1 ? "s" : ""} while waiting.` : ""}`
        : `Client emailed ${fmtWhen(o.start)}${q}. No reply by email, call or WhatsApp by ${fmtDue(o.due)}. ${next}${o.extra ? ` The client wrote ${o.extra} more time${o.extra > 1 ? "s" : ""}.` : ""}`;
    case "callreq":
      return `${o.missedCall ? `Client rang on ${fmtWhen(o.start)} and was not answered` : `Client asked for a call on ${fmtWhen(o.start)}${q}`}. No call was made by ${fmtDue(o.due)}. ${next}`;
    case "promise":
      return `${firstName} wrote on ${fmtWhen(o.start)}${q}: a promise ${({ call: "to call", talk: "to speak", contact: "to follow up" })[o.action] || "to send it"} ${o.when ? `"${o.when}"` : ""}, due ${fmtDue(o.due)}${o.moved ? " (the day named was a day off, so the next working day was allowed)" : ""}. ${next}`;
    case "task":
      return o.verdict === "late"
        ? `Task "${short(o.quote, 70)}" was due ${fmtDue(o.due)}; the first follow-up after it was on ${fmtWhen(o.metAt)}.`
        : `Task "${short(o.quote, 70)}" was due ${fmtDue(o.due)}, is still open, and the client has not been contacted since.`;
    case "complaint":
      return `Client complained on ${fmtWhen(o.start)}${q}. No note recorded it by ${fmtDue(o.due)}. ${o.metAt != null ? `The first note came ${fmtWhen(o.metAt)}.` : ""}`;
    case "handoff":
      return `${o.mentionName || "A colleague"} was tagged on ${fmtWhen(o.start)}${q}. No later note, email or call from them on the case by ${fmtDue(o.due)}${o.metAt ? `; they came back ${fmtWhen(o.metAt)}` : ""}. (A reply left as a comment cannot be seen.)`;
  }
  return "";
}

const SUB_LABEL = { silent_task: "a follow-up task was due and not done", silent_far: "the next follow-up task was set too far out", silent_none: "no follow-up task was set" };
const HOLDER_LABEL = { client: "waiting on the client", cm: "on the case manager's own step", petition: "with the petition team", external: "with an outside body" };
function silenceComment(s, { fmtDay }) {
  const end = s.open ? "and counting" : `until ${fmtDay(s.to)}`;
  const t = s.task ? ` (task "${short(s.task.subject, 60)}", due ${fmtDay(s.task.dueAt)})` : "";
  return `No email, call or WhatsApp to the client for ${Math.ceil(s.gapWd - 0.05)} working days from ${fmtDay(s.from)} ${end}, while the case was ${HOLDER_LABEL[s.holder] || "live"} (allowed: ${s.allowWd}). ${SUB_LABEL[s.sub]}${t}.`;
}

module.exports = { computeComms, LABEL, PART, SUB_LABEL, HOLDER_LABEL, comment, silenceComment, isTouch, answersEmail, emailToClient, STRICT_CALL, STRICT_PROMISE, phrasePromises, short };
