// 11-email.js — the summary email, in the house compliance-report style: navy hero, soft
// rounded numbers, then numbered sections. Tables only and inline styles, so it survives
// Gmail. Every case, finding and figure is in the attached workbook.
const { SETTINGS, PROGRAMS, BUCKETS, IDEAL_DAYS } = require("./config");
const { fmtDay, days, DAY } = require("./1-clock");
const { BUCKET } = require("./8-attribute");

const NUM = "'Century Gothic','Trebuchet MS','Gill Sans',sans-serif";
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";
const C = { navy: "#0f2d8a", deep: "#0a1650", accent: "#1848C8", secNum: "#C7D2E8", track: "#EEF1F5", ink: "#111827", body: "#374151",
  soft: "#6B7280", line: "#E5E7EB", panel: "#F9FAFB", good: "#059669", warn: "#D97706", bad: "#DC2626" };
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const col = (p) => (p == null ? C.soft : p >= 80 ? C.good : p >= 60 ? C.warn : C.bad);
const pctTxt = (p) => (p == null ? "-" : `${Math.round(p)}%`);
const n = (v) => (v == null || v === "" ? "-" : Number(v).toLocaleString("en-US"));
const nn = (v, one, many = `${one}s`) => `${n(v)} ${Number(v) === 1 ? one : many}`;
const every = (wd) => (wd === 5 ? "every week" : wd % 5 === 0 ? `every ${wd / 5} weeks` : `every ${wd} working days`);
const tidy = (s) => String(s).replace(/\s*—\s*/g, ", ").replace(/–(?=\s)/g, "-");
const shortOf = (name) => { const w = String(name || "").split(/\s+/).filter(Boolean); return /^(muhammad|mohammad|mohammed|muhammed|mohd|syed|m\.?)$/i.test(w[0] || "") && w[1] ? `${w[0][0]}. ${w[1]}` : (w.length > 1 ? `${w[0]} ${w[1][0]}.` : w[0] || ""); };

function hero(rep, k) {
  return `<tr><td style="background:${C.navy};background-image:linear-gradient(135deg,#1e40af 0%,#0f2d8a 52%,#0a1f6e 100%);padding:30px 32px 26px">
<div style="font:700 11px/1.4 ${SANS};letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.72)">HOF Migration · Case Compliance</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px"><tr>
<td valign="bottom" style="font:800 40px/1.02 ${SANS};letter-spacing:-0.5px;text-transform:uppercase;color:#ffffff">Case Delay<br><span style="color:rgba(160,200,255,0.9)">Review</span></td>
<td valign="bottom" align="right" style="white-space:nowrap"><div style="font:400 50px/1 ${NUM};color:${k.onPct >= SETTINGS.TARGET_PCT ? "#86efac" : "#fca5a5"}">${pctTxt(k.onPct)}</div>
<div style="font:600 11px/1.6 ${SANS};color:rgba(255,255,255,0.78);margin-top:6px">of live cases on the five-month plan</div></td></tr></table>
<div style="border-top:1px solid rgba(255,255,255,0.22);margin:20px 0 14px"></div>
<span style="display:inline-block;padding:4px 11px;border-radius:999px;background:rgba(255,255,255,0.14);font:600 11.5px/1.5 ${SANS};color:#ffffff">Since ${esc(fmtDay(rep.fromMs))}</span>
<span style="font:500 12px/1.5 ${SANS};color:rgba(255,255,255,0.78);margin-left:8px">${rep.cms.length} case managers · ${rep.programs.map((p) => PROGRAMS[p].label).join(", ")}</span>
</td></tr>`;
}

function strip(k) {
  const cell = (label, value, color, last) => `<td width="25%" align="center" style="padding:16px 6px;${last ? "" : `border-right:1px solid ${C.line};`}">
<div style="font:700 9.5px/1.3 ${SANS};letter-spacing:1px;text-transform:uppercase;color:${C.soft}">${label}</div>
<div style="font:400 28px/1.2 ${NUM};color:${color};margin-top:6px">${value}</div></td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.panel};border:1px solid ${C.line};border-radius:10px;margin:0 0 26px"><tr>
${cell("Cases reviewed", n(k.cases), C.navy)}${cell("Live", n(k.live), C.navy)}${cell("Behind plan", n(k.behind), k.behind ? C.bad : C.good)}${cell("Comms on time", pctTxt(k.commPct), col(k.commPct), true)}
</tr></table>`;
}

function barList(items, foot) {
  const rows = items.map((x) => `
<tr><td style="padding:9px 0 3px;font:600 13px/1.4 ${SANS};color:${C.ink}">${esc(x.label)}<span style="font:400 11.5px ${SANS};color:${C.soft}"> · ${esc(x.sub)}</span></td>
<td align="right" style="padding:9px 0 3px;font:400 17px/1.4 ${NUM};color:${x.color || col(x.pct)}">${x.value != null ? x.value : pctTxt(x.pct)}</td></tr>
<tr><td colspan="2" style="padding:0 0 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.track};border-radius:4px"><tr>
<td width="${Math.max(1, Math.min(100, Math.round(x.pct || 0)))}%" style="background:${x.color || col(x.pct)};height:8px;border-radius:4px;font-size:0;line-height:0">&nbsp;</td><td style="font-size:0;line-height:0">&nbsp;</td></tr></table></td></tr>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>${foot ? `<div style="font:400 11.5px/1.6 ${SANS};color:${C.soft};margin:8px 0 6px">${foot}</div>` : ""}`;
}

function sectionHead(no, label, sub, score) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:34px 0 0"><tr>
<td width="58" valign="middle" style="font:400 40px/1 ${NUM};color:${C.secNum}">${no}</td>
<td valign="middle"><div style="font:800 13px/1.3 ${SANS};letter-spacing:1.2px;text-transform:uppercase;color:${C.ink}">${esc(label)}</div>
<div style="font:400 12px/1.5 ${SANS};color:${C.soft};margin-top:2px">${esc(sub)}</div></td>
${score != null ? `<td align="right" valign="middle" style="font:400 30px/1 ${NUM};color:${col(score)}">${pctTxt(score)}</td>` : ""}</tr></table>
<div style="border-top:1px solid ${C.line};margin:12px 0 14px"></div>`;
}

// heads: [label, align]; rows: [[{ v, color, bold, num }]]
function grid(heads, rows, { firstWidth } = {}) {
  const th = heads.map((h, i) => `<td ${i ? 'align="right"' : ""}${i === 0 && firstWidth ? ` width="${firstWidth}"` : ""} style="padding:7px 5px;font:700 9px/1.3 ${SANS};letter-spacing:.5px;text-transform:uppercase;color:${C.soft};border-bottom:1px solid ${C.line}">${h}</td>`).join("");
  const tr = rows.map((cells, ri) => `<tr${cells.total ? ` style="background:${C.panel}"` : ""}>${cells.map((c, i) => {
    const x = typeof c === "object" && c !== null ? c : { v: c };
    return i === 0
      ? `<td style="padding:7px 5px;font:${x.bold || cells.total ? 700 : 600} 12px/1.35 ${SANS};color:${C.ink};border-bottom:1px solid ${C.line}">${x.html || esc(x.v)}</td>`
      : `<td align="right" style="padding:7px 5px;font:${x.text ? `400 11.5px/1.35 ${SANS}` : `400 13.5px/1.35 ${NUM}`};color:${x.color || C.ink};border-bottom:1px solid ${C.line}">${x.html || esc(x.v)}</td>`;
  }).join("")}</tr>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${th}</tr>${tr}</table>`;
}

function numbered(items) {
  return items.map((it, i) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 13px"><tr>
<td width="42" valign="top"><div style="width:28px;height:28px;border:2px solid ${C.accent};border-radius:50%;text-align:center;font:400 13px/28px ${NUM};color:${C.accent}">${i + 1}</div></td>
<td valign="top"><div style="font:700 13px/1.4 ${SANS};color:${C.ink}">${esc(it.title)}${it.pill ? ` <span style="display:inline-block;margin-left:6px;padding:1px 8px;border-radius:999px;background:#FEE2E2;color:#991B1B;font:600 10.5px/1.6 ${SANS}">${esc(it.pill)}</span>` : ""}</div>
<div style="font:400 12.5px/1.5 ${SANS};color:${C.soft};margin-top:1px">${esc(tidy(it.text))}</div>
${it.fix ? `<div style="font:400 12px/1.5 ${SANS};color:${C.body};margin-top:3px"><b>Do:</b> ${esc(tidy(it.fix))}</div>` : ""}</td></tr></table>`).join("");
}

function kpis(rep) {
  const live = rep.rows.filter((r) => !r.facts.done && r.facts.status !== "closed");
  const behind = live.filter((r) => r.facts.behindMs > 0);
  const due = rep.cmRows.reduce((s, c) => s + c.commDue, 0), met = rep.cmRows.reduce((s, c) => s + c.commMet, 0);
  return { cases: rep.rows.length, live: live.length, behind: behind.length, onPct: live.length ? Math.round((100 * (live.length - behind.length)) / live.length) : null, commPct: due ? Math.round((100 * met) / due) : null };
}

function buildEmail(rep, opts = {}) {
  const k = kpis(rep);
  const maxStages = opts.stages || 10, maxRoots = opts.roots || 7;
  // where the late days come from
  const tot = {}, cases = {};
  for (const r of rep.rows) for (const [b, v] of Object.entries(r.attr.buckets)) if (b !== "paused") { tot[b] = (tot[b] || 0) + v; if (v >= DAY) cases[b] = (cases[b] || 0) + 1; }
  const all = Object.values(tot).reduce((s, v) => s + v, 0) || 1;
  const sideColor = { cm: C.bad, client: C.warn, petition: "#7C3AED", external: C.soft, process: C.accent };
  const reasons = BUCKETS.filter((b) => b.key !== "paused" && tot[b.key] >= DAY).sort((a, b) => tot[b.key] - tot[a.key])
    .map((b) => ({ label: b.label, sub: `${n(cases[b.key] || 0)} case${(cases[b.key] || 0) === 1 ? "" : "s"}`, pct: (100 * tot[b.key]) / all, value: `${n(days(tot[b.key]))} d`, color: sideColor[b.side] }));
  const inherited = days(rep.rows.filter((r) => !r.facts.done && r.facts.status !== "closed").reduce((s, r) => s + r.facts.inheritedMs, 0));

  const programs = rep.programs.map((p) => {
    const lv = rep.rows.filter((r) => r.facts.program === p && !r.facts.done && r.facts.status !== "closed");
    const bh = lv.filter((r) => r.facts.behindMs > 0);
    return { label: PROGRAMS[p].label, sub: `${n(lv.length)} live, ${n(bh.length)} behind`, pct: lv.length ? (100 * (lv.length - bh.length)) / lv.length : null };
  });

  const top = rep.roots[0];
  const intro = `This review covers every case owned by the ${rep.cms.length} case managers whose owner was assigned since ${esc(fmtDay(rep.fromMs))}: ${n(k.cases)} cases, ${n(k.live)} still live. Each case was compared with a five-month plan (${IDEAL_DAYS} days if the client sends everything and nothing goes wrong), and every late day since the case manager took the case was traced to one reason: the client, the petition team, an outside body, the stage not being updated, or a part of the case manager's communication. Full coverage, not a sample: every case is in the attached workbook.`;

  const s01 = sectionHead("01", "Where the delay comes from", `Late days since each case manager took the case, by reason. Live cases were a further ${nn(inherited, "day")} behind in total when they were handed over.`, null)
    + barList(reasons, `Red: the case manager's communication. Amber: the client. Purple: the petition team. Grey: an outside body. Blue: the stage not moved in HubSpot.`);

  const parts = rep.parts.filter((p) => ["email", "callreq", "promise", "silence", "task", "callemail", "calltask", "calldesc"].includes(p.key));
  const s02 = sectionHead("02", "Which part of the communication", "Each obligation the cases created, and the late days it explains", k.commPct)
    + grid(["Part", "Due", "On time", "Late / not", "Late days"], parts.map((p) => p.key === "silence"
      ? [`Follow-up gaps past the allowance (${nn(p.casesFailed, "case")})`, { v: "-" }, { v: "-" }, { v: nn(p.gaps, "gap"), color: p.gaps ? C.bad : C.ink }, { v: n(p.delayDays), color: p.delayDays ? C.bad : C.ink }]
      : [p.label, { v: n(p.due) }, { v: pctTxt(p.pct), color: col(p.pct) }, { v: n(p.late + p.missed), color: p.late + p.missed ? C.bad : C.ink }, { v: p.delayDays == null ? "-" : n(p.delayDays) }]))
    + `<div style="font:400 11.5px/1.6 ${SANS};color:${C.soft};margin:8px 0 0">Follow-up kept up: gaps with no email, call or WhatsApp past the allowance (${every(SETTINGS.FOLLOW_UP_EVERY.client)} while waiting on the client, ${every(SETTINGS.FOLLOW_UP_EVERY.cm)} on the case manager's own step). The last three rows are the case manager bot rules after every call day. Tags between colleagues are in the workbook, not scored, because note comments cannot be read.</div>`;

  const cmRows = rep.cmRows.slice().sort((a, b) => b.sides.cm - a.sides.cm);
  const s03 = sectionHead("03", "By case manager", "Cases, how many are behind plan, and the late days on their side since they took them", null)
    + grid(["", "Cases", "Behind", "Inherited", "Their days", "Comms", "Follow-up"], cmRows.map((c) => [
      { v: shortOf(c.name) }, { v: n(c.cases) }, { v: n(c.behind), color: c.behind ? C.bad : C.ink }, { v: n(c.inheritedBehind) },
      { v: n(c.sides.cm), color: c.sides.cm ? C.bad : C.ink }, { v: pctTxt(c.commPct), color: col(c.commPct) }, { v: pctTxt(c.followUpPct), color: col(c.followUpPct) }]))
    + `<div style="font:400 11.5px/1.6 ${SANS};color:${C.soft};margin:8px 0 0">Behind = live cases not where the plan says. Inherited = already behind when they took them over. Their days = late days explained by their communication. Comms = email replies, requested calls, promises, tasks and complaints met in time. Follow-up = share of live working days without a gap past the allowance.</div>`
    + numbered(cmRows.filter((c) => c.topCause).slice(0, 3).map((c) => ({ title: c.name, pill: nn(c.sides.cm, "day"), text: `Top cause: ${c.topCause}.${c.worst.length ? ` Worst: ${c.worst.map((w) => `${w.client} (${nn(w.days, "day")})`).join(", ")}.` : ""}` })));

  const stages = rep.stageRows.filter((s) => s.lateDays > 0 || s.behind > 0).sort((a, b) => b.lateDays - a.lateDays || b.behind - a.behind).slice(0, maxStages);
  const s04 = sectionHead("04", "By deal stage", "Where the late cases sit, where they should be by now, and why", null)
    + grid(["Stage", "Cases", "Behind", "Should be at", "Main reason"], stages.map((s) => [
      { html: `${esc(s.stage)}<br><span style="font:400 10.5px ${SANS};color:${C.soft}">${esc(s.programLabel)} · allowance ${n(s.budgetDays)} days · median ${n(s.medianDaysInStage == null ? null : Math.round(s.medianDaysInStage))} days in stage</span>` },
      { v: n(s.cases) }, { v: n(s.behind), color: s.behind ? C.bad : C.ink },
      { v: s.shouldBeFinished ? `${n(s.shouldBeFinished)} past finish` : (s.shouldBe.split(";")[0] || "-"), text: true },
      { v: s.whyTop || "-", text: true }]), { firstWidth: "34%" });

  const s05 = sectionHead("05", "Root problems", "The patterns behind the delays, largest first", null)
    + numbered(rep.roots.slice(0, maxRoots).map((x) => ({ title: x.title, pill: x.days ? nn(x.days, "day") : x.cases ? nn(x.cases, "case") : "", text: x.found, fix: x.fix })));

  const good = [];
  const best = rep.cmRows.filter((c) => c.commPct != null && c.commDue >= 20).sort((a, b) => b.commPct - a.commPct)[0];
  if (best && best.commPct >= 80) good.push(`${best.name} met ${best.commPct}% of ${n(best.commDue)} communication obligations on time.`);
  const caught = rep.cmRows.reduce((s, c) => s + c.caughtUp, 0);
  if (caught) good.push(caught === 1 ? "1 case that was handed over late has since caught up by two weeks or more." : `${n(caught)} cases that were handed over late have since caught up by two weeks or more.`);
  const onTime = rep.stageRows.filter((s) => s.live >= 5 && !s.behind);
  if (onTime.length) good.push(`No case is behind plan at ${onTime.slice(0, 3).map((s) => s.stage).join(", ")}.`);

  const warn = (rep.warnings || []).length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px"><tr><td style="background:#FFFBEB;border-left:4px solid ${C.warn};padding:11px 14px;font:400 12px/1.55 ${SANS};color:#92400E">${rep.warnings.slice(0, opts.warnings || 8).map(esc).join("<br>")}</td></tr></table>` : "";

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Case delay review</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f3f4f6" style="background:#f3f4f6;"><tr><td align="center" bgcolor="#f3f4f6" style="background:#f3f4f6;padding:28px 12px 48px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:640px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ${C.line}">
${hero(rep, k)}
<tr><td style="padding:28px 32px 10px">
${warn}
<p style="margin:0 0 18px;font:400 14px/1.65 ${SANS};color:${C.body}">${intro}</p>
${top ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px"><tr><td style="background:#FEF2F2;border:1px solid #FECACA;border-left:4px solid ${C.bad};border-radius:8px;padding:13px 16px">
<div style="font:700 10px/1.4 ${SANS};letter-spacing:1px;text-transform:uppercase;color:#991B1B">Top finding: ${esc(top.title)}</div>
<div style="font:600 13.5px/1.55 ${SANS};color:${C.ink};margin-top:3px">${esc(tidy(top.found))}</div></td></tr></table>` : ""}
${strip(k)}
<div style="font:800 12px/1.4 ${SANS};letter-spacing:1.2px;text-transform:uppercase;color:${C.ink};margin:0 0 4px">On schedule, by program</div>
${barList(programs.map((p) => ({ ...p })), `Share of live cases at or ahead of where the five-month plan says they should be.`)}
${s01}${s02}${s03}${s04}${s05}
${good.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:30px 0 8px"><tr><td style="background:#F0FDF4;border:1px solid #D1FAE5;border-radius:10px;padding:15px 18px">
<div style="font:800 12px/1.4 ${SANS};letter-spacing:1.2px;text-transform:uppercase;color:#065F46;margin-bottom:6px">Done well</div>
${good.map((p) => `<div style="font:400 13px/1.6 ${SANS};color:#065F46">✓ ${esc(p)}</div>`).join("")}</td></tr></table>` : ""}
<p style="margin:22px 0 26px;font:400 12.5px/1.6 ${SANS};color:${C.soft}">The attached workbook has every case manager and every stage side by side, every delayed case with where it should be and what happened, each communication part, every finding with the client's words and the times, the Petition Studio check of each USA case, the items left for your judgement, and how every rule was applied.</p>
</td></tr>
<tr><td style="background:${C.deep};padding:20px 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font:400 12px/1.6 ${SANS};color:rgba(255,255,255,0.85)"><b style="color:#ffffff">Ali Raza</b><br>Compliance Lead, HOF Migration</td>
<td align="right" style="font:400 12px/1.6 ${SANS};color:rgba(255,255,255,0.7)">HOF Migration<br>Case Delay Review<br><span style="font-family:${NUM};color:#ffffff">${esc(fmtDay(rep.now))}</span></td></tr></table></td></tr>
</table></td></tr></table></body></html>`;
}

function fitEmail(rep) {
  let html = buildEmail(rep);
  for (const o of [{ stages: 8, roots: 6 }, { stages: 6, roots: 5, warnings: 4 }, { stages: 4, roots: 4, warnings: 2 }])
    if (Buffer.byteLength(html, "utf8") > SETTINGS.EMAIL_MAX_BYTES) html = buildEmail(rep, o);
  return html;
}

async function sendEmail(subject, html, attachment) {
  if (!process.env.RESEND_KEY) { console.log("No RESEND_KEY secret, so the email was not sent."); return false; }
  const body = { from: SETTINGS.FROM_EMAIL, to: [SETTINGS.REPORT_TO], subject, html, attachments: attachment ? [attachment] : undefined };
  if (SETTINGS.CC.length) body.cc = SETTINGS.CC;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.log(`Email failed: ${res.status} ${(await res.text()).slice(0, 250)}`);
    if (res.status === 403) console.log("  The built-in sender (onboarding@resend.dev) only reaches the address the Resend account belongs to; CC needs a verified domain.");
    return false;
  }
  return true;
}

module.exports = { buildEmail: fitEmail, buildEmailRaw: buildEmail, sendEmail, shortOf };
