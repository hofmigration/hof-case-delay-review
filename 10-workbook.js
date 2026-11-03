// 10-workbook.js — the attached Excel workbook.
//   Summary · By case manager · By deal stage · Why the delay · Communication · Root problems
//   Every finding · Petition Studio · For your judgement · All cases · How it was checked
const ExcelJS = require("exceljs");
const { SETTINGS, PROGRAMS, BUCKETS, IDEAL_DAYS, ROLE_LABEL } = require("./config");
const { xlDate, fmtDay, fmtShort, fmtWhen, fmtDue, days, hrs, plural, daysIn, DAY } = require("./1-clock");
const { LABEL, PART, SUB_LABEL, HOLDER_LABEL, comment, silenceComment, short } = require("./5-comms");
const { BUCKET, SIDE_LABEL } = require("./8-attribute");

const NAVY = "FF0F2D8A", INK = "FF1F2937", SOFT = "FF6B7280", LINE = "FFE5E7EB", PANEL = "FFF3F6FB", WHITE = "FFFFFFFF";
const GOOD = "FFE7F6EE", GOODTX = "FF05603A", WARN = "FFFFF4E5", WARNTX = "FF92400E", BAD = "FFFDECEC", BADTX = "FFB42318", BLUE = "FF1848C8";
const F = "Arial";
const thin = { style: "thin", color: { argb: LINE } };
const BOX = { top: thin, left: thin, bottom: thin, right: thin };
const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const tone = (p) => (p == null ? [PANEL, SOFT] : p >= 80 ? [GOOD, GOODTX] : p >= 60 ? [WARN, WARNTX] : [BAD, BADTX]);

function title(ws, text, sub, width) {
  ws.mergeCells(1, 1, 1, Math.max(2, width));
  const t = ws.getCell(1, 1);
  t.value = text; t.font = { name: F, bold: true, size: 15, color: { argb: WHITE } }; t.fill = fill(NAVY);
  t.alignment = { vertical: "middle", indent: 1 }; ws.getRow(1).height = 30;
  if (sub) {
    ws.mergeCells(2, 1, 2, Math.max(2, width));
    const s = ws.getCell(2, 1);
    s.value = sub; s.font = { name: F, size: 10, color: { argb: SOFT } }; s.alignment = { vertical: "middle", indent: 1, wrapText: true };
    // tall enough for the text across the merged width
    const set = (ws.columns || []).slice(0, Math.max(2, width)).reduce((t, c) => t + ((c && c.width) || 0), 0);
    const chars = Math.max(70, set || Math.max(2, width) * 12);
    ws.getRow(2).height = Math.max(30, 15 * Math.ceil(String(sub).length / chars) + 8);
  }
}
function header(ws, rowNo, labels) {
  const r = ws.getRow(rowNo);
  labels.forEach((l, i) => {
    const c = r.getCell(i + 1);
    c.value = l; c.font = { name: F, bold: true, size: 9.5, color: { argb: WHITE } }; c.fill = fill(NAVY);
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true }; c.border = BOX;
  });
  r.height = 34;
}
const link = (url, text) => (url ? { text: String(text || "open"), hyperlink: url } : String(text || ""));

// a table: cols = [{ h, w, v: (row) => value, t: "text"|"n"|"pct"|"date"|"when"|"link"|"wrap", note }]
function table(ws, startRow, cols, data, { freeze = true } = {}) {
  ws.columns = cols.map((c) => ({ width: c.w || 14 }));
  header(ws, startRow, cols.map((c) => c.h));
  cols.forEach((c, i) => { if (c.note) ws.getRow(startRow).getCell(i + 1).note = c.note; });
  let r = startRow + 1;
  for (const d of data) {
    const row = ws.getRow(r);
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      let v = c.v(d);
      cell.border = BOX;
      cell.font = { name: F, size: 9.5, color: { argb: INK } };
      cell.alignment = { vertical: "top", wrapText: c.t === "wrap" || c.t === "text" };
      if (v == null || v === "") { cell.value = ""; return; }
      if (c.t === "pct") {
        cell.value = v / 100; cell.numFmt = "0%"; cell.alignment = { horizontal: "center", vertical: "top" };
        const [bg, tx] = tone(v); cell.fill = fill(bg); cell.font = { name: F, size: 9.5, bold: true, color: { argb: tx } };
      } else if (c.t === "date") { cell.value = xlDate(v); cell.numFmt = "d mmm yyyy"; cell.alignment = { vertical: "top", horizontal: "center" }; }
      else if (c.t === "when") { cell.value = xlDate(v); cell.numFmt = "d mmm yyyy hh:mm"; cell.alignment = { vertical: "top", horizontal: "center" }; }
      else if (c.t === "link") { cell.value = v; cell.font = { name: F, size: 9.5, color: { argb: BLUE }, underline: true }; }
      else if (c.t === "n") { cell.value = v; cell.alignment = { horizontal: "center", vertical: "top" }; }
      else if (c.t === "bad") { cell.value = v; cell.alignment = { horizontal: "center", vertical: "top" }; if (v > 0) { cell.fill = fill(BAD); cell.font = { name: F, size: 9.5, bold: true, color: { argb: BADTX } }; } }
      else cell.value = v;
      if (c.style) c.style(cell, d);
    });
    r++;
  }
  if (freeze) ws.views = [{ state: "frozen", ySplit: startRow, showGridLines: false }];
  if (data.length) ws.autoFilter = { from: { row: startRow, column: 1 }, to: { row: startRow + data.length, column: cols.length } };
  return r;
}

const verdictStyle = (cell, d) => {
  const v = d.verdict || (d.ok === false ? "missed" : d.ok ? "met" : "");
  if (v === "missed") { cell.fill = fill(BAD); cell.font = { name: F, size: 9.5, bold: true, color: { argb: BADTX } }; }
  else if (v === "late") { cell.fill = fill(WARN); cell.font = { name: F, size: 9.5, bold: true, color: { argb: WARNTX } }; }
};
const behindStyle = (cell, d) => { if ((d.facts ? d.facts.behindMs : 0) > 0) { cell.font = { name: F, size: 9.5, bold: true, color: { argb: BADTX } }; } };

// ---------------------------------------------------------------- Summary
function summarySheet(wb, rep) {
  const ws = wb.addWorksheet("Summary", { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 44 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 50 }];
  const live = rep.rows.filter((r) => !r.facts.done && r.facts.status !== "closed");
  const behind = live.filter((r) => r.facts.behindMs > 0);
  title(ws, `Case delay review · ${fmtDay(rep.now)}`,
    `Every case owned by the ${rep.cms.length} case managers whose owner was assigned since ${fmtDay(rep.fromMs)}: ${rep.rows.length} cases, ${live.length} live. Each case is compared with a five-month (${IDEAL_DAYS}-day) plan, and every late day since the case manager took it over is given one reason.`, 6);
  let row = 4;
  const section = (text) => {
    ws.mergeCells(row, 1, row, 6);
    const c = ws.getCell(row, 1);
    c.value = text.toUpperCase(); c.font = { name: F, bold: true, size: 9.5, color: { argb: BLUE } }; c.fill = fill(PANEL);
    c.alignment = { vertical: "middle", indent: 1 }; ws.getRow(row).height = 20; row++;
  };
  const line = (cells, bold = false) => {
    const r = ws.getRow(row);
    cells.forEach((v, i) => {
      const c = r.getCell(i + 1);
      c.border = BOX; c.font = { name: F, size: 10, bold: bold || i === 0, color: { argb: INK } };
      c.alignment = { vertical: "top", wrapText: true, horizontal: i === 0 || i === 5 ? "left" : "center", indent: i === 0 ? 1 : 0 };
      if (v && typeof v === "object" && "pct" in v) { if (v.pct == null) { c.value = "-"; return; } c.value = v.pct / 100; c.numFmt = "0%"; const [bg, tx] = tone(v.pct); c.fill = fill(bg); c.font = { name: F, size: 10, bold: true, color: { argb: tx } }; }
      else c.value = v == null ? "" : v;
    });
    row++;
  };
  section("Cases by program");
  line(["", "Cases", "Live", "Behind plan", "On schedule", "Median days behind"], true);
  for (const p of [...Object.keys(PROGRAMS), "All"]) {
    const list = p === "All" ? rep.rows : rep.rows.filter((r) => r.facts.program === p);
    const lv = list.filter((r) => !r.facts.done && r.facts.status !== "closed");
    const bh = lv.filter((r) => r.facts.behindMs > 0);
    const med = (() => { const s = bh.map((r) => days(r.facts.behindMs)).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; })();
    line([p === "All" ? "All programs" : PROGRAMS[p].label, list.length, lv.length, bh.length, { pct: lv.length ? Math.round((100 * (lv.length - bh.length)) / lv.length) : null }, med], p === "All");
  }
  row++;
  section("Where the late days come from (since each case manager took the case)");
  line(["Reason", "Late days", "Share", "Cases", "", "Who it sits with"], true);
  const tot = {}, cnt = {};
  for (const r of rep.rows) for (const [k, v] of Object.entries(r.attr.buckets)) if (k !== "paused") { tot[k] = (tot[k] || 0) + v; if (v >= DAY) cnt[k] = (cnt[k] || 0) + 1; }
  const all = Object.values(tot).reduce((s, v) => s + v, 0) || 1;
  for (const b of BUCKETS.filter((x) => x.key !== "paused" && tot[x.key]).sort((x, y) => tot[y.key] - tot[x.key])) line([b.label, days(tot[b.key]), `${Math.round((100 * tot[b.key]) / all)}%`, cnt[b.key] || 0, "", SIDE_LABEL[b.side] || ""]);
  const inh = live.filter((r) => r.facts.inheritedMs >= DAY);
  line(["Already behind when the current case manager took over", days(inh.reduce((s, r) => s + r.facts.inheritedMs, 0)), "", inh.length, "", "Inherited: not counted against anyone in this review"]);
  row++;
  section("Which part of the communication held cases up");
  line(["Part", "Due", "On time", "Late / not done", "On time %", "Late days it explains"], true);
  for (const p of rep.parts) {
    if (p.key === "silence") line([`${p.label} (gaps over the allowance)`, "", "", p.gaps, { pct: null }, `${plural(p.delayDays, "late day")} in ${plural(p.casesDelayed, "case")} (${plural(p.casesFailed, "case")} had a gap). No task set in ${p.noTask}, task due not done in ${p.taskNotDone}, task too far out in ${p.tooFar}`]);
    else if (p.key === "tone") line([p.label, "", "", p.flagged, { pct: null }, p.flagged ? `${plural(p.flagged, "email")} read as unprofessional` : "none flagged"]);
    else if (p.key === "handoff") line([`${p.label} (not scored: comments cannot be read)`, p.due, p.met, p.late + p.missed, { pct: p.pct }, `${p.owedByCm} owed by case managers, ${p.owedByTeam} by colleagues`]);
    else line([p.label, p.due, p.met, p.late + p.missed, { pct: p.pct }, p.delayDays != null ? `${plural(p.delayDays, "day")}, ${plural(p.casesDelayed, "case")}` : ""]);
  }
  row++;
  section("Top root problems (full list in the Root problems tab)");
  rep.roots.slice(0, 6).forEach((x, i) => line([`${i + 1}. ${x.title}`, x.days != null ? plural(x.days, "day") : "", x.cases != null ? plural(x.cases, "case") : "", "", "", x.found]));
  row++;
  section("What the review could and could not see");
  const notes = [
    `HubSpot: ${rep.hubspotCalls} reads. ${rep.bulk} marketing or mailing emails were not counted as follow-ups.`,
    rep.ai.off ? "Reader: off. Call requests come only from clear phrases; promises, complaints, tags and tone were not read." : `Reader: ${rep.ai.requests} requests, ${rep.ai.linesRead} lines read, ${rep.ai.dropped} items dropped because their quote could not be found.`,
    rep.studio && rep.studio.ok ? `Petition Studio: ${[...rep.ps.values()].filter((x) => x.found).length} of ${rep.rows.filter((r) => r.facts.program === "USA").length} USA cases matched.` : `Petition Studio: not checked${rep.studio && rep.studio.why ? ` (${rep.studio.why})` : ""}.`,
    rep.waOn ? `WhatsApp: ${rep.wa.matched} of ${rep.wa.looked} clients found in Chatwoot by phone number.` : "WhatsApp: not checked.",
    ...rep.warnings,
  ];
  for (const n of notes) { ws.mergeCells(row, 1, row, 6); const c = ws.getCell(row, 1); c.value = n; c.font = { name: F, size: 9.5, color: { argb: SOFT } }; c.alignment = { wrapText: true, indent: 1 }; ws.getRow(row).height = 28; row++; }
}

// ---------------------------------------------------------------- By case manager
function cmSheet(wb, rep) {
  const ws = wb.addWorksheet("By case manager");
  title(ws, "By case manager", "Cases since the owner was assigned. Behind plan: the case is not where the five-month plan says it should be by now. Inherited: it was already behind when they took it. Late days are since they took the case, by who they sit with. Communication on time covers email replies, requested calls, promises, tasks and complaints; the call rules are the case manager bot rules after every call day.", 24);
  const cols = [
    { h: "Case manager", w: 22, v: (c) => c.name, t: "text" },
    { h: "Cases", v: (c) => c.cases, t: "n", w: 8 }, { h: "USA", v: (c) => c.usa, t: "n", w: 7 }, { h: "Canada", v: (c) => c.canada, t: "n", w: 8 }, { h: "Australia", v: (c) => c.australia, t: "n", w: 9 },
    { h: "Live", v: (c) => c.live, t: "n", w: 7 }, { h: "Behind plan", v: (c) => c.behind, t: "bad", w: 9 }, { h: "On schedule", v: (c) => c.onSchedulePct, t: "pct", w: 10 },
    { h: "Median days behind", v: (c) => c.medianBehind, t: "n", w: 10 }, { h: "Already behind when taken over", v: (c) => c.inheritedBehind, t: "n", w: 12 },
    { h: "Got later under them (14+ days)", v: (c) => c.madeLater, t: "bad", w: 12 }, { h: "Caught up (14+ days)", v: (c) => c.caughtUp, t: "n", w: 10 },
    { h: "Late days: case manager", v: (c) => c.sides.cm, t: "bad", w: 11 }, { h: "Late days: client", v: (c) => c.sides.client, t: "n", w: 10 },
    { h: "Late days: petition team", v: (c) => c.sides.petition, t: "n", w: 10 }, { h: "Late days: outside body", v: (c) => c.sides.external, t: "n", w: 10 },
    { h: "Late days: stage not updated", v: (c) => c.sides.process, t: "n", w: 10 },
    { h: "Communication on time", v: (c) => c.commPct, t: "pct", w: 12, note: "Email replies, requested calls, promises, tasks and complaints decided in time" },
    { h: "Email replies on time", v: (c) => c.parts.email.pct, t: "pct", w: 10 }, { h: "Calls when asked", v: (c) => c.parts.callreq.pct, t: "pct", w: 10 },
    { h: "Follow-up kept up", v: (c) => c.followUpPct, t: "pct", w: 10, note: "Share of live working days not inside a gap past the follow-up allowance" },
    { h: "After-call rules", v: (c) => c.hygienePct, t: "pct", w: 10, note: "Same-day email, next task, call notes" },
    { h: "Top cause on their side", v: (c) => c.topCause, t: "text", w: 34 },
    { h: "Worst cases (their late days)", v: (c) => c.worst.map((w) => `${w.client}: ${w.days} days, ${w.why}`).join("\n"), t: "wrap", w: 50 },
  ];
  table(ws, 4, cols, rep.cmRows);
}

// ---------------------------------------------------------------- By deal stage
function stageSheet(wb, rep) {
  const ws = wb.addWorksheet("By deal stage");
  title(ws, "By deal stage", "Where the cases are now. Allowance: the phase's share of the five months. Should be at: where the cases behind plan would be by now if nothing had gone wrong. Why: what the late days in this phase are, by reason.", 15);
  const cols = [
    { h: "Program", w: 12, v: (s) => s.program, t: "text" }, { h: "Phase", w: 22, v: (s) => s.phase, t: "text" }, { h: "Stage", w: 30, v: (s) => s.stage, t: "text" },
    { h: "Cases", v: (s) => s.cases, t: "n", w: 8 }, { h: "Live", v: (s) => s.live, t: "n", w: 7 },
    { h: "Phase allowance (days)", v: (s) => s.budgetDays, t: "n", w: 10 }, { h: "Median days in stage", v: (s) => s.medianDaysInStage, t: "n", w: 10 },
    { h: "Over the allowance", v: (s) => s.overBudget, t: "bad", w: 10 }, { h: "Behind plan", v: (s) => s.behind, t: "bad", w: 9 },
    { h: "Median days behind", v: (s) => s.medianBehind, t: "n", w: 10 },
    { h: "Should already be finished", v: (s) => s.shouldBeFinished, t: "n", w: 11 },
    { h: "Where they should be by now", v: (s) => s.shouldBe, t: "wrap", w: 44 },
    { h: "Why the delay here", v: (s) => s.why, t: "wrap", w: 54 },
    { h: "Late days here", v: (s) => s.lateDays, t: "n", w: 10 }, { h: "Stage not updated", v: (s) => s.stale, t: "n", w: 10 },
  ];
  table(ws, 4, cols, rep.stageRows);
}

// ---------------------------------------------------------------- Why the delay
const bucketDays = (r, k) => (r.attr.buckets[k] ? days(r.attr.buckets[k]) : "");
function whySheet(wb, rep) {
  const ws = wb.addWorksheet("Why the delay");
  title(ws, "Why the delay", "Every live case behind plan, most behind first. The reason columns are late days since the case manager took the case; Inherited is late days from before.", 30);
  const data = rep.rows.filter((r) => !r.facts.done && r.facts.status !== "closed" && (r.facts.behindMs > 0 || r.attr.lateMs >= DAY))
    .sort((a, b) => b.facts.behindMs - a.facts.behindMs || b.attr.lateMs - a.attr.lateMs);
  const owner = (r) => rep.ownerNames[String(r.c.props.hubspot_owner_id)] || "";
  const cols = [
    { h: "Client", w: 24, v: (r) => link(r.c.link, r.c.client), t: "link" }, { h: "Case manager", w: 18, v: owner, t: "text" }, { h: "Program", w: 10, v: (r) => r.facts.program, t: "text" },
    { h: "Stage now", w: 26, v: (r) => r.facts.stageLabel, t: "text" }, { h: "In stage since", w: 12, v: (r) => r.facts.stageSince, t: "date" },
    { h: "Days behind plan", w: 10, v: (r) => days(r.facts.behindMs), t: "n", style: behindStyle },
    { h: "Should be at by now", w: 24, v: (r) => r.facts.expectedLabel, t: "text" }, { h: "Plan finish date", w: 12, v: (r) => r.facts.idealFinish, t: "date" },
    { h: "Finish if no more delay", w: 12, v: (r) => r.facts.projectedFinish, t: "date" },
    { h: "Case manager since", w: 12, v: (r) => r.facts.ownerStart, t: "date" }, { h: "Inherited days behind", w: 10, v: (r) => days(r.facts.inheritedMs), t: "n" },
    { h: "Main reason", w: 30, v: (r) => (r.attr.primary ? BUCKET[r.attr.primary].label : ""), t: "text" },
    ...BUCKETS.filter((b) => b.key !== "paused").map((b) => ({ h: b.label, w: 10, v: (r) => bucketDays(r, b.key), t: "n" })),
    { h: "On hold (days)", w: 9, v: (r) => bucketDays(r, "paused"), t: "n" },
    { h: "What happened", w: 90, v: (r) => r.story, t: "wrap" },
  ];
  table(ws, 4, cols, data);
}

// ---------------------------------------------------------------- Communication
function commSheet(wb, rep) {
  const ws = wb.addWorksheet("Communication");
  title(ws, "Which part of the communication", "Every obligation the case created, and whether it was met in time. Late days: the delay it explains (only while the case could be held up by it).", 10);
  let r = table(ws, 4, [
    { h: "Part", w: 34, v: (p) => p.key === "silence" ? `${p.label} (gaps over the allowance)` : p.label, t: "text" }, { h: "Due", w: 9, v: (p) => p.key === "silence" || p.key === "tone" ? null : p.due, t: "n" },
    { h: "On time", w: 9, v: (p) => p.met, t: "n" }, { h: "Late", w: 9, v: (p) => p.late, t: "n" }, { h: "Not done", w: 9, v: (p) => p.key === "silence" ? p.gaps : p.missed, t: "bad" },
    { h: "On time %", w: 10, v: (p) => p.pct, t: "pct" }, { h: "Cases affected", w: 10, v: (p) => p.casesFailed, t: "n" },
    { h: "Typical overrun (working hours)", w: 12, v: (p) => p.medianOverHours, t: "n" },
    { h: "Late days it explains", w: 12, v: (p) => p.delayDays, t: "n" },
    { h: "Notes", w: 60, v: (p) => p.key === "silence" ? `Gaps where: no task was set ${p.noTask}; a task was due and not done ${p.taskNotDone}; the next task was set too far out ${p.tooFar}. Typical gap ${p.medianGapWd ?? "-"} working days.`
      : p.key === "handoff" ? `Not scored: replies left as comments cannot be read. Owed by case managers ${p.owedByCm}, by colleagues ${p.owedByTeam}.`
      : p.key === "tone" ? `${p.flagged} emails flagged as unprofessional.` : "", t: "wrap" },
  ], rep.parts, { freeze: false });
  r += 2;
  const parts = ["email", "callreq", "promise", "task", "complaint", "callemail", "calltask", "calldesc"];
  table(ws, r, [
    { h: "Case manager (on time %)", w: 34, v: (c) => c.name, t: "text" },
    ...parts.map((k) => ({ h: PART[k], w: 11, v: (c) => c.parts[k].pct, t: "pct" })),
    { h: "Follow-up kept up", w: 11, v: (c) => c.followUpPct, t: "pct" },
  ], rep.cmRows, { freeze: false });
}

// ---------------------------------------------------------------- Root problems
function rootSheet(wb, rep) {
  const ws = wb.addWorksheet("Root problems");
  title(ws, "Root problems", "The patterns behind the delays, largest first by the late days they explain.", 7);
  table(ws, 4, [
    { h: "#", w: 5, v: (x) => rep.roots.indexOf(x) + 1, t: "n" }, { h: "Problem", w: 34, v: (x) => x.title, t: "wrap" },
    { h: "Late days", w: 10, v: (x) => x.days, t: "n" }, { h: "Cases", w: 9, v: (x) => x.cases, t: "n" },
    { h: "What we found", w: 70, v: (x) => x.found, t: "wrap" }, { h: "Where / who", w: 48, v: (x) => [x.where && `Where: ${x.where}`, x.who && `Who: ${x.who}`].filter(Boolean).join("\n"), t: "wrap" },
    { h: "What to do", w: 50, v: (x) => x.fix, t: "wrap" },
  ], rep.roots);
}

// ---------------------------------------------------------------- Every finding
function findingsSheet(wb, rep) {
  const ws = wb.addWorksheet("Every finding");
  title(ws, "Every finding", "Each communication obligation that was late or not done, each gap past the follow-up allowance, and each call-day rule missed, with the words and the times.", 10);
  const items = [];
  const owner = (r) => rep.ownerNames[String(r.c.props.hubspot_owner_id)] || "";
  const firstName = (r) => owner(r).split(" ")[0] || "The case manager";
  for (const r of rep.rows) {
    for (const o of r.comms.obligations) if (o.verdict === "late" || o.verdict === "missed")
      items.push({ r, at: o.start, verdict: o.verdict, what: LABEL[o.type][o.verdict], part: PART[o.type], said: o.quote || "", due: o.due, metAt: o.metAt, comment: comment(o, firstName(r), { hrs, fmtDue }), over: Math.round(o.overMs / 3600e3) });
    for (const s of r.comms.silences)
      items.push({ r, gap: true, at: s.from, verdict: "missed", what: `No follow-up for ${Math.ceil(s.gapWd - 0.05)} working days`, part: PART.silence, said: SUB_LABEL[s.sub], due: s.overdueFrom, metAt: s.open ? null : s.to, comment: silenceComment(s, { fmtDay }), over: Math.round((s.gapWd - s.allowWd) * 24) });
    for (const h of r.comms.hygiene) if (!h.ok)
      items.push({ r, at: h.at, verdict: "missed", what: h.type === "callemail" ? "No email to the client on a call day" : h.type === "calltask" ? "No next follow-up task after a call" : "Connected call with no notes", part: PART[h.type], said: "", due: null, metAt: null, comment: h.type === "callemail" ? `${plural(h.calls, "call")} on ${fmtDay(h.at)}, no email reached the client that day.` : h.type === "calltask" ? `Call on ${fmtWhen(h.at)}: no open follow-up task set for after it.` : `Connected call on ${fmtWhen(h.at)} with no description.`, over: null });
    for (const t of r.comms.tone) items.push({ r, at: t.at, verdict: "late", what: `Email tone: ${t.category}`, part: PART.tone, said: t.quote, due: null, metAt: null, comment: `Email to the client on ${fmtWhen(t.at)} reads as ${t.category}.`, over: null });
  }
  items.sort((a, b) => (a.verdict === "missed" ? 0 : 1) - (b.verdict === "missed" ? 0 : 1) || b.at - a.at);
  // approved leave (LEAVE in config.js) that falls between the finding and when it was done or due
  const away = (x) => daysIn(rep.leave && rep.leave.get(String(x.r.c.props.hubspot_owner_id)), x.at, x.gap ? x.metAt || rep.now : x.metAt || x.due || x.at);
  table(ws, 4, [
    { h: "Client", w: 22, v: (x) => link(x.r.c.link, x.r.c.client), t: "link" }, { h: "Case manager", w: 18, v: (x) => owner(x.r), t: "text" },
    { h: "Program", w: 10, v: (x) => x.r.facts.program, t: "text" }, { h: "Part", w: 18, v: (x) => x.part, t: "text" },
    { h: "Finding", w: 30, v: (x) => x.what, t: "text", style: verdictStyle }, { h: "When", w: 15, v: (x) => x.at, t: "when" },
    { h: "Due", w: 15, v: (x) => x.due, t: "when" }, { h: "Done", w: 15, v: (x) => x.metAt, t: "when" },
    { h: "Hours over", w: 9, v: (x) => x.over, t: "n" }, { h: "On leave", w: 9, v: (x) => { const n = away(x); return n ? plural(n, "day") : ""; }, t: "text", note: "Days of the case manager's approved leave (LEAVE in config.js) inside this finding's window. The clock is not paused for leave, because the client keeps waiting; this shows where cover was needed." },
    { h: "The words", w: 50, v: (x) => short(x.said, 300), t: "wrap" }, { h: "What happened", w: 80, v: (x) => x.comment, t: "wrap" },
  ], items.slice(0, 60000));
}

// ---------------------------------------------------------------- Petition Studio
function psSheet(wb, rep) {
  const ws = wb.addWorksheet("Petition Studio");
  const usa = rep.rows.filter((r) => r.facts.program === "USA");
  title(ws, "Petition Studio (USA cases)", rep.studio && rep.studio.ok
    ? "Every USA case checked against Petition Studio: its status there, how long it has been there against the time limit, and who holds it. Matched by client email, then name."
    : `Petition Studio was not checked${rep.studio && rep.studio.why ? ` (${rep.studio.why})` : ""}. The holder below comes from HubSpot's Petition Status and LOR Status.`, 12);
  const owner = (r) => rep.ownerNames[String(r.c.props.hubspot_owner_id)] || "";
  table(ws, 4, [
    { h: "Client", w: 24, v: (r) => link(r.c.link, r.c.client), t: "link" }, { h: "Case manager", w: 18, v: owner, t: "text" },
    { h: "HubSpot stage", w: 26, v: (r) => r.facts.stageLabel, t: "text" }, { h: "Petition Status (HubSpot)", w: 26, v: (r) => r.c.props.petition_status || r.c.props.lor_status || "", t: "text" },
    { h: "Found in Petition Studio", w: 14, v: (r) => r.ps ? (r.ps.found ? `Yes (${r.ps.how})` : r.ps.ambiguous ? `Unsure: ${r.ps.ambiguous.join(" / ")}` : "No") : "", t: "text" },
    { h: "Petition Studio status", w: 22, v: (r) => r.ps && r.ps.found ? link(r.ps.link, r.ps.statusLabel) : "", t: "link" },
    { h: "Business hours in status", w: 11, v: (r) => r.ps && r.ps.found ? r.ps.ageHours : null, t: "n" },
    { h: "Allowed", w: 9, v: (r) => r.ps && r.ps.found ? r.ps.breachHours : null, t: "n" },
    { h: "Held by", w: 20, v: (r) => r.ps && r.ps.found && r.ps.holder ? (r.ps.holder.role ? ROLE_LABEL[r.ps.holder.role] || r.ps.holder.role : r.ps.holder.who) : "", t: "text" },
    { h: "Petition team late days", w: 11, v: (r) => bucketDays(r, "petition"), t: "n" },
    { h: "What Petition Studio shows", w: 70, v: (r) => r.ps && r.ps.found ? [r.ps.holder && r.ps.holder.why, ...r.ps.findings.filter((x) => !r.ps.holder || x.text !== r.ps.holder.why).map((x) => x.text)].filter(Boolean).join("\n") : "", t: "wrap" },
  ], usa.sort((a, b) => (b.attr.buckets.petition || 0) - (a.attr.buckets.petition || 0)));
}

// ---------------------------------------------------------------- For your judgement
function judgementSheet(wb, rep) {
  const ws = wb.addWorksheet("For your judgement");
  title(ws, "For your judgement", "Things the review found but cannot confirm, or that need a person to check. None of these are counted in anyone's figures.", 6);
  const items = [];
  const owner = (r) => rep.ownerNames[String(r.c.props.hubspot_owner_id)] || "";
  for (const r of rep.rows) {
    for (const j of r.comms.judgement) items.push({ r, at: j.event.at, what: j.why, detail: short(j.quote, 200) });
    for (const h of r.comms.handoffs) if (h.verdict === "late" || h.verdict === "missed") items.push({ r, at: h.start, what: `${h.mentionName || "A colleague"} tagged and no reply seen (comments cannot be read)`, detail: short(h.quote, 200) });
    if (r.facts.stale) items.push({ r, at: r.facts.stale.at, what: `Stage looks out of date: HubSpot says ${r.facts.stageLabel}`, detail: `${r.facts.stale.kind === "subject" ? "Email" : r.facts.stale.kind === "note" ? "Note" : "Petition Studio"}: "${short(r.facts.stale.quote, 160)}" (shows ${r.facts.stale.phaseLabel})` });
    if (r.facts.programNote) items.push({ r, at: r.facts.start, what: "Program label to check", detail: r.facts.programNote });
    if (r.ps && r.ps.ambiguous) items.push({ r, at: r.facts.start, what: "More than one Petition Studio case matches", detail: r.ps.ambiguous.join(" / ") });
    if (r.facts.program !== "USA" && r.facts.current.submittedSplit && r.facts.stageSince < rep.now - 365 * DAY) items.push({ r, at: r.facts.stageSince, what: "In the Express Entry / EOI pool for over a year", detail: "A profile or EOI usually lapses after 12 months; check it was renewed." });
    if (r.c.sharedContact) items.push({ r, at: r.facts.start, what: "Client has more than one case in this review", detail: "Only activity logged on this deal was read, so work logged on the client's contact only was not seen." });
  }
  items.sort((a, b) => b.at - a.at);
  table(ws, 4, [
    { h: "Client", w: 24, v: (x) => link(x.r.c.link, x.r.c.client), t: "link" }, { h: "Case manager", w: 18, v: (x) => owner(x.r), t: "text" },
    { h: "When", w: 15, v: (x) => x.at, t: "date" }, { h: "What", w: 44, v: (x) => x.what, t: "wrap" }, { h: "Detail", w: 80, v: (x) => x.detail, t: "wrap" },
  ], items);
}

// ---------------------------------------------------------------- All cases
function allSheet(wb, rep) {
  const ws = wb.addWorksheet("All cases");
  title(ws, "All cases", "Every case in the review.", 26);
  const owner = (r) => rep.ownerNames[String(r.c.props.hubspot_owner_id)] || "";
  table(ws, 4, [
    { h: "Client", w: 24, v: (r) => link(r.c.link, r.c.client), t: "link" }, { h: "Deal", w: 26, v: (r) => r.c.props.dealname, t: "text" },
    { h: "Case manager", w: 18, v: owner, t: "text" }, { h: "Program", w: 10, v: (r) => r.facts.program, t: "text" },
    { h: "Client status", w: 14, v: (r) => r.c.props.client_status, t: "text" }, { h: "Application status", w: 16, v: (r) => r.c.props.application_status, t: "text" },
    { h: "Stage", w: 26, v: (r) => r.facts.stageLabel, t: "text" }, { h: "Phase", w: 20, v: (r) => r.facts.actualLabel, t: "text" },
    { h: "Case started", w: 12, v: (r) => r.facts.start, t: "date" }, { h: "In stage since", w: 12, v: (r) => r.facts.stageSince, t: "date" },
    { h: "Case manager since", w: 12, v: (r) => r.facts.ownerStart, t: "date" },
    { h: "Should be at", w: 22, v: (r) => r.facts.expectedLabel, t: "text" }, { h: "Days behind plan", w: 10, v: (r) => days(r.facts.behindMs), t: "n", style: behindStyle },
    { h: "Inherited days behind", w: 10, v: (r) => days(r.facts.inheritedMs), t: "n" },
    { h: "Late days since taken over", w: 10, v: (r) => days(r.attr.lateMs), t: "n" }, { h: "Main reason", w: 28, v: (r) => (r.attr.primary ? BUCKET[r.attr.primary].label : ""), t: "text" },
    { h: "Client emails needing reply", w: 10, v: (r) => r.comms.stats.emailsNeedingReply, t: "n" },
    { h: "Answered late / not", w: 10, v: (r) => r.comms.obligations.filter((o) => o.type === "email" && (o.verdict === "late" || o.verdict === "missed")).length, t: "bad" },
    { h: "Emails to client", w: 9, v: (r) => r.comms.stats.emailsOut, t: "n" }, { h: "Calls made", w: 8, v: (r) => r.comms.stats.callsOut, t: "n" },
    { h: "Calls connected", w: 9, v: (r) => r.comms.stats.callsConnected, t: "n" }, { h: "WhatsApps", w: 9, v: (r) => r.comms.stats.whatsapp + (r.extra || []).filter((e) => e.at >= r.facts.reviewStart).length, t: "n" },
    { h: "Follow-up gaps", w: 9, v: (r) => r.comms.silences.length, t: "bad" }, { h: "Longest gap (working days)", w: 10, v: (r) => r.comms.stats.longestSilenceWd ? Math.ceil(r.comms.stats.longestSilenceWd - 0.05) : 0, t: "n" },
    { h: "Last client reply", w: 12, v: (r) => r.comms.stats.lastClient, t: "date" }, { h: "Overdue tasks", w: 9, v: (r) => r.comms.stats.overdueTasks, t: "bad" },
  ], rep.rows.slice().sort((a, b) => b.facts.behindMs - a.facts.behindMs));
}

// ---------------------------------------------------------------- How it was checked
function howSheet(wb, rep) {
  const ws = wb.addWorksheet("How it was checked");
  ws.columns = [{ width: 30 }, { width: 110 }];
  title(ws, "How it was checked", "Every rule, in plain words. All of them are set in config.js.", 2);
  const rows = [
    ["Which cases", `Deals in the USA NIW and Canada & AUS service pipelines whose current owner is one of: ${rep.cms.map((c) => c.name).join(", ")}, with the owner assigned on or after ${fmtDay(rep.fromMs)}. Canada and Australia are told apart by the Immigration Program field (the deal name decides when it is empty or holds both).`],
    ["The five-month plan", `If the client sends everything and nothing goes wrong, HOF's part finishes in ${IDEAL_DAYS} days (five months). The days are shared between the phases in proportion to how long each phase takes in real cases today:`],
    ...Object.entries(PROGRAMS).map(([k, P]) => [`  ${P.label}`, `${P.phases.map((ph) => `${ph.label} ${ph.days} days`).join(" · ")} → ${P.finishLabel}. After that: ${Object.keys(P.after).length} stages with an outside body, each with its own allowance where HOF has work to do.`]),
    ["Should be at", "The phase the case would have reached by today under the plan, counting from the day it entered the service pipeline. Time on hold is not counted. Behind plan: the case is still in an earlier phase than that; days behind is how long past the date it should have left its current phase."],
    ["Inherited", "How far behind the case already was on the day the current case manager took it over (from the owner history). Late days before that are shown, never counted against them."],
    ["Who holds the case", "Each stage is marked case manager, client, petition team or outside body (config.js). For USA cases, Petition Status and LOR Status say when the client holds a petition stage (for example 'Review Completed – Sent to Client'), and Petition Studio says which role holds it now and for how long. Client Status Non-Responsive counts as waiting on the client."],
    ["Why a day is late", `A phase is late once it runs past its allowance. Each late day since the case manager took the case gets one reason, the first that applies: ${BUCKETS.map((b) => b.label).join("; ")}. A communication failure only explains a day when it could hold the case up (waiting on the client or the case manager; email, call and promise failures also while with the petition team). While an outside body holds a case, the days are theirs.`],
    ["Email replies", `A client email that asks for something gets a response within ${SETTINGS.EMAIL_REPLY_HOURS} working hours: an email to the client, a call that connected, or a WhatsApp. Thank-yous, automatic replies and documents sent with nothing asked do not need one (the same rules as the daily email-reply report). Several emails in a row are one wait, timed from the first. Working hours: Saturday, Sunday and UAE holidays are not counted.`],
    ["Calls", `A client asking for a call, or ringing unanswered, gets a call the same working day (after ${SETTINGS.CALL_SAME_DAY_CUTOFF_HOUR}:00 Pakistan time, by the end of the next one). A call made counts even if the client did not pick up.`],
    ["Promises", "A promise with a time on it (\"I'll call you tomorrow\") is kept by that time; with no clock time, by the end of that day. Promises with no clear time, or made by someone else, go to For your judgement."],
    ["Tasks", "A case manager's task is done by the end of its due day: ticked by then, or the client contacted by then. Tasks ticked in a bulk clean-up are judged on the contact around them, not the tick."],
    ["Complaints", `A client complaint is recorded in a note within ${SETTINGS.COMPLAINT_NOTE_HOURS} working hours.`],
    ["After every call (case manager bot)", "On every day the case manager made a call: an email reached the client that day (only a wrong number excuses it), a follow-up task was set for after the call, and every connected call says what was discussed."],
    ["Follow-up kept up", `While a case is live, the client hears from HOF (email, call, meeting, WhatsApp, or a follow-up task ticked) at least every ${SETTINGS.FOLLOW_UP_EVERY.client} working days when the case waits on the client, ${SETTINGS.FOLLOW_UP_EVERY.cm} on the case manager's own step, ${SETTINGS.FOLLOW_UP_EVERY.petition} with the petition team and ${SETTINGS.FOLLOW_UP_EVERY.external} with an outside body. Each gap says whether a follow-up task was due and not done, set too far out, or not set at all. The allowance starts afresh when a case manager takes a case over.`],
    ["Tags", `A note that tags someone and asks them to act is answered by a later note, email or call from them within ${SETTINGS.MENTION_REPLY_HOURS} working hours. HubSpot does not let any program read note comments, so these are never scored.`],
    ["Stage not updated", "When a staff email subject (or a note) shows a later step than the deal stage, such as 'Expression of Interest (Australia) Subclass 189' on a case still at document collection, or Petition Studio is two phases ahead of HubSpot, the days after that are 'stage not updated', not a stall."],
    ["Leave", rep.leave && rep.leave.size ? `Approved leave listed in config.js (${[...rep.leave.keys()].map((id) => rep.ownerNames[id] || id).join(", ")}) is marked on every finding it overlaps, in the On leave column of Every finding. The clock is not paused for leave, because the client keeps waiting; the mark shows where cover was needed.` : "No leave was listed in config.js for this run. Add approved leave under LEAVE and the findings it overlaps are marked; the clock is not paused, because the client keeps waiting."],
    ["Marketing", `Emails whose subject is marketing or a greeting, or the same subject sent by one person who is not a case manager to ${SETTINGS.BULK_MIN_CASES}+ cases on one day, are not follow-ups.`],
    ["The reader", rep.ai.off ? "Off for this run." : `Lines that could hold a call request, promise, complaint, tag or unprofessional wording were read by Gemini, most delayed cases first. Every item had to quote its line, checked in code; ${rep.ai.dropped} could not be verified and were dropped. It never decides lateness.`],
    ["WhatsApp", rep.waOn ? "Chatwoot was checked for the team's messages to each client with a gap or an unanswered email. It can only clear someone." : "Not checked in this run."],
    ["Limits", "Calls, emails and WhatsApps not logged in HubSpot (or Chatwoot) cannot be seen. Note comments cannot be read. A client with two cases in the review is read from each deal only."],
  ];
  let r = 4;
  for (const [a, b] of rows) {
    const row = ws.getRow(r);
    row.getCell(1).value = a; row.getCell(1).font = { name: F, bold: true, size: 10, color: { argb: INK } };
    row.getCell(2).value = b; row.getCell(2).font = { name: F, size: 10, color: { argb: INK } };
    row.getCell(1).alignment = { vertical: "top", wrapText: true }; row.getCell(2).alignment = { vertical: "top", wrapText: true };
    row.getCell(1).border = BOX; row.getCell(2).border = BOX;
    row.height = Math.max(18, Math.ceil(String(b).length / 120) * 15);
    r++;
  }
}

async function buildWorkbook(rep) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "HOF Migration compliance";
  wb.created = new Date(rep.now);
  summarySheet(wb, rep);
  cmSheet(wb, rep);
  stageSheet(wb, rep);
  whySheet(wb, rep);
  commSheet(wb, rep);
  rootSheet(wb, rep);
  findingsSheet(wb, rep);
  psSheet(wb, rep);
  judgementSheet(wb, rep);
  allSheet(wb, rep);
  howSheet(wb, rep);
  return wb;
}

module.exports = { buildWorkbook };
