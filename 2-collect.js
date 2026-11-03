// 2-collect.js — reads every case in the review, once, and tidies it into one record per
// case: the deal, its stage, owner and status history, the client, and every email, call,
// note, task, meeting and WhatsApp logged on the deal and on the client's contact.
// Nothing in HubSpot is changed.
const { SETTINGS, PROGRAMS } = require("./config");
const H = require("./0-hubspot");
const { ms, DAY, HOUR, MIN, dayStart } = require("./1-clock");
const { classify, newWords, core, htmlToText, isInternal } = require("./3-classify");

// HubSpot's standard call outcomes, used if the portal's own list cannot be read.
const STANDARD_DISPOSITIONS = {
  "9d9162e7-6cf3-4944-bf63-4dff82258764": "Busy",
  "f240bbac-87c9-4f6e-bf70-924b57d47db7": "Connected",
  "a4c4c377-d246-4b32-a13b-75a56a4cd0ff": "Left live message",
  "b2cf5968-551e-4856-9783-52b3da59a7d0": "Left voicemail",
  "2e7360c1-6b71-40e9-ab2b-30ae98a4678c": "Meeting booked",
  "73a0d17f-1163-4015-bdd5-ec830791da20": "No answer",
  "17b47fee-58de-441e-a44c-c6300d46f273": "Wrong number",
};

// The service pipelines' stages, as seen in the portal, used only if HubSpot's pipeline list
// cannot be read. HubSpot's own list always wins.
const KNOWN_STAGES = {
  "149481597": [["253814309", "Sale Closed"], ["253513090", "Welcome Call"], ["253513091", "Document Collection/IEE"],
    ["1368988085", "IEE Document Collected"], ["969395090", "IEE Created (Awaiting Payment)"], ["969395091", "IEE in Process (Payment Received)"],
    ["969395092", "Phase 2 Document Collection"], ["1366400344", "LOR Drafting"], ["1274781821", "Brainstorming"],
    ["253513092", "Petition Preparation"], ["969395093", "Petition Review"], ["1366400343", "Petition Amendment"],
    ["1274699901", "Forms Filing"], ["1274699902", "Merging"], ["253513093", "Petition Filing Payment (Pending)"],
    ["969395094", "Petition Filing Credit Card Authorization"], ["1091997759", "Awaiting Dispatch Date"], ["969395095", "Petition Filed"],
    ["1180615581", "Tracking Notice"], ["1135877127", "RFE"], ["1135877128", "Re-Send Petition"], ["253513094", "Waiting for Appointment"],
    ["253513096", "Visa Granted"], ["969395096", "Visa Denied"]],
  "26920574": [["61555840", "Sale/Closed Client"], ["61555841", "Initial Call/Welcome Email"], ["61555842", "ECA Documents Collection & IELTs"],
    ["61555843", "ECA Documents Collection"], ["61555844", "IELTS"], ["159997242", "Spouse Sponsorship"], ["61555845", "ECA Under Progress"],
    ["121557414", "Express Entry & PNP"], ["121557415", "NOI/ITA"], ["121557416", "NOI Submission"], ["121557417", "Waiting for Nomination"],
    ["121557418", "Waiting for COPR"], ["121557419", "COPR Received"], ["245698165", "Resubmission"], ["1283232271", "Completely Closed"],
    ["1284467736", "Visa Granted - Completely Closed"]],
};
const PIPELINE_IDS = [...new Set(Object.values(PROGRAMS).map((p) => p.pipeline))];
const STAGE_IDS = Object.fromEntries(PIPELINE_IDS.map((p) => [p, (KNOWN_STAGES[p] || []).map((s) => s[0])]));

const HISTORY_PROPS = ["dealstage", "hubspot_owner_id", "client_status", "application_status", "petition_status", "lor_status"];
const DEAL_PROPS = ["dealname", "pipeline", "dealstage", "hubspot_owner_id", "hubspot_owner_assigneddate", "createdate", "closedate",
  "client_status", "application_status", "immigration_program", "petition_status", "lor_status", "visa_application_status",
  "case_category", "hs_v2_date_entered_current_stage", "hs_lastmodifieddate",
  ...PIPELINE_IDS.flatMap((p) => STAGE_IDS[p].map((s) => `hs_v2_date_entered_${s}`))];
const PROPS = {
  emails: ["hs_timestamp", "hs_createdate", "hs_email_direction", "hs_email_status", "hs_email_subject", "hs_email_text",
    "hs_email_from_email", "hs_email_to_email", "hs_email_cc_email", "hubspot_owner_id", "hs_attachment_ids"],
  calls: ["hs_timestamp", "hs_createdate", "hs_call_direction", "hs_call_disposition", "hs_call_duration", "hs_call_status",
    "hs_call_title", "hs_call_body", "hubspot_owner_id"],
  notes: ["hs_timestamp", "hs_createdate", "hs_note_body", "hubspot_owner_id", "hs_created_by", "hs_attachment_ids"],
  tasks: ["hs_timestamp", "hs_createdate", "hs_task_status", "hs_task_subject", "hs_task_completion_date", "hubspot_owner_id", "hs_lastmodifieddate"],
  meetings: ["hs_timestamp", "hs_createdate", "hs_meeting_start_time", "hs_meeting_title", "hs_meeting_outcome", "hubspot_owner_id"],
  communications: ["hs_timestamp", "hs_createdate", "hs_communication_channel_type", "hs_communication_logged_from", "hubspot_owner_id"],
};
const TYPES = Object.keys(PROPS);
const CONTACT_PROPS = ["firstname", "lastname", "email", "phone", "mobilephone", "hs_additional_emails"];

// ---------------------------------------------------------------- tidying (tested in selftest.js)
const strip = (h) => String(h || "").replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|li)>/gi, "\n").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&rsquo;|&lsquo;/g, "'")
  .replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&[a-z]+;/gi, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
const oneLine = (s, n) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return n && t.length > n ? t.slice(0, n - 1) + "…" : t; };

// The client's name for the report: the contact's name, unless the client typed it in
// decorative letters ("ĂĽĩ Ăřsąlăŋ"); then the client part of the deal name
// ("Ali Arsalan -Canada PR") reads better and matches Petition Studio.
const DECORATIVE = (cp) => (cp >= 0x100 && cp <= 0x2AF) || (cp >= 0x1D00 && cp <= 0x1EFF) || (cp >= 0x1D400 && cp <= 0x1D7FF) || (cp >= 0xFF21 && cp <= 0xFF5A);
const PROGRAM_WORDS = /\b(canada|usa|us|niw|eb ?2|australia|aus|pr|visa|express|entry|pnp|sinp|lmia|sales|immigration|program|dual|single|case)\b/i;
function clientName(p, dealname) {
  const contact = oneLine([p.firstname, p.lastname].filter(Boolean).join(" "));
  const deal = oneLine(dealname);
  const letters = [...contact].filter((ch) => /\p{L}/u.test(ch));
  const fancy = letters.length > 0 && letters.filter((ch) => DECORATIVE(ch.codePointAt(0))).length / letters.length > 0.4;
  if (contact && !fancy) return contact;
  const part = deal.split(/\s+[-–—|(:]+\s*|\s*[-–—|(:]+\s+/).map((s) => s.trim())
    .find((s) => /^[A-Za-z][A-Za-z .'-]*$/.test(s) && s.split(" ").length >= 2 && !PROGRAM_WORDS.test(s));
  return part || contact || deal || "Unknown";
}

const PLACEHOLDER = /^(na|n\/a|n\.a\.?|none|nil|no|ok|done|-+|\.+|x+|call|called|test)$/i;
// "Call id : 5c3bba9e-…" is the dialler's own log, not something a person wrote.
const DIALLER = /call\s*id\s*:?\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
function realDescription(text) {
  const t = String(text || "").replace(DIALLER, " ").replace(/\bziwo call\b/gi, " ").replace(/\s+/g, " ").trim();
  return t.length >= 3 && !PLACEHOLDER.test(t) ? t : "";
}
const sentOk = (status) => !/bounce|fail|cancel|error|schedul/i.test(String(status || ""));
const addresses = (s) => (String(s || "").toLowerCase().match(/[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || []);
const isAutomated = (addr) => {
  const a = String(addr || "").toLowerCase(), dom = a.split("@")[1] || "";
  return SETTINGS.AUTOMATED_SENDERS.test(a) || SETTINGS.AUTOMATED_DOMAINS.some((d) => dom === d || dom.endsWith("." + d));
};
// <span data-mention-id="123" data-mention-name="Warda Badar">
function mentionsIn(html) {
  const out = [], seen = new Set();
  const re = /data-mention-id="(\d+)"[^>]*?data-mention-name="([^"]*)"|data-mention-name="([^"]*)"[^>]*?data-mention-id="(\d+)"/g;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const id = m[1] || m[4], name = m[2] || m[3];
    if (!seen.has(id)) { seen.add(id); out.push({ id, name }); }
  }
  return out;
}
const isComplianceNote = (text) => (/^\s*hi\s*@/i.test(text) && /\bkindly\b/i.test(text)) || /\[compliance\]/i.test(text) || /^\s*compliance check/i.test(text);
const at = (p, ...keys) => { for (const k of keys) { const v = ms(p[k]); if (v) return v; } return 0; };

function connected(p) {
  const disp = String(p.hs_call_disposition || "");
  if (disp === SETTINGS.CONNECTED_DISPOSITION) return true;
  if (SETTINGS.NOT_CONNECTED_DISPOSITIONS.includes(disp)) return false;
  if (/busy|no.?answer|failed|cancel|missed|queued|ringing/i.test(String(p.hs_call_status || ""))) return false;
  return Number(p.hs_call_duration || 0) >= SETTINGS.CONNECTED_MIN_SECONDS * 1000;
}

function normEmail(id, p, clientEmails) {
  const dirRaw = String(p.hs_email_direction || "");
  const from = String(p.hs_email_from_email || "").toLowerCase();
  const to = [...addresses(p.hs_email_to_email), ...addresses(p.hs_email_cc_email)];
  const t = at(p, "hs_timestamp", "hs_createdate");
  const staffFrom = isInternal(from);
  let dir = dirRaw === "INCOMING_EMAIL" ? "in" : "out";
  if (dir === "in" && staffFrom) dir = "staffcopy";          // a colleague's email filed as incoming
  const actor = dir === "in" ? (isAutomated(from) || SETTINGS.AUTOMATED_SUBJECTS.test(String(p.hs_email_subject || "")) ? "system" : "client") : "staff";
  const subject = oneLine(p.hs_email_subject, 200);
  const e = {
    kind: "email", id: String(id), at: t, dir, actor, from, subject,
    ownerId: String(p.hubspot_owner_id || ""), ok: sentOk(p.hs_email_status), files: !!String(p.hs_attachment_ids || "").trim(),
    // to the client: any recipient outside HOF who is not a machine (clients use more than one address)
    toClient: dir === "out" && to.some((a) => !isInternal(a) && !isAutomated(a)),
    toKnownClient: dir === "out" && to.some((a) => clientEmails.has(a)),
  };
  if (actor === "client") {
    const c = classify({ from, subject: p.hs_email_subject, text: p.hs_email_text, html: p.hs_email_html, attachments: e.files });
    e.needs = c.needs; e.needKey = c.key; e.needReason = c.reason; e.flags = c.flags;
    e.text = oneLine(c.words || core(String(p.hs_email_text || "").trim() ? p.hs_email_text : htmlToText(p.hs_email_html)), 900);
    e.emptyText = !String(p.hs_email_text || "").trim() && !p.hs_email_html;
  } else {
    const raw = String(p.hs_email_text || "").trim() ? p.hs_email_text : htmlToText(p.hs_email_html);
    e.text = oneLine(newWords(raw), 700);
  }
  return e;
}
function normCall(id, p, dispo) {
  const disp = String(p.hs_call_disposition || "");
  const outcome = dispo[disp] || STANDARD_DISPOSITIONS[disp] || (disp ? "Other" : "");
  const body = strip(p.hs_call_body || "");
  return {
    kind: "call", id: String(id), at: at(p, "hs_timestamp", "hs_createdate"), ownerId: String(p.hubspot_owner_id || ""),
    dir: String(p.hs_call_direction || "").toUpperCase() === "INBOUND" ? "in" : "out",
    connected: connected(p), wrongNumber: disp === SETTINGS.WRONG_NUMBER_DISPOSITION, outcome,
    description: oneLine(realDescription(body), 500), title: oneLine(p.hs_call_title, 120),
  };
}
function normNote(id, p) {
  const body = String(p.hs_note_body || "");
  const text = oneLine(strip(body), 1500);
  return {
    kind: "note", id: String(id), at: at(p, "hs_timestamp", "hs_createdate"),
    ownerId: String(p.hubspot_owner_id || p.hs_created_by || ""), text, mentions: mentionsIn(body),
    hasFile: /<img\b/i.test(body) || !!String(p.hs_attachment_ids || "").trim(), compliance: isComplianceNote(text),
  };
}
function normTask(id, p) {
  const subject = oneLine(p.hs_task_subject, 160);
  const done = /^completed$/i.test(String(p.hs_task_status || ""));
  return {
    kind: "task", id: String(id), at: ms(p.hs_timestamp) || ms(p.hs_createdate), dueAt: ms(p.hs_timestamp) || ms(p.hs_createdate),
    createdAt: ms(p.hs_createdate), done, completedAt: done ? (ms(p.hs_task_completion_date) || 0) : 0,
    completedEstimated: done && !ms(p.hs_task_completion_date), ownerId: String(p.hubspot_owner_id || ""), subject,
    compliance: /^\s*\[compliance\]/i.test(subject), followUp: SETTINGS.FOLLOW_UP_TASK.test(subject),
  };
}
function normMeeting(id, p) {
  return { kind: "meeting", id: String(id), at: at(p, "hs_meeting_start_time", "hs_timestamp", "hs_createdate"),
    ownerId: String(p.hubspot_owner_id || ""), title: oneLine(p.hs_meeting_title, 120), outcome: String(p.hs_meeting_outcome || "") };
}
function normComm(id, p) {
  const ch = String(p.hs_communication_channel_type || "").trim().toUpperCase();
  // tolerant on purpose: a blank channel still counts (matching strictly once threw away every
  // logged WhatsApp)
  if (/SMS|LINKEDIN/.test(ch)) return null;
  return { kind: "whatsapp", id: String(id), at: at(p, "hs_timestamp", "hs_createdate"), dir: "out", ownerId: String(p.hubspot_owner_id || ""), source: "hubspot" };
}

// The dialler logs a copy of each call about a minute from the person's own log. Calls by one
// person within a few minutes are one attempt: connected if any copy connected, and described
// if any copy was described.
function collapseCalls(calls) {
  const out = [];
  const gap = SETTINGS.SAME_CALL_MINUTES * MIN;
  for (const c of [...calls].sort((a, b) => a.at - b.at)) {
    const last = out[out.length - 1];
    if (last && last.dir === c.dir && last.ownerId === c.ownerId && c.at - last.lastAt <= gap) {
      last.connected = last.connected || c.connected;
      last.wrongNumber = last.wrongNumber && c.wrongNumber;
      if (!last.description && c.description) last.description = c.description;
      if (c.connected) last.outcome = c.outcome;
      last.lastAt = c.at; last.copies++;
      continue;
    }
    out.push({ ...c, lastAt: c.at, copies: 1 });
  }
  return out;
}

// Tasks ticked together in one go (a clean-up) carry no information about when they were done.
function markBulkTasks(tasks) {
  const done = tasks.filter((t) => t.done && t.completedAt).sort((a, b) => a.completedAt - b.completedAt);
  for (let i = 0; i < done.length; i++) {
    let j = i;
    while (j + 1 < done.length && done[j + 1].completedAt - done[i].completedAt <= 2 * MIN) j++;
    if (j - i + 1 >= SETTINGS.BULK_TASKS) for (let k = i; k <= j; k++) done[k].bulkClosed = true;
    i = j;
  }
  return tasks;
}

// Marketing: by subject, or one sender mailing the same subject to many cases in one day
// (when that sender is not a case manager).
// A reply ("Re: ...") is never a mailing.
function markBulkEmails(cases, cmEmails) {
  const isReply = (e) => /^\s*(re|fw|fwd)\s*:/i.test(String(e.subject || ""));
  const key = (e) => `${e.from}|${String(e.subject || "").toLowerCase().trim()}|${dayStart(e.at)}`;
  const reach = new Map();
  for (const c of cases) for (const e of c.events) {
    if (e.kind !== "email" || e.dir !== "out" || isReply(e)) continue;
    const k = key(e);
    if (!reach.has(k)) reach.set(k, new Set());
    reach.get(k).add(c.id);
  }
  let n = 0;
  for (const c of cases) for (const e of c.events) {
    if (e.kind !== "email" || e.dir !== "out") continue;
    const many = !isReply(e) && reach.get(key(e)).size >= SETTINGS.BULK_MIN_CASES && !cmEmails.has(e.from);
    if (SETTINGS.MARKETING_SUBJECTS.test(e.subject || "") || many) { e.bulk = true; n++; }
  }
  return n;
}

// History entries, oldest first: { value, at, sourceType }
function parseHistory(list) {
  return (Array.isArray(list) ? list : []).map((h) => ({ value: h.value == null ? "" : String(h.value), at: ms(h.timestamp), sourceType: String(h.sourceType || "") }))
    .filter((h) => h.at).sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------------- reading
async function linksSafe(from, to, ids, log, note) {
  const names = to === "communications" ? ["communications", "0-18"] : [to];
  let last;
  for (const n of names) { try { return { map: await H.links(from, n, ids), ok: true }; } catch (e) { last = e; } }
  if (note) log(`  !! could not read ${from} -> ${to} links (${last && last.message})`);
  return { map: new Map(), ok: false };
}

async function readStages(log) {
  let pipes = { stages: {}, names: {} };
  try { pipes = await H.pipelines(); } catch (e) { log(`  !! could not read the deal pipelines (${e.message}); using the stage names built in`); }
  for (const [pid, list] of Object.entries(KNOWN_STAGES)) list.forEach(([sid, label], i) => {
    if (!pipes.stages[sid]) pipes.stages[sid] = { label, pipelineId: pid, order: i };
  });
  return pipes;
}

// deals in the review: owned by the chosen case managers, owner assigned since FROM, in the
// service pipelines
async function findCases({ ownerIds, fromMs, now, log }) {
  const filters = [
    { propertyName: "hubspot_owner_id", operator: "IN", values: ownerIds },
    { propertyName: "pipeline", operator: "IN", values: PIPELINE_IDS },
  ];
  const found = await H.searchByDate("deals", filters, "hubspot_owner_assigneddate", fromMs, now + DAY, DEAL_PROPS);
  log(`Cases found: ${found.length}`);
  return found.map((d) => ({ id: String(d.id), props: d.properties || {} }));
}

// everything about a chunk of cases
async function readChunk(deals, { dispo, readFromOf, contactLinks, contactUse, log, warn }) {
  const ids = deals.map((d) => d.id);
  const avail = {};
  // 1. history, one record at a time (the batch version cuts history short)
  const hist = await H.pool(deals, SETTINGS.HISTORY_CONCURRENCY, async (d) => {
    try { const h = await H.history("deals", d.id, HISTORY_PROPS); return { ok: true, h }; }
    catch (e) { return { ok: false, h: {} }; }
  });
  // 2. contacts (the links were read for every case up front, to spot clients with two cases)
  const contactIds = [...new Set(ids.flatMap((id) => (contactLinks.get(id) || []).slice(0, 3)))];
  const contacts = contactIds.length ? await H.batchRead("contacts", contactIds, CONTACT_PROPS) : new Map();
  // 3. engagements on the deals, and on the contacts used for this chunk
  const usable = contactIds.filter((c) => contactUse(c));
  const engIds = {}; const dealEng = {}, contEng = {};
  for (const t of TYPES) {
    const a = await linksSafe("deals", t, ids, log, t !== "communications");
    const b = usable.length ? await linksSafe("contacts", t, usable, log, false) : { map: new Map(), ok: true };
    avail[t] = a.ok;
    dealEng[t] = a.map; contEng[t] = b.map;
    engIds[t] = new Set([...[...a.map.values()].flat(), ...[...b.map.values()].flat()]);
  }
  const raw = {};
  for (const t of TYPES) {
    raw[t] = engIds[t].size ? await H.batchRead(t, [...engIds[t]], PROPS[t]).catch((e) => { warn(`${t} could not be read for some cases (${e.message.slice(0, 80)})`); return new Map(); }) : new Map();
  }
  // emails that reached HubSpot with only an HTML body: the HTML is read for client emails only
  const htmlNeeded = [...raw.emails.entries()].filter(([, p]) => p.hs_email_direction === "INCOMING_EMAIL" && !String(p.hs_email_text || "").trim()).map(([id]) => id);
  if (htmlNeeded.length) {
    const html = await H.batchRead("emails", htmlNeeded, ["hs_email_html"]).catch(() => new Map());
    for (const [id, p] of html) if (raw.emails.has(id)) raw.emails.get(id).hs_email_html = p.hs_email_html;
  }

  // 4. one record per case
  const out = deals.map((d, i) => {
    const cIds = (contactLinks.get(d.id) || []).slice(0, 3);
    const people = cIds.map((cid) => ({ id: cid, ...(contacts.get(cid) || {}) }));
    const clientEmails = new Set(people.flatMap((p) => [String(p.email || "").toLowerCase(), ...addresses(p.hs_additional_emails)]).filter(Boolean));
    const readFrom = readFromOf(d);
    const useContacts = cIds.filter((c) => contactUse(c));
    const evIds = {};
    for (const t of TYPES) evIds[t] = new Set([...(dealEng[t].get(d.id) || []), ...useContacts.flatMap((c) => contEng[t].get(c) || [])]);
    const events = [];
    for (const id of evIds.emails) { const p = raw.emails.get(id); if (!p) continue; const e = normEmail(id, p, clientEmails); if (e.at >= readFrom && e.dir !== "staffcopy") events.push(e); }
    const calls = [];
    for (const id of evIds.calls) { const p = raw.calls.get(id); if (!p) continue; const c = normCall(id, p, dispo); if (c.at >= readFrom) calls.push(c); }
    events.push(...collapseCalls(calls));
    for (const id of evIds.notes) { const p = raw.notes.get(id); if (!p) continue; const n = normNote(id, p); if (n.at >= readFrom) events.push(n); }
    const tasks = [];
    for (const id of evIds.tasks) { const p = raw.tasks.get(id); if (!p) continue; const k = normTask(id, p); if (k.dueAt >= readFrom || !k.done || k.completedAt >= readFrom) tasks.push(k); }
    events.push(...markBulkTasks(tasks));
    for (const id of evIds.meetings) { const p = raw.meetings.get(id); if (!p) continue; const m = normMeeting(id, p); if (m.at >= readFrom) events.push(m); }
    for (const id of evIds.communications) { const p = raw.communications.get(id); if (!p) continue; const w = normComm(id, p); if (w && w.at >= readFrom) events.push(w); }
    events.sort((a, b) => a.at - b.at);
    const primary = people[0] || {};
    return {
      id: d.id, props: d.props, link: H.dealLink(d.id),
      history: Object.fromEntries(HISTORY_PROPS.map((k) => [k, parseHistory(hist[i].h[k])])), historyOk: hist[i].ok,
      contacts: people.map((p) => ({ id: p.id, name: [p.firstname, p.lastname].filter(Boolean).join(" ").trim(), email: p.email || "", phone: p.phone || p.mobilephone || "" })),
      client: clientName(primary, d.props.dealname),
      email: String(primary.email || ""), phone: String(primary.phone || primary.mobilephone || ""),
      sharedContact: cIds.some((c) => !contactUse(c)),
      events, readFrom,
    };
  });
  return { cases: out, avail };
}

module.exports = { readStages, findCases, readChunk, linksSafe, markBulkEmails, collapseCalls, markBulkTasks, parseHistory, mentionsIn, realDescription,
  strip, oneLine, clientName, normEmail, normCall, normNote, normTask, normComm, connected, addresses, STANDARD_DISPOSITIONS, KNOWN_STAGES,
  PIPELINE_IDS, DEAL_PROPS, HISTORY_PROPS, TYPES, PROPS };
