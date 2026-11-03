// 6-reader.js — reading only the lines that could matter.
//
// Most of a case never needs reading: emails, missed calls, tasks and follow-up gaps are
// checked from timestamps. What a rule cannot catch is something said in words: a client
// asking for a call, a promise with a time on it, a complaint, a colleague tagged and asked to
// act, an unprofessional email. Those have recognisable phrasing, so a cheap filter picks out
// only the lines that might hold one, and lines from many cases go to the reader together.
//
// The reader is never trusted on its word:
//   * every item must name its line and quote that line's words; the quote is checked in code
//   * who said it is checked: a client's words can never become a promise
//   * it never decides lateness: the clock does
// Delayed cases are read first. If the reader is off or runs out, those cases fall back to the
// rules that need no reading, and the report says how many were not read.
const { SETTINGS } = require("./config");
const { fmtWhen } = require("./1-clock");

// ---- the filter: phrases that can create an obligation ----
const CLIENT_CALL = /\b(call me|call back|callback|give me a call|please call|pls call|plz call|can you call|could you call|kindly call|ring me|phone me|contact me|call karo|call kar|call kr|call krna|call karen|phone karo|mujhe call|baat karni|baat karein|rabta|have a call|schedule a call|arrange a call|zoom|google meet|meeting)\b/i;
const NOTE_CALL = /(asked (me |us )?(to )?call|wants? (a )?call|request(ed)? (a )?call|asked for a call|call ?back|callback|to be called|call (him|her|them) (back|tomorrow|today|later)|(waiting for|expecting) (a |our )?call|follow ?up call)/i;
const INTENT = /\b(i['’]ll|i will|we['’]ll|we will|i shall|we shall|going to|will (call|send|share|update|revert|get back|follow ?up|email|mail|whatsapp|arrange|check|confirm|submit|book|schedule|let you know|contact|reach out))\b/i;
const TIME = /\b(today|tonight|tomorrow|kal|aaj|this (morning|afternoon|evening|week)|next (week|month|monday|tuesday|wednesday|thursday|friday)|(on|by|before|until) (monday|tuesday|wednesday|thursday|friday|saturday|sunday|eod|end of (the )?(day|week))|monday|tuesday|wednesday|thursday|friday|within \d+|in (\d+|a|an|one|two|three|few) (hours?|days?|minutes?|mins?)|shortly|soon|asap|later today|first thing|\d{1,2}(:\d{2})? ?(am|pm))\b/i;
const COMPLAINT = /\b(complain\w*|unhappy|disappoint\w*|not satisfied|dissatisf\w*|frustrat\w*|angry|upset|worst|terrible|pathetic|no response|not respond\w*|no one (is )?respond\w*|ignor\w*|still waiting|been waiting|waiting since|refund|legal action|cheat\w*|fraud|scam|unprofessional|escalat\w*|speak to (your |the )?manager)\b/i;
const TONE_RISK = /(\bas (i|we) (have )?(already|previously) (told|mentioned|said|informed|explained)|\bi have (already|repeatedly) (told|informed|mentioned|explained)|\bagain and again\b|\bhow many times\b|\byou (should|must) have\b|\bit is your (responsibility|fault)\b|\bnot (my|our) (problem|fault|responsibility)\b|\bread (my|the|our) (previous|earlier|last) (email|message)|\bstop (calling|emailing|sending)\b|\bwe cannot help\b|\bnothing (more )?(we|i) can do\b|\byou keep (asking|sending|calling)\b|\bdon'?t (call|email|message) (me|us) again\b|\buseless\b|\bridiculous\b|\bnonsense\b|\bstupid\b|\bfinal warning\b|!!!|\?\?\?)/i;

const fromClient = (e) => (e.kind === "email" && e.dir === "in" && e.actor === "client") || (e.kind === "call" && e.dir === "in");
const byStaff = (e) => (e.kind === "email" && e.dir === "out") || e.kind === "note" || (e.kind === "call" && e.dir === "out");
const whole = (e) => e.kind === "call" ? `${e.title || ""} ${e.description || ""}` : `${e.subject || ""} ${e.text || ""}`;

// what a line might hold, if anything
function flags(e, owner) {
  const t = whole(e), out = [];
  if (e.kind === "note" && e.compliance) return out;
  if ((e.kind === "email" && e.actor === "client" && (CLIENT_CALL.test(t) || (e.flags || []).includes("call"))) || (e.kind === "note" && NOTE_CALL.test(t))) out.push("call");
  if (byStaff(e) && INTENT.test(t) && TIME.test(t)) out.push("promise");
  if ((fromClient(e) || e.kind === "note") && (COMPLAINT.test(t) || (e.flags || []).includes("complaint"))) out.push("complaint");
  if (e.kind === "note" && (e.mentions || []).length && (String(e.ownerId) === owner || e.mentions.some((m) => String(m.id) === owner))) out.push("handoff");
  if (e.kind === "email" && e.dir === "out" && e.toClient && !e.bulk && TONE_RISK.test(t)) out.push("tone");
  return out;
}

// only the sentences that tripped the filter; the full text is kept for checking quotes
function snippet(e, why) {
  const t = whole(e).replace(/\s+/g, " ").trim();
  if (why.includes("handoff") || why.includes("tone")) return t.length > 420 ? t.slice(0, 419) + "…" : t;
  const parts = t.split(/(?<=[.!?\n])\s+/);
  const hit = parts.filter((p) => CLIENT_CALL.test(p) || NOTE_CALL.test(p) || (INTENT.test(p) && TIME.test(p)) || COMPLAINT.test(p) || INTENT.test(p));
  const s = hit.length ? hit.join(" ") : t;
  return s.length > 420 ? s.slice(0, 419) + "…" : s;
}

function candidates(c, fromMs) {
  const owner = String(c.props.hubspot_owner_id || "");
  const out = [];
  c.events.forEach((e, i) => {
    if (e.at < fromMs - 7 * 864e5) return;
    const why = flags(e, owner);
    if (why.length) out.push({ e, i, why });
  });
  return out;
}

// ---- the reader ----
const keys = () => [process.env.GEMINI_KEY, process.env.GEMINI_KEY_2].filter(Boolean);
let turn = 0, MODEL = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GEMINI = process.env.GEMINI_BASE || "https://generativelanguage.googleapis.com";

async function pickModel() {
  if (MODEL) return MODEL;
  try {
    const d = await (await fetch(`${GEMINI}/v1beta/models?pageSize=200&key=${keys()[0]}`)).json();
    const list = (d.models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => String(m.name).replace(/^models\//, ""))
      .filter((n) => !/image|tts|live|embed|aqa|native-audio|dialog|computer-use|robotics/i.test(n));
    for (const w of SETTINGS.AI_MODELS) { MODEL = list.find((n) => n === w) || list.find((n) => n.startsWith(w)); if (MODEL) break; }
    MODEL = MODEL || list.find((n) => /flash/i.test(n)) || SETTINGS.AI_MODELS[0];
  } catch { MODEL = SETTINGS.AI_MODELS[0]; }
  return MODEL;
}

async function ask(prompt, attempt = 0) {
  const k = keys();
  const res = await fetch(`${GEMINI}/v1beta/models/${await pickModel()}:generateContent?key=${k[(turn++) % k.length]}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: "application/json" } }),
  });
  const d = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
  if (d.error) {
    if (/quota|RESOURCE_EXHAUSTED|429|rate|overloaded|unavailable|503/i.test(d.error.message || "") && attempt < 4) { await sleep(15000 * (attempt + 1)); return ask(prompt, attempt + 1); }
    throw new Error(d.error.message || "the reader failed");
  }
  const t = (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("unreadable answer");
  return JSON.parse(m[0]);
}

const WHO = (e) => e.kind === "email" ? (e.dir === "in" ? "EMAIL FROM CLIENT" : "EMAIL FROM STAFF TO CLIENT")
  : e.kind === "call" ? (e.dir === "in" ? "CALL FROM CLIENT" : "CALL BY STAFF, their notes")
  : e.kind === "note" ? `INTERNAL NOTE BY STAFF${(e.mentions || []).length ? `, TAGGED: ${e.mentions.map((m) => m.name).join("; ")}` : ""}` : String(e.kind).toUpperCase();

// ---- the checks that make it safe to rely on ----
const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
function quoteIsIn(quote, event) {
  const q = norm(quote), hay = norm(whole(event));
  if (q.length < 6) return false;
  if (hay.includes(q)) return true;
  const words = q.split(" ").filter((w) => w.length > 2);
  if (words.length < 3) return false;
  return words.filter((w) => hay.includes(w)).length / words.length >= 0.85;
}
function mentionFor(name, event) {
  const n = norm(name);
  if (!n) return null;
  const ms = event.mentions || [];
  return ms.find((m) => norm(m.name) === n) || ms.find((m) => norm(m.name).startsWith(n) || n.startsWith(norm(m.name)))
    || ms.find((m) => norm(m.name).split(" ")[0] === n.split(" ")[0]) || null;
}

function verify(raw, byId) {
  const out = { callRequests: [], promises: [], complaints: [], handoffs: [], tone: [], dropped: 0 };
  const get = (id) => byId.get(String(id || "").trim().toUpperCase()) || null;
  for (const x of raw.callRequests || []) {
    const it = get(x.id);
    if (it && quoteIsIn(x.quote, it.e) && (fromClient(it.e) || it.e.kind === "note")) out.callRequests.push({ ...it, quote: String(x.quote) });
    else out.dropped++;
  }
  for (const x of raw.promises || []) {
    const it = get(x.id);
    if (it && quoteIsIn(x.quote, it.e) && byStaff(it.e))
      out.promises.push({ ...it, quote: String(x.quote), action: String(x.action || "other").toLowerCase(), when: String(x.when || ""), dueDate: String(x.dueDate || ""), dueTime: String(x.dueTime || "") });
    else out.dropped++;
  }
  for (const x of raw.complaints || []) {
    const it = get(x.id);
    if (it && quoteIsIn(x.quote, it.e) && (fromClient(it.e) || it.e.kind === "note")) out.complaints.push({ ...it, quote: String(x.quote) });
    else out.dropped++;
  }
  for (const x of raw.handoffs || []) {
    const it = get(x.id);
    const m = it && it.e.kind === "note" ? mentionFor(x.who, it.e) : null;
    if (it && m && String(m.id) !== String(it.e.ownerId) && quoteIsIn(x.quote, it.e)) out.handoffs.push({ ...it, quote: String(x.quote), mentionId: m.id, mentionName: m.name, asks: String(x.asks || "") });
    else out.dropped++;
  }
  for (const x of raw.tone || []) {
    const it = get(x.id);
    if (it && it.e.kind === "email" && it.e.dir === "out" && quoteIsIn(x.quote, it.e)) out.tone.push({ ...it, quote: String(x.quote), category: String(x.category || "unprofessional") });
    else out.dropped++;
  }
  return out;
}

const PROMPT_HEAD =
`You are a compliance reviewer at HOF Migration, an immigration consultancy. Below are single lines taken from client case records in HubSpot. Each starts with an id. Each line stands alone.

Find ONLY these five things. For each, give the line's id and a short EXACT quote copied from that line:

1. callRequests: the CLIENT asked to be called or to have a call or meeting (or a staff note records that the client asked for one). Not staff offering to call.
2. promises: a STAFF member told the client they would do something by a certain time ("I'll call you tomorrow", "will send the checklist by Monday"). Not the client's own promises. Not internal plans with no time.
   For each: action = "call" | "email" | "send" (a document, file or checklist) | "other";
   when = the time as said; dueDate = the calendar date it means, worked out from that line's own date (YYYY-MM-DD);
   dueTime = "HH:MM" only if a clock time was stated, else "". If the time is vague ("soon", "shortly", "asap"), dueDate = "".
3. complaints: the CLIENT expressed dissatisfaction or a complaint about the service or delays.
4. handoffs: an INTERNAL NOTE that tags colleagues (the TAGGED list) and clearly asks one of them to DO something or ANSWER something ("please assign a writer", "kindly upload the CIF", "can you confirm"). who = that tagged person's name exactly as in the TAGGED list; asks = what they must do, max 12 words.
   NOT handoffs: a document named or attached with no request ("@Name Excel Sheet"), a case summary, an FYI, an update, thanks, or naming people so they can see it.
5. tone: an EMAIL FROM STAFF TO CLIENT whose wording is genuinely unprofessional: rude, sarcastic, talking down, scolding ("as I already told you"), or aggressive. Not blunt, firm, brief or bad-news emails. category = "rude" | "dismissive" | "aggressive".

Only use what is written. Never invent. Most lines will have nothing; that is expected. If unsure, leave it out.

`;
const PROMPT_TAIL = `

Reply ONLY JSON:
{"callRequests":[{"id":"C3-E7","quote":"..."}],
 "promises":[{"id":"C5-E2","quote":"...","action":"call","when":"tomorrow","dueDate":"2026-09-15","dueTime":""}],
 "complaints":[{"id":"C9-E4","quote":"..."}],
 "handoffs":[{"id":"C2-E8","quote":"...","who":"Warda Badar","asks":"..."}],
 "tone":[{"id":"C4-E1","quote":"...","category":"dismissive"}]}`;

// cases: [{ idx, c, fromMs, priority }]. Returns Map<idx, reading> and counts.
async function readCases(cases, log = console.log) {
  const byCase = new Map();
  const blank = () => ({ read: false, callRequests: [], promises: [], complaints: [], handoffs: [], tone: [] });
  const stats = { requests: 0, linesRead: 0, linesUnread: 0, dropped: 0, casesRead: 0, casesUnread: 0, off: false, failed: 0 };
  const lines = [];
  for (const x of cases) {
    const cands = candidates(x.c, x.fromMs);
    byCase.set(x.idx, { ...blank(), lines: cands.length });
    for (const k of cands) lines.push({ caseIdx: x.idx, i: k.i, e: k.e, why: k.why, priority: x.priority });
  }
  if (!SETTINGS.USE_AI_READ || !keys().length) {
    stats.off = true; stats.linesUnread = lines.length;
    stats.casesUnread = [...byCase.values()].filter((r) => r.lines).length;
    return { byCase, stats };        // every case uses the rules that need no reading
  }
  // most delayed cases first; a case's lines stay together
  lines.sort((a, b) => b.priority - a.priority || a.caseIdx - b.caseIdx || a.i - b.i);
  const batches = [];
  let cur = [], size = 0;
  for (const f of lines) {
    const line = `C${f.caseIdx}-E${f.i} | ${fmtWhen(f.e.at)} | ${WHO(f.e)} | ${snippet(f.e, f.why)}`;
    if (cur.length && (cur.length >= SETTINGS.AI_BATCH_LINES || size + line.length > SETTINGS.AI_BATCH_CHARS)) { batches.push(cur); cur = []; size = 0; }
    cur.push({ ...f, line }); size += line.length;
  }
  if (cur.length) batches.push(cur);

  const failedCases = new Set(), readLines = new Map();
  for (const b of batches) {
    if (stats.requests >= SETTINGS.AI_MAX_REQUESTS) { for (const f of b) failedCases.add(f.caseIdx); stats.linesUnread += b.length; continue; }
    const byId = new Map(b.map((f) => [`C${f.caseIdx}-E${f.i}`, f]));
    try {
      stats.requests++;
      const v = verify(await ask(PROMPT_HEAD + b.map((f) => f.line).join("\n") + PROMPT_TAIL), byId);
      stats.dropped += v.dropped; stats.linesRead += b.length;
      for (const k of ["callRequests", "promises", "complaints", "handoffs", "tone"])
        for (const x of v[k]) byCase.get(x.caseIdx)[k].push({ event: x.e, quote: x.quote, action: x.action, when: x.when, dueDate: x.dueDate, dueTime: x.dueTime, mentionId: x.mentionId, mentionName: x.mentionName, asks: x.asks, category: x.category });
      for (const f of b) readLines.set(f.caseIdx, (readLines.get(f.caseIdx) || 0) + 1);
    } catch (err) {
      stats.failed++;
      log(`  a batch of ${b.length} line(s) could not be read (${String(err.message).slice(0, 80)}); those cases use the rules that need no reading`);
      for (const f of b) failedCases.add(f.caseIdx);
      stats.linesUnread += b.length;
    }
  }
  for (const [idx, r] of byCase) {
    r.read = !failedCases.has(idx);
    if (r.lines) r.read ? stats.casesRead++ : stats.casesUnread++;
  }
  return { byCase, stats };
}

module.exports = { readCases, candidates, flags, snippet, verify, quoteIsIn, mentionFor, pickModel, TONE_RISK, CLIENT_CALL };
