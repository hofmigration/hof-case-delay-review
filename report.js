// report.js — the run.
//
// MODE=discover  checks the connections, counts the cases for each case manager and program,
//                and shows what one case's record holds and what Petition Studio returns.
//                No client text is printed.
// MODE=report    reviews every case, writes the workbook and the email, and sends it.
//
// Read-only. Nothing in HubSpot, Petition Studio or Chatwoot is changed.
const fs = require("fs");
const path = require("path");
const { SETTINGS, PROGRAMS, IDEAL_DAYS } = require("./config");
const H = require("./0-hubspot");
const { makeClock, parseDay, setNow, fmtDay, dateKey, plural, DAY } = require("./1-clock");
const C = require("./2-collect");
const { buildFacts, programOf } = require("./4-timeline");
const { computeComms } = require("./5-comms");
const { readCases, pickModel } = require("./6-reader");
const PS = require("./7-petition");
const A = require("./8-attribute");
const WA = require("./9-whatsapp");

const MODE = String(process.env.MODE || "report").toLowerCase();
const log = (...a) => console.log(...a);
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

// "all", or names / owner ids separated by commas. Every word typed must be in the name.
function chooseCaseManagers(input, owners) {
  const known = Object.entries(SETTINGS.CASE_MANAGERS).map(([ownerId, name]) => ({ ownerId, name: (owners.find((o) => o.ownerId === ownerId) || {}).name || name }));
  const raw = String(input || "all").trim();
  if (!raw || /^all$/i.test(raw)) return { list: known, problems: [] };
  const list = [], problems = [];
  for (const term of raw.split(/[,;|\n]+/).map((t) => t.trim()).filter(Boolean)) {
    const words = norm(term).split(" ");
    const hit = /^\d+$/.test(term) ? known.filter((k) => k.ownerId === term) : known.filter((k) => words.every((w) => norm(k.name).split(" ").some((x) => x.startsWith(w))));
    if (hit.length === 1) { if (!list.some((l) => l.ownerId === hit[0].ownerId)) list.push(hit[0]); }
    else problems.push(hit.length ? `"${term}" matches ${hit.map((h) => h.name).join(", ")}; type more of the name.` : `"${term}" is not one of the case managers in config.js.`);
  }
  return { list, problems };
}
// LEAVE in config.js, by owner id. Names are matched the same way as the case_managers box.
function leaveByOwner(leave = SETTINGS.LEAVE, owners = []) {
  const map = new Map(), problems = [];
  for (const [who, dates] of Object.entries(leave || {})) {
    const { list, problems: p } = chooseCaseManagers(who, owners);
    if (p.length || list.length !== 1) { problems.push(`LEAVE in config.js: ${p[0] || `"${who}" matches more than one case manager; type more of the name.`}`); continue; }
    const set = map.get(list[0].ownerId) || new Set();
    for (const d of [].concat(dates || [])) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(d).trim())) set.add(String(d).trim());
      else problems.push(`LEAVE in config.js: "${d}" for ${who} is not a YYYY-MM-DD date, so it was left out.`);
    }
    map.set(list[0].ownerId, set);
  }
  return { map, problems };
}
function choosePrograms(input) {
  const raw = String(input || "all").toLowerCase();
  if (!raw || raw === "all") return Object.keys(PROGRAMS);
  return Object.keys(PROGRAMS).filter((p) => raw.includes(p.toLowerCase()));
}

async function gather({ now, fromMs, cms, programs, limit, warnings }) {
  let owners = [];
  try { owners = await H.owners(); } catch (e) { warnings.push(`HubSpot users could not be read (${e.message}); names come from config.js.`); }
  const ownerNames = Object.fromEntries(owners.map((o) => [o.ownerId, o.name]));
  for (const [id, n] of Object.entries(SETTINGS.CASE_MANAGERS)) if (!ownerNames[id]) ownerNames[id] = n;
  const cmEmails = new Set(owners.filter((o) => SETTINGS.CASE_MANAGERS[o.ownerId]).map((o) => o.email).filter(Boolean));
  const pipes = await C.readStages(log);
  const stageLabel = (sid) => (pipes.stages[sid] || {}).label || `stage ${sid}`;
  let deals = await C.findCases({ ownerIds: cms.map((c) => c.ownerId), fromMs, now, log });
  deals = deals.filter((d) => programs.includes(programOf(d.props).program));
  deals.sort((a, b) => Number(a.id) - Number(b.id));
  if (limit) deals = deals.slice(0, limit);
  log(`Cases in this review: ${deals.length} (${programs.join(", ")})`);
  // A client with two service cases (a Canada and an Australia file, say) has one contact for
  // both, so what is logged on the contact cannot be split between them. For those clients only
  // what is logged on each deal is read.
  const cl = await C.linksSafe("deals", "contacts", deals.map((d) => d.id), log, true);
  const contactCount = new Map();
  const allContacts = [...new Set([...cl.map.values()].flatMap((ids) => ids.slice(0, 3)))];
  const cd = allContacts.length ? await C.linksSafe("contacts", "deals", allContacts, log, true) : { map: new Map(), ok: false };
  if (cd.ok) {
    const pipeOf = new Map(deals.map((d) => [d.id, String(d.props.pipeline)]));
    const unknown = [...new Set([...cd.map.values()].flat())].filter((id) => !pipeOf.has(id));
    if (unknown.length) for (const [id, p] of await H.batchRead("deals", unknown, ["pipeline"]).catch(() => new Map())) pipeOf.set(id, String(p.pipeline));
    for (const [c, ids] of cd.map) contactCount.set(c, ids.filter((id) => C.PIPELINE_IDS.includes(pipeOf.get(id))).length);
  } else for (const ids of cl.map.values()) for (const c of ids.slice(0, 3)) contactCount.set(c, (contactCount.get(c) || 0) + 1);
  let dispo = {};
  try { dispo = await H.options("calls", "hs_call_disposition"); } catch { dispo = {}; }
  dispo = { ...C.STANDARD_DISPOSITIONS, ...dispo };
  const readFromOf = (d) => Math.max(fromMs, 0) - SETTINGS.READ_BUFFER_DAYS * DAY;
  const records = [], avail = {};
  for (let i = 0; i < deals.length; i += SETTINGS.CHUNK) {
    const chunk = deals.slice(i, i + SETTINGS.CHUNK);
    const { cases, avail: a } = await C.readChunk(chunk, { dispo, readFromOf, contactLinks: cl.map, contactUse: (c) => (contactCount.get(c) || 0) <= 1, log, warn: (w) => warnings.push(w) });
    for (const [k, v] of Object.entries(a)) avail[k] = avail[k] === undefined ? v : avail[k] && v;
    records.push(...cases);
    log(`  read ${Math.min(i + SETTINGS.CHUNK, deals.length)}/${deals.length} cases (${H.stats.calls} HubSpot calls)`);
  }
  const bulk = C.markBulkEmails(records, cmEmails);
  return { records, owners, ownerNames, pipes, stageLabel, avail, bulk, historyFailed: records.filter((r) => !r.historyOk).length };
}

// ============================================================ DISCOVER
async function discover() {
  const now = Date.now(); setNow(now);
  const fromMs = parseDay(process.env.FROM_DATE || SETTINGS.FROM_DATE);
  log(`=== Case delay review: discovery ===\n`);
  const owners = await H.owners();
  const { list: cms, problems } = chooseCaseManagers(process.env.CASE_MANAGERS, owners);
  for (const c of cms) log(`  ${owners.some((o) => o.ownerId === c.ownerId) ? "ok" : "!!"}  ${c.name} (${c.ownerId})`);
  problems.forEach((p) => log(`  !! ${p}`));
  const leave = leaveByOwner(SETTINGS.LEAVE, owners);
  if (leave.map.size) log(`Leave listed in config.js: ${[...leave.map].map(([id, d]) => `${SETTINGS.CASE_MANAGERS[id] || id} (${plural(d.size, "day")})`).join(", ")}`);
  leave.problems.forEach((p) => log(`  !! ${p}`));
  const pipes = await C.readStages(log);
  for (const p of C.PIPELINE_IDS) log(`Pipeline ${pipes.names[p] || p}: ${Object.values(pipes.stages).filter((s) => s.pipelineId === p).length} stages`);
  const deals = await C.findCases({ ownerIds: cms.map((c) => c.ownerId), fromMs, now, log });
  const count = {};
  for (const d of deals) { const k = `${(cms.find((c) => c.ownerId === String(d.props.hubspot_owner_id)) || {}).name}|${programOf(d.props).program}`; count[k] = (count[k] || 0) + 1; }
  log(`\nCases since ${fmtDay(fromMs)} by case manager and program:`);
  for (const c of cms) log(`  ${c.name.padEnd(22)} ${Object.keys(PROGRAMS).map((p) => `${p} ${count[`${c.name}|${p}`] || 0}`).join("   ")}`);
  if (deals.length) {
    const d = deals[Math.floor(deals.length / 2)];
    log(`\nCan the token read each kind of record? (sample case ${d.id})`);
    for (const t of ["contacts", ...C.TYPES]) {
      try { const m = await H.links("deals", t === "communications" ? "communications" : t, [d.id]); log(`  ok  ${t} (${(m.get(d.id) || []).length})`); }
      catch (e) { log(`  !!  ${t}: ${e.message.slice(0, 90)}`); }
    }
    try { const h = await H.history("deals", d.id, C.HISTORY_PROPS); log(`  ok  stage history (${(h.dealstage || []).length} changes), owner history (${(h.hubspot_owner_id || []).length})`); }
    catch (e) { log(`  !!  history: ${e.message.slice(0, 90)}`); }
  }
  log(`\nReader: ${process.env.GEMINI_KEY ? await pickModel() : "off (no GEMINI_KEY): promises, complaints, tags and tone will not be read"}`);
  log(`WhatsApp: ${WA.whatsappOn() ? "Chatwoot token present" : "off (no CHATWOOT_TOKEN): emails answered on WhatsApp will count as unanswered"}`);
  if (PS.on()) {
    const s = await PS.loadStudio(log);
    if (!s.ok) log(`Petition Studio: could not be read (${s.why})`);
    else {
      const fields = {};
      for (const r of s.rows) for (const [k, v] of Object.entries(r || {})) if (v !== null && v !== "") fields[k] = (fields[k] || 0) + 1;
      log(`Petition Studio fields on a case (how many cases have each):`);
      for (const [k, n] of Object.entries(fields).sort((a, b) => b[1] - a[1]).slice(0, 40)) log(`  ${k.padEnd(28)} ${n}`);
      const usa = deals.filter((d) => programOf(d.props).program === "USA");
      log(`Filtered checks returning cases: ${[...s.probeHits.values()].flat().length}`);
      log(`USA cases in this review: ${usa.length}. Matching is by client email, then name.`);
    }
  } else log(`Petition Studio: off (${SETTINGS.USE_PETITION_STUDIO ? "no PETITION_API_KEY" : "switched off in config.js"})`);
  log(`\n=== Looks usable. Run again with mode = report. ===`);
}

// ============================================================ REPORT
async function report() {
  const now = process.env.REPORT_NOW ? Date.parse(process.env.REPORT_NOW) : Date.now();   // REPORT_NOW is for testing
  setNow(now);
  const clock = makeClock();
  const fromMs = parseDay(process.env.FROM_DATE || SETTINGS.FROM_DATE);
  if (fromMs == null) throw new Error(`The from date must be YYYY-MM-DD (got "${process.env.FROM_DATE}").`);
  const warnings = [];
  const years = [...new Set([dateKey(fromMs), dateKey(now)].map((d) => d.slice(0, 4)))];
  const missing = years.filter((y) => !SETTINGS.HOLIDAYS.some((h) => h.startsWith(y)));
  if (missing.length) warnings.push(`No UAE public holidays are listed for ${missing.join(", ")} in config.js, so any holiday that year was counted as a working day.`);

  const ownersEarly = await H.owners().catch(() => []);
  const { list: cms, problems } = chooseCaseManagers(process.env.CASE_MANAGERS, ownersEarly);
  if (problems.length) throw new Error(problems.join(" "));
  const programs = choosePrograms(process.env.PROGRAMS);
  const leave = leaveByOwner(SETTINGS.LEAVE, ownersEarly);
  warnings.push(...leave.problems);
  const limit = /^\d+$/.test(String(process.env.LIMIT || "")) ? Number(process.env.LIMIT) : 0;
  log(`Case delay review: cases assigned since ${fmtDay(fromMs)}, ${cms.length} case managers, ${programs.join(", ")}${limit ? `, first ${limit} cases` : ""}\n`);

  const g = await gather({ now, fromMs, cms, programs, limit, warnings });
  if (!g.records.length) throw new Error("No cases matched.");
  for (const t of C.TYPES) if (g.avail[t] === false && t !== "communications") warnings.push(`HubSpot ${t} could not be read, so checks that need them are left out.`);
  if (g.historyFailed) warnings.push(`The stage history of ${g.historyFailed} cases could not be read; their stage dates come from HubSpot's "date entered" fields.`);

  // ---- facts for every case
  const rows = g.records.map((c) => {
    const facts = buildFacts(c, { stages: g.pipes.stages, now, fromMs, stageLabel: g.stageLabel });
    return { c, facts };
  });
  // ---- pass 1: the rules that need no reading, to find which cases are delayed
  for (const r of rows) {
    r.comms = computeComms(r.c, r.facts, null, { clock, now });
    r.attr = A.attribute(r.facts, r.comms, null, now);
  }

  // ---- the reader, most delayed cases first
  const { byCase, stats: ai } = await readCases(rows.map((r, idx) => ({ idx, c: r.c, fromMs: r.facts.reviewStart, priority: r.attr.lateMs + r.facts.behindMs })), log);
  log(`Reader: ${ai.off ? "off" : `${ai.requests} requests, ${ai.linesRead} lines read, ${ai.linesUnread} not read, ${ai.dropped} unverifiable items dropped`}`);
  if (ai.off) warnings.push("The reader was off (no GEMINI_KEY), so call requests were taken only from clear phrases, and promises, tags and tone were not checked.");
  else if (ai.casesUnread) warnings.push(`${ai.casesUnread} cases could not be read in full (reader limit or errors); they use the rules that need no reading.`);

  // ---- Petition Studio, every USA case
  let studio = { ok: false, why: "" };
  const psByCase = new Map();
  const usa = rows.filter((r) => r.facts.program === "USA");
  if (usa.length && PS.on()) {
    studio = await PS.loadStudio(log);
    if (studio.ok) {
      const res = await PS.checkUSA(usa.map((r) => ({ c: r.c, searchWorthy: r.facts.actualIndex != null && r.facts.actualIndex >= 2 && !r.facts.done })), studio, { now, ownerNames: g.ownerNames, log });
      for (const [id, v] of res) psByCase.set(id, v);
    } else warnings.push(`Petition Studio could not be read (${studio.why}), so USA delays could not be checked against it.`);
  } else if (usa.length) warnings.push(`Petition Studio was not checked (${SETTINGS.USE_PETITION_STUDIO ? "no PETITION_API_KEY secret" : "switched off in config.js"}); USA delays with the petition team come from HubSpot's stage and Petition Status only.`);
  for (const r of usa) {
    const ps = psByCase.get(r.c.id);
    r.ps = ps || null;
    // Petition Studio already shows a later phase than HubSpot: the stage was not updated, and
    // the case is judged where Petition Studio says it is
    if (ps && ps.found && !r.facts.stale && ps.rank != null && !r.facts.finished && r.facts.actualIndex != null) {
      const phaseKey = (PROGRAMS.USA.phases[r.facts.actualIndex] || {}).key;
      if (PS.gap(ps.rank, phaseKey) >= 2) {
        const idx = Math.min(ps.rank, PROGRAMS.USA.phases.length);
        r.facts.stale = { at: Math.max(r.facts.stageSince, now - (ps.ageHours || 0) * 3600e3), rank: idx, phase: ps.status, phaseLabel: ps.statusLabel, quote: `Petition Studio: ${ps.statusLabel}`, kind: "petition studio" };
        r.facts.effectiveIndex = idx; r.facts.effectiveLabel = r.facts.phaseLabelOf(idx);
        r.facts.behindMs = r.facts.behindFor(idx);
        if (idx >= PROGRAMS.USA.phases.length) r.facts.finished = true;
      }
    }
  }

  // ---- WhatsApp: only for cases where it could clear something
  if (WA.whatsappOn()) {
    const clearable = (r) => (r.attr.buckets.email || 0) + (r.attr.buckets.promise || 0) + (r.attr.buckets.silent_none || 0) + (r.attr.buckets.silent_task || 0) + (r.attr.buckets.silent_far || 0);
    const all = rows.filter((r) => r.c.phone && (r.comms.silences.length || r.comms.obligations.some((o) => (o.type === "email" || o.type === "promise") && (o.verdict === "late" || o.verdict === "missed"))))
      .sort((a, b) => clearable(b) - clearable(a) || b.comms.silences.length - a.comms.silences.length);
    const need = all.slice(0, SETTINGS.WHATSAPP_MAX_CLIENTS);
    log(`WhatsApp: checking ${need.length} of ${all.length} clients in Chatwoot`);
    if (all.length > need.length) warnings.push(`WhatsApp was checked for the ${need.length} clients with the most late days that it could explain; ${all.length - need.length} more were not looked up (WHATSAPP_MAX_CLIENTS in config.js).`);
    for (const r of need) {
      const times = await WA.staffMessages(r.c.phone, r.facts.reviewStart - 7 * DAY);
      if (times && times.length) r.extra = times.map((t, i) => ({ kind: "whatsapp", id: `wa${i}`, at: t, dir: "out", ownerId: "", source: "chatwoot" }));
    }
    if (WA.stats.errors) warnings.push(`Chatwoot could not be read for ${WA.stats.errors} clients; for them, WhatsApp replies were not seen.`);
  } else warnings.push("WhatsApp was not checked (no CHATWOOT_TOKEN), so a client answered only on WhatsApp counts as not answered, and follow-ups made only on WhatsApp do not count.");

  // ---- pass 2: everything
  rows.forEach((r, idx) => {
    r.comms = computeComms(r.c, r.facts, byCase.get(idx), { clock, now, extra: r.extra || [] });
    r.attr = A.attribute(r.facts, r.comms, r.ps, now);
    r.story = A.story(r, { ownerName: g.ownerNames[String(r.c.props.hubspot_owner_id)] });
  });

  // ---- adding it up
  const cmRows = A.byCaseManager(rows, cms, clock, now);
  const stageRows = A.byStage(rows, g.stageLabel);
  const parts = A.commParts(rows);
  const roots = A.rootProblems(rows, cmRows, stageRows, parts, { ownerNames: g.ownerNames });
  const rep = { now, fromMs, clock, cms, programs, rows, cmRows, stageRows, parts, roots, warnings, ai, studio, ps: psByCase,
    wa: WA.stats, waOn: WA.whatsappOn(), bulk: g.bulk, ownerNames: g.ownerNames, stageLabel: g.stageLabel, idealDays: IDEAL_DAYS, hubspotCalls: H.stats.calls, leave: leave.map };

  fs.mkdirSync(SETTINGS.OUT_DIR, { recursive: true });
  if (process.env.DUMP) fs.writeFileSync(path.join(SETTINGS.OUT_DIR, "dump.json"), JSON.stringify(rows.map((r) => ({
    id: r.c.id, client: r.c.client, owner: g.ownerNames[String(r.c.props.hubspot_owner_id)], facts: { ...r.facts, typeAt: undefined, visits: r.facts.visits.map((v) => ({ s: v.label, from: v.from, to: v.to, type: v.info.type, ph: v.info.phaseIndex })) },
    comms: { ...r.comms, obligations: r.comms.obligations.map((o) => ({ type: o.type, verdict: o.verdict, start: o.start, due: o.due, metAt: o.metAt, quote: o.quote })) },
    attr: { buckets: r.attr.buckets, sides: r.attr.sides, lateMs: r.attr.lateMs, inheritedMs: r.attr.inheritedMs, primary: r.attr.primary }, ps: r.ps, story: r.story, extra: (r.extra || []).length,
  })), null, 1));
  const { buildWorkbook } = require("./10-workbook");
  const { buildEmail, sendEmail } = require("./11-email");
  const stamp = dateKey(now);
  const xlsx = path.join(SETTINGS.OUT_DIR, `case-delay-review_${stamp}.xlsx`);
  await (await buildWorkbook(rep)).xlsx.writeFile(xlsx);
  const html = buildEmail(rep);
  fs.writeFileSync(path.join(SETTINGS.OUT_DIR, "email.html"), html);
  log(`\nWrote ${xlsx} and email.html`);

  // a short summary on the run's page
  const live = rows.filter((r) => !r.facts.done && r.facts.status !== "closed");
  const behind = live.filter((r) => r.facts.behindMs > 0);
  const lines = [`## Case delay review, ${fmtDay(now)}`, "", `${rows.length} cases, ${live.length} live, ${behind.length} behind the five-month plan.`, "",
    "| Case manager | Cases | Live | Behind | Comms on time | Follow-up kept up | Top cause on their side |", "|---|---:|---:|---:|---:|---:|---|",
    ...cmRows.map((c) => `| ${c.name} | ${c.cases} | ${c.live} | ${c.behind} | ${c.commPct == null ? "-" : `${c.commPct}%`} | ${c.followUpPct == null ? "-" : `${c.followUpPct}%`} | ${c.topCause || "-"} |`)];
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
  log(lines.slice(2).join("\n"));
  warnings.forEach((w) => log(`!! ${w}`));

  if (String(process.env.SEND_EMAIL || "true").toLowerCase() === "false") { log("Not emailed (send_email is off)."); return; }
  const size = fs.statSync(xlsx).size;
  const attach = size < 30 * 1024 * 1024 ? { filename: path.basename(xlsx), content: fs.readFileSync(xlsx).toString("base64") } : null;
  if (!attach) warnings.push("The workbook was too big to attach; download it from the run's Artifacts.");
  const subject = `Case delay review: ${behind.length} of ${live.length} live cases behind plan, ${fmtDay(now)}`;
  const ok = await sendEmail(subject, attach ? html : buildEmail(rep), attach);
  if (ok) log(`Emailed to ${SETTINGS.REPORT_TO}.`); else { log("!! Not emailed. The workbook is in the run's Artifacts."); process.exitCode = 1; }
}

if (require.main === module) (async () => {
  if (!process.env.HUBSPOT_TOKEN) { console.log("!! No HUBSPOT_TOKEN secret."); process.exit(1); }
  try { MODE === "discover" ? await discover() : await report(); }
  catch (e) { console.error(`\nFAILED: ${e.message}`); if (process.env.DEBUG) console.error(e.stack); process.exit(1); }
})();
module.exports = { chooseCaseManagers, choosePrograms, leaveByOwner };
