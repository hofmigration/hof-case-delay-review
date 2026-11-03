// 8-attribute.js — why each case is late, and what that adds up to.
//
// A phase is late once it runs past its share of the five months. Every late day since the
// current case manager took the case is given one reason (see BUCKETS in config.js): on
// hold, stage not updated, a client email waiting, a requested call not made, a promise not
// kept, follow-up lapsed, the petition team, the client, an outside body, or the case
// manager's own step not moving. A communication failure only explains a day when it could
// hold the case up: while the case waits on an outside body, those days are the outside
// body's. Late days from before the case manager took over are counted as inherited.
const { SETTINGS, BUCKETS, CAN_DELAY, PROGRAMS, ROLE_LABEL } = require("./config");
const { DAY, fmtDay, fmtShort, days, plural, num, dayStart, dateKey } = require("./1-clock");
const were = (k) => (k === 1 ? "was" : "were");
const { LABEL, PART, SUB_LABEL, HOLDER_LABEL, short } = require("./5-comms");

const BUCKET = Object.fromEntries(BUCKETS.map((b, i) => [b.key, { ...b, rank: i }]));
const FAILS = ["email", "callreq", "promise", "silent_task", "silent_far", "silent_none"];
const SIDE_LABEL = { cm: "Case manager", client: "Client", petition: "Petition team", external: "Outside body", process: "Stage not updated" };

// ---------------------------------------------------------------- one case
function attribute(f, comms, ps, now) {
  const fails = [];
  for (const o of comms.obligations) if ((o.verdict === "late" || o.verdict === "missed") && ["email", "callreq", "promise"].includes(o.type))
    fails.push({ key: o.type, from: o.overFrom, to: o.overTo, ref: o });
  for (const s of comms.silences) fails.push({ key: s.sub, from: s.overdueFrom, to: s.to, ref: s });
  const psL = ps && ps.found && ps.holder && ps.holder.since && !ps.holder.within && ["petition", "cm", "client"].includes(ps.holder.who)
    ? { key: ps.holder.who === "cm" ? "ps_cm" : ps.holder.who, from: Math.max(ps.holder.since, f.stageSince), to: now, why: ps.holder.why } : null;
  const staleFrom = f.stale ? f.stale.at : null;

  const bucketAt = (t, current) => {
    if (f.paused.some((p) => p.from <= t && t < p.to)) return "paused";
    if (staleFrom != null && current && t >= staleFrom) return "stale";
    const ps2 = current && psL && psL.from <= t ? psL : null;
    const type = ps2 ? { petition: "petition", client: "client", ps_cm: "cm" }[ps2.key] : f.typeAt(t);
    if (type === "done") return null;
    if (type === "external") return "external";
    const allowed = CAN_DELAY[type] || [];
    const active = fails.filter((x) => allowed.includes(x.key) && x.from <= t && t < x.to).sort((a, b) => BUCKET[a.key].rank - BUCKET[b.key].rank);
    if (type === "petition") return ps2 && ps2.key === "petition" ? "petition" : active.length ? active[0].key : "petition";
    if (active.length) return active[0].key;
    if (type === "client") return "client";
    return ps2 && ps2.key === "ps_cm" ? "ps_cm" : "cm_work";
  };

  const buckets = {}, evidence = {};
  let inheritedMs = 0, lateMs = 0;
  const windows = [];
  for (const pv of f.phaseVisits) {
    if (pv.excessFrom == null || !(pv.to > pv.excessFrom)) continue;
    // late days before the case manager's period were inherited
    if (pv.excessFrom < f.reviewStart) inheritedMs += Math.min(pv.to, f.reviewStart) - pv.excessFrom - pausedWithin(f.paused, pv.excessFrom, Math.min(pv.to, f.reviewStart));
    const a = Math.max(pv.excessFrom, f.reviewStart), b = pv.to;
    if (!(b > a)) continue;
    windows.push({ pv, from: a, to: b });
    const cuts = new Set([a, b]);
    for (const x of [...fails, ...f.paused, ...(psL ? [psL] : []), ...(staleFrom ? [{ from: staleFrom, to: now }] : [])]) {
      if (x.from > a && x.from < b) cuts.add(x.from);
      if (x.to > a && x.to < b) cuts.add(x.to);
    }
    // changes of stage and holder inside the window
    for (const v of f.visits) { if (v.from > a && v.from < b) cuts.add(v.from); }
    for (const h of [...f.holder, ...f.appClient, ...f.unresponsive]) { if (h.from > a && h.from < b) cuts.add(h.from); if (h.to > a && h.to < b) cuts.add(h.to); }
    const pts = [...cuts].sort((x, y) => x - y);
    for (let i = 0; i + 1 < pts.length; i++) {
      const s = pts[i], e = pts[i + 1];
      const k = bucketAt(s + (e - s) / 2, pv.current);
      if (!k) continue;
      buckets[k] = (buckets[k] || 0) + (e - s);
      if (k !== "paused") lateMs += e - s;
      const ref = FAILS.includes(k) ? fails.find((x) => x.key === k && x.from <= s && s < x.to) : null;
      if (ref && !(evidence[k] || []).includes(ref.ref)) (evidence[k] = evidence[k] || []).push(ref.ref);
    }
  }
  const sides = { cm: 0, client: 0, petition: 0, external: 0, process: 0 };
  for (const [k, v] of Object.entries(buckets)) { const sd = BUCKET[k].side; if (sides[sd] != null) sides[sd] += v; }
  const ranked = Object.entries(buckets).filter(([k]) => k !== "paused").sort((x, y) => y[1] - x[1]);
  return { buckets, sides, lateMs, inheritedMs, primary: ranked.length ? ranked[0][0] : null, evidence, windows, psLabel: psL };
}
function pausedWithin(paused, a, b) {
  let t = 0;
  for (const p of paused) { const s = Math.max(a, p.from), e = Math.min(b, p.to); if (e > s) t += e - s; }
  return t;
}

// ---------------------------------------------------------------- the case, in words
function story(r, { ownerName }) {
  const f = r.facts, cm = r.comms, a = r.attr, st = cm.stats;
  const first = String(ownerName || "").split(" ")[0] || "the case manager";
  const parts = [];
  const where = f.stale && f.effectiveIndex !== f.actualIndex
    ? `HubSpot shows ${f.stageLabel} since ${fmtShort(f.stageSince)}, but by ${fmtShort(f.stale.at)} it had reached ${f.effectiveLabel}`
    : `it has been at ${f.stageLabel} since ${fmtShort(f.stageSince)}`;
  if (f.done) parts.push(`Finished (${f.stageLabel}).`);
  else if (f.finished && f.stale && f.effectiveIndex !== f.actualIndex) parts.push(`HOF's part looks finished: HubSpot still shows ${f.stageLabel} (since ${fmtShort(f.stageSince)}), but by ${fmtShort(f.stale.at)} the case had reached ${f.effectiveLabel}.`);
  else if (f.finished) parts.push(`HOF's part is finished (${f.stageLabel}).`);
  else if (f.behindMs > 0) parts.push(`${plural(days(f.behindMs), "day")} behind the five-month plan. It should be at ${f.expectedLabel} by now; ${where}.`);
  else parts.push(`On schedule: ${where}.`);
  if (f.inheritedMs > DAY) parts.push(`It was already ${plural(days(f.inheritedMs), "day")} behind when ${first} took it over on ${fmtShort(f.ownerStart)}.`);
  const reasons = Object.entries(a.buckets).filter(([k, v]) => k !== "paused" && v >= DAY).sort((x, y) => y[1] - x[1]).slice(0, 3)
    .map(([k, v]) => `${plural(days(v), "day")} ${BUCKET[k].label.charAt(0).toLowerCase() + BUCKET[k].label.slice(1)}`);
  if (reasons.length) parts.push(`Late days since ${fmtShort(f.reviewStart)}: ${reasons.join("; ")}.`);
  if (f.stale) parts.push(`The stage was not updated: on ${fmtShort(f.stale.at)} ${f.stale.kind === "subject" ? `the email "${short(f.stale.quote, 80)}" went to the client` : f.stale.kind === "petition studio" ? `Petition Studio already showed ${f.stale.phaseLabel}` : `a note said "${short(f.stale.quote, 80)}"`}.`);
  const bad = cm.obligations.filter((o) => o.verdict === "late" || o.verdict === "missed");
  if (bad.length) {
    const by = {};
    for (const o of bad) { const l = LABEL[o.type][o.verdict]; by[l] = (by[l] || 0) + 1; }
    parts.push(Object.entries(by).map(([l, n]) => `${n}× ${l.charAt(0).toLowerCase() + l.slice(1)}`).join(", ") + ".");
  }
  const longest = cm.silences.slice().sort((x, y) => y.gapWd - x.gapWd)[0];
  if (longest && longest.gapWd >= 1) parts.push(`Longest stretch with no contact: ${Math.ceil(longest.gapWd - 0.05)} working days from ${fmtShort(longest.from)} (${SUB_LABEL[longest.sub]}).`);
  if (st.clientSilentWd != null && st.clientSilentWd >= 20 && !f.finished) parts.push(`The client last responded ${fmtShort(st.lastClient)}; ${plural(st.followUpsSinceClient, "follow-up")} since.`);
  else if (st.lastClient == null && st.touches > 3 && !f.finished) parts.push(`No reply from the client logged since ${fmtShort(f.reviewStart)}, despite ${plural(st.touches, "follow-up")}.`);
  if (r.ps && r.ps.found) parts.push(`Petition Studio: ${r.ps.statusLabel}${r.ps.ageHours != null ? `, ${r.ps.ageHours} business hours` : ""}${r.ps.holder ? `. ${r.ps.holder.why}` : ""}.`);
  return parts.join(" ").replace(/\.\./g, ".");
}

// ---------------------------------------------------------------- adding it up
const median = (xs) => { const s = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a, b) => (b ? Math.round((100 * a) / b) : null);
const SCORED = ["email", "callreq", "promise", "task", "complaint"];
const HYGIENE = ["callemail", "calltask", "calldesc"];

function tallyComms(rows) {
  const t = {};
  const bump = (k, v) => { t[k] = t[k] || { due: 0, met: 0, late: 0, missed: 0, cases: new Set(), waits: [] }; t[k].due++; t[k][v]++; };
  for (const r of rows) {
    for (const o of r.comms.obligations) if (o.verdict !== "pending") { bump(o.type, o.verdict); if (o.verdict !== "met") { t[o.type].cases.add(r.c.id); t[o.type].waits.push(o.overMs); } }
    for (const h of r.comms.hygiene) { bump(h.type, h.ok ? "met" : "missed"); if (!h.ok) t[h.type].cases.add(r.c.id); }
  }
  return t;
}

function byCaseManager(rows, cms, clock, now) {
  return cms.map((cm) => {
    const mine = rows.filter((r) => String(r.c.props.hubspot_owner_id) === cm.ownerId);
    const live = mine.filter((r) => !r.facts.done && r.facts.status !== "closed");
    const behind = live.filter((r) => r.facts.behindMs > 0);
    const t = tallyComms(mine);
    const sum = (ks) => ks.reduce((s, k) => s + (t[k] ? t[k].met : 0), 0), dueOf = (ks) => ks.reduce((s, k) => s + (t[k] ? t[k].due : 0), 0);
    const sides = { cm: 0, client: 0, petition: 0, external: 0, process: 0 }, buckets = {};
    for (const r of mine) { for (const [k, v] of Object.entries(r.attr.sides)) sides[k] += v; for (const [k, v] of Object.entries(r.attr.buckets)) buckets[k] = (buckets[k] || 0) + v; }
    // follow-up kept up: live working days without an over-allowance gap
    let liveWd = 0, silentWd = 0;
    for (const r of live) {
      liveWd += Math.max(0, clock.workingDaysBetween(r.facts.reviewStart, now) - r.facts.paused.reduce((s, p) => s + clock.workingDaysBetween(Math.max(p.from, r.facts.reviewStart), Math.min(p.to, now)), 0));
      for (const s of r.comms.silences) silentWd += clock.workingDaysBetween(s.overdueFrom, s.to);
    }
    const cmBuckets = Object.entries(buckets).filter(([k]) => BUCKET[k].side === "cm").sort((a, b) => b[1] - a[1]);
    const worst = mine.slice().sort((a, b) => b.attr.sides.cm - a.attr.sides.cm).filter((r) => r.attr.sides.cm >= DAY).slice(0, 3);
    return {
      name: cm.name, ownerId: cm.ownerId, cases: mine.length, live: live.length,
      usa: mine.filter((r) => r.facts.program === "USA").length, canada: mine.filter((r) => r.facts.program === "Canada").length, australia: mine.filter((r) => r.facts.program === "Australia").length,
      onSchedule: live.length - behind.length, behind: behind.length, onSchedulePct: pct(live.length - behind.length, live.length),
      medianBehind: behind.length ? Math.round(median(behind.map((r) => days(r.facts.behindMs)))) : null,
      inheritedBehind: live.filter((r) => r.facts.inheritedMs > 7 * DAY).length,
      madeLater: live.filter((r) => r.facts.behindMs - r.facts.inheritedMs > 14 * DAY).length,
      caughtUp: live.filter((r) => r.facts.inheritedMs - r.facts.behindMs > 14 * DAY).length,
      lateDays: days(Object.entries(buckets).filter(([k]) => k !== "paused").reduce((s, [, v]) => s + v, 0)),
      sides: Object.fromEntries(Object.entries(sides).map(([k, v]) => [k, days(v)])),
      inheritedDays: days(mine.reduce((s, r) => s + r.attr.inheritedMs, 0)),
      commDue: dueOf(SCORED), commMet: sum(SCORED), commPct: pct(sum(SCORED), dueOf(SCORED)),
      hygieneDue: dueOf(HYGIENE), hygieneMet: sum(HYGIENE), hygienePct: pct(sum(HYGIENE), dueOf(HYGIENE)),
      parts: Object.fromEntries([...SCORED, ...HYGIENE].map((k) => [k, t[k] ? { due: t[k].due, met: t[k].met, late: t[k].late, missed: t[k].missed, pct: pct(t[k].met, t[k].due) } : { due: 0, met: 0, late: 0, missed: 0, pct: null }])),
      silences: mine.reduce((s, r) => s + r.comms.silences.length, 0), followUpPct: liveWd ? Math.max(0, Math.round(100 * (1 - silentWd / liveWd))) : null,
      topCause: cmBuckets.length && cmBuckets[0][1] >= DAY ? `${BUCKET[cmBuckets[0][0]].label} (${plural(days(cmBuckets[0][1]), "day")})` : "",
      worst: worst.map((r) => ({ client: r.c.client, link: r.c.link, days: days(r.attr.sides.cm), why: r.attr.primary ? BUCKET[r.attr.primary].label : "" })),
      stale: mine.filter((r) => r.facts.stale).length,
    };
  }).filter((x) => x.cases);
}

function byStage(rows, stageLabel) {
  const groups = new Map();
  for (const r of rows) {
    if (r.facts.status === "closed" && !r.facts.done) continue;
    const k = `${r.facts.program}|${r.facts.stageId}${r.facts.current.submittedSplit ? "|in pool" : ""}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const order = (r) => Object.keys(PROGRAMS).indexOf(r.facts.program) * 1e6 + (r.facts.actualIndex == null ? 99e4 : r.facts.actualIndex * 1e4) + (r.facts.current.order || 0);
  return [...groups.values()].map((list) => {
    const f0 = list[0].facts;
    const live = list.filter((r) => r.facts.status === "live" || r.facts.status === "unresponsive");
    const behind = list.filter((r) => r.facts.behindMs > 0);
    const expect = {};
    for (const r of behind) expect[r.facts.expectedLabel] = (expect[r.facts.expectedLabel] || 0) + 1;
    // the late days of the phase each case is in now
    const buckets = {};
    for (const r of list) {
      const cur = r.attr.windows.filter((w) => w.pv.current);
      if (!cur.length) continue;
      // share the case's buckets in proportion to the current window (it is almost always the only one)
      const all = r.attr.windows.reduce((s, w) => s + (w.to - w.from), 0) || 1;
      const share = cur.reduce((s, w) => s + (w.to - w.from), 0) / all;
      for (const [k, v] of Object.entries(r.attr.buckets)) if (k !== "paused") buckets[k] = (buckets[k] || 0) + v * share;
    }
    const why = Object.entries(buckets).sort((a, b) => b[1] - a[1]).filter(([, v]) => v >= DAY);
    const totalWhy = why.reduce((s, [, v]) => s + v, 0);
    return {
      program: f0.program, programLabel: f0.programLabel, stageId: f0.stageId, stage: f0.stageLabel + (f0.current.submittedSplit ? " (submitted, in the pool)" : ""),
      phase: f0.actualLabel, budgetDays: f0.phaseBudgetDays, order: order(list[0]),
      cases: list.length, live: live.length,
      medianDaysInStage: Math.round(median(list.map((r) => days(r.facts.current.to - r.facts.stageSince))) || 0),
      overBudget: list.filter((r) => r.facts.phaseBudgetDays != null && r.facts.activeInPhaseMs > r.facts.phaseBudgetDays * DAY).length,
      behind: behind.length, medianBehind: median(behind.map((r) => days(r.facts.behindMs))),
      shouldBe: Object.entries(expect).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l}: ${n}`).join("; "),
      shouldBeFinished: behind.filter((r) => /^Finished/.test(r.facts.expectedLabel)).length,
      why: why.slice(0, 4).map(([k, v]) => `${BUCKET[k].label} ${pct(v, totalWhy)}%`).join("; "),
      whyTop: why.length ? BUCKET[why[0][0]].label : "",
      lateDays: days(totalWhy),
      stale: list.filter((r) => r.facts.stale).length,
    };
  }).sort((a, b) => a.order - b.order);
}

function commParts(rows) {
  const t = tallyComms(rows);
  const daysOf = (keys) => days(rows.reduce((s, r) => s + keys.reduce((x, k) => x + (r.attr.buckets[k] || 0), 0), 0));
  const casesWith = (keys) => rows.filter((r) => keys.some((k) => (r.attr.buckets[k] || 0) >= DAY)).length;
  const line = (key, label, bucketKeys, scored = true) => {
    const x = t[key] || { due: 0, met: 0, late: 0, missed: 0, cases: new Set(), waits: [] };
    return { key, label, scored, due: x.due, met: x.met, late: x.late, missed: x.missed, pct: pct(x.met, x.due), casesFailed: x.cases.size,
      medianOverHours: median(x.waits.map((w) => Math.round(w / 3600e3))), delayDays: bucketKeys ? daysOf(bucketKeys) : null, casesDelayed: bucketKeys ? casesWith(bucketKeys) : null };
  };
  const sil = rows.flatMap((r) => r.comms.silences.map((s) => ({ s, r })));
  const silBy = (sub) => sil.filter((x) => x.s.sub === sub).length;
  const hand = rows.flatMap((r) => r.comms.handoffs).filter((h) => h.verdict !== "pending");
  const tone = rows.flatMap((r) => r.comms.tone);
  return [
    line("email", PART.email, ["email"]),
    line("callreq", PART.callreq, ["callreq"]),
    line("promise", PART.promise, ["promise"]),
    { key: "silence", label: PART.silence, scored: false, due: null, gaps: sil.length, casesFailed: new Set(sil.map((x) => x.r.c.id)).size,
      noTask: silBy("silent_none"), taskNotDone: silBy("silent_task"), tooFar: silBy("silent_far"),
      medianGapWd: median(sil.map((x) => Math.round(x.s.gapWd))), delayDays: daysOf(["silent_task", "silent_far", "silent_none"]), casesDelayed: casesWith(["silent_task", "silent_far", "silent_none"]) },
    line("task", PART.task, null),
    line("complaint", PART.complaint, null),
    line("callemail", PART.callemail, null),
    line("calltask", PART.calltask, null),
    line("calldesc", PART.calldesc, null),
    { key: "handoff", label: PART.handoff, scored: false, due: hand.length, met: hand.filter((h) => h.verdict === "met").length, late: hand.filter((h) => h.verdict === "late").length,
      missed: hand.filter((h) => h.verdict === "missed").length, pct: pct(hand.filter((h) => h.verdict === "met").length, hand.length),
      owedByCm: hand.filter((h) => h.verdict !== "met" && h.owes === "cm").length, owedByTeam: hand.filter((h) => h.verdict !== "met" && h.owes === "team").length },
    { key: "tone", label: PART.tone, scored: false, flagged: tone.length, casesFailed: new Set(rows.filter((r) => r.comms.tone.length).map((r) => r.c.id)).size },
  ];
}

// ---------------------------------------------------------------- root problems
function rootProblems(rows, cmRows, stageRows, parts, ctx) {
  const out = [];
  const dayOf = (keys, list = rows) => days(list.reduce((s, r) => s + keys.reduce((x, k) => x + (r.attr.buckets[k] || 0), 0), 0));
  const casesOf = (keys, list = rows) => list.filter((r) => keys.some((k) => (r.attr.buckets[k] || 0) >= DAY));
  const topBy = (list, keyFn, n = 3) => {
    const m = new Map();
    for (const r of list) { const k = keyFn(r); m.set(k, (m.get(k) || 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  };
  const owner = (r) => ctx.ownerNames[String(r.c.props.hubspot_owner_id)] || "?";
  const stageOf = (r) => `${r.facts.stageLabel} (${r.facts.program})`;
  const live = rows.filter((r) => !r.facts.done && r.facts.status !== "closed");
  const allLate = dayOf(BUCKETS.filter((b) => b.key !== "paused").map((b) => b.key));
  const share = (d) => (allLate ? Math.round((100 * d) / allLate) : 0);

  // 1. follow-up lapses
  {
    const keys = ["silent_none", "silent_task", "silent_far"];
    const list = casesOf(keys), d = dayOf(keys);
    if (list.length) {
      const sub = parts.find((p) => p.key === "silence");
      const held = list.length === sub.casesFailed ? (list.length === 1 ? "The gaps held it up" : "In every one of them the gaps held the case up") : `In ${num(list.length)} of them the gaps held the case up`;
      out.push({ key: "followup", title: "Cases left without follow-up", days: d, cases: list.length, sharePct: share(d),
        found: `${plural(sub.casesFailed, "case")} went past the follow-up allowance with no email, call or WhatsApp (${plural(sub.gaps, "gap")}). ${held}, adding ${plural(d, "late day")} (${share(d)}% of all late days). In ${pct(sub.noTask, sub.gaps)}% of the gaps no follow-up task had been set; in ${pct(sub.taskNotDone, sub.gaps)}% a task was due and not done; in ${pct(sub.tooFar, sub.gaps)}% the next task was set too far out.`,
        where: topBy(list, stageOf).map(([k, n]) => `${k}: ${n}`).join("; "), who: topBy(list, owner).map(([k, n]) => `${k} (${n})`).join(", "),
        fix: "Every live case keeps an open follow-up task inside the allowance. When a task falls due, the client is contacted that day, even if only to say there is no news." });
    }
  }
  // 2. emails
  {
    const p = parts.find((x) => x.key === "email"), list = casesOf(["email"]);
    if (p.late + p.missed) out.push({ key: "email", title: "Client emails not answered in time", days: p.delayDays, cases: p.casesFailed, sharePct: share(p.delayDays),
      found: `${num(p.late + p.missed)} of ${plural(p.due, "client email")} that asked for something waited past ${SETTINGS.EMAIL_REPLY_HOURS} working hours${p.missed ? ` (${num(p.missed)} never answered)` : ""}. Typical overrun: ${plural(Math.round(p.medianOverHours || 0), "working hour")}.${p.delayDays ? ` Waiting clients account for ${plural(p.delayDays, "late day")}.` : ""}`,
      where: topBy(list.length ? list : rows.filter((r) => r.comms.obligations.some((o) => o.type === "email" && o.verdict !== "met" && o.verdict !== "pending")), stageOf).map(([k, n]) => `${k}: ${n}`).join("; "),
      who: topBy(rows.filter((r) => r.comms.obligations.some((o) => o.type === "email" && (o.verdict === "late" || o.verdict === "missed"))), owner).map(([k, n]) => `${k} (${n})`).join(", "),
      fix: "Answer, or at least acknowledge with a date, every client email that asks something within 24 working hours. Cover a colleague's inbox during leave." });
  }
  // 3. calls
  {
    const p = parts.find((x) => x.key === "callreq");
    if (p.late + p.missed) out.push({ key: "callreq", title: "Calls not made when the client asked", days: p.delayDays, cases: p.casesFailed, sharePct: share(p.delayDays),
      found: `${num(p.late + p.missed)} of ${plural(p.due, "call request or unanswered client call", "call requests or unanswered client calls")} ${were(p.late + p.missed)} not returned the same working day${p.missed ? ` (${num(p.missed)} never returned)` : ""}.`,
      where: "", who: topBy(rows.filter((r) => r.comms.obligations.some((o) => o.type === "callreq" && (o.verdict === "late" || o.verdict === "missed"))), owner).map(([k, n]) => `${k} (${n})`).join(", "),
      fix: "Return every call request and missed client call the same working day; if the client does not pick up, WhatsApp and log it." });
  }
  // 4. promises
  {
    const p = parts.find((x) => x.key === "promise");
    if (p.late + p.missed) out.push({ key: "promise", title: "Promises to clients not kept", days: p.delayDays, cases: p.casesFailed, sharePct: share(p.delayDays),
      found: `${num(p.late + p.missed)} of ${plural(p.due, "dated promise")} ("I'll call you tomorrow") ${were(p.late + p.missed)} kept late or not at all.`,
      where: "", who: topBy(rows.filter((r) => r.comms.obligations.some((o) => o.type === "promise" && (o.verdict === "late" || o.verdict === "missed"))), owner).map(([k, n]) => `${k} (${n})`).join(", "),
      fix: "Only promise a time that is on the calendar, and set the task when making the promise." });
  }
  // 5. petition team
  {
    const list = casesOf(["petition"]), d = dayOf(["petition"]);
    if (list.length) {
      const roles = topBy(list.filter((r) => r.ps && r.ps.found && r.ps.holder && r.ps.holder.who === "petition"), (r) => ROLE_LABEL[r.ps.holder.role] || r.ps.holder.role);
      out.push({ key: "petition", title: "USA cases held by the petition team past their time", days: d, cases: list.length, sharePct: share(d),
        found: `${plural(list.length, "USA case")} sat with the petition team beyond the plan, ${plural(d, "late day")} in all.${roles.length ? ` Petition Studio puts the hold with the ${roles.map(([k, n]) => `${k} (${n})`).join(", ")}.` : ""}`,
        where: topBy(list, stageOf).map(([k, n]) => `${k}: ${n}`).join("; "), who: "",
        fix: "Review the petition team's queue weekly against the Petition Studio time limits; the case manager escalates any case over its limit." });
    }
  }
  // 6. clients not responding, still marked Active
  {
    const quiet = live.filter((r) => r.facts.status === "live" && r.comms.stats.clientSilentWd != null && r.comms.stats.clientSilentWd >= 40 && r.comms.stats.followUpsSinceClient >= 4);
    const never = live.filter((r) => r.facts.status === "live" && r.comms.stats.lastClient == null && r.comms.stats.touches >= 6);
    const d = dayOf(["client"]), q = quiet.length + never.length;
    if (q || d) out.push({ key: "client", title: q ? "Clients not responding, cases still marked Active" : "Waiting on clients", days: d, cases: casesOf(["client"]).length, sharePct: share(d),
      found: `${d ? `${plural(d, "late day")} ${were(d)} spent waiting on clients while the case manager kept chasing.` : ""}${d && q ? " " : ""}${q ? `${plural(q, "live case")} ${q === 1 ? "has" : "have"} had no reply from the client for 40+ working days despite repeated follow-ups, and ${q === 1 ? "is" : "are"} still marked Active rather than Non-Responsive.` : ""}`,
      where: topBy([...quiet, ...never], stageOf).map(([k, n]) => `${k}: ${n}`).join("; "), who: topBy([...quiet, ...never], owner).map(([k, n]) => `${k} (${n})`).join(", "),
      fix: "After four unanswered follow-ups across two channels, escalate to a call from the team lead and mark the case Non-Responsive, so the backlog shows what is really live." });
  }
  // 7. stage not updated
  {
    const list = rows.filter((r) => r.facts.stale);
    if (list.length) out.push({ key: "stale", title: "HubSpot stage not moved when the case moved", days: dayOf(["stale"]), cases: list.length, sharePct: share(dayOf(["stale"])),
      found: list.length === 1 ? "1 case looks stalled in HubSpot but the emails (or Petition Studio) show it moved on: the stage was simply not updated. It is not counted as a communication delay."
        : `${plural(list.length, "case")} look stalled in HubSpot but the emails (or Petition Studio) show they moved on: the stage was simply not updated. They are not counted as communication delays.`,
      where: topBy(list, stageOf).map(([k, n]) => `${k}: ${n}`).join("; "), who: topBy(list, owner).map(([k, n]) => `${k} (${n})`).join(", "),
      fix: "Move the deal stage on the day the step happens (skills assessment lodged, EOI or profile submitted, petition sent for review)." });
  }
  // 8. inherited backlog
  {
    const list = live.filter((r) => r.facts.inheritedMs > 7 * DAY);
    if (list.length) {
      const batches = topBy(list, (r) => dateKey(r.facts.ownerStart), 4).filter(([, n]) => n >= 10);
      out.push({ key: "inherited", title: "Cases handed over already late", days: days(list.reduce((s, r) => s + r.facts.inheritedMs, 0)), cases: list.length, sharePct: null,
        found: `${plural(list.length, "live case")} ${were(list.length)} already behind the plan when the current case manager took ${list.length === 1 ? "it" : "them"} over${batches.length ? `, mostly in reassignments on ${batches.map(([k, n]) => `${fmtShort(Date.parse(k + "T12:00:00+05:00"))} (${n})`).join(", ")}` : ""}. That inherited delay is not counted against the case manager.`,
        where: topBy(list, stageOf).map(([k, n]) => `${k}: ${n}`).join("; "), who: topBy(list, owner).map(([k, n]) => `${k} (${n})`).join(", "),
        fix: "Hand over late cases with a recovery plan and a first-week call to the client, and review those cases separately until they are back on plan." });
    }
  }
  // 9. outside bodies
  {
    const list = casesOf(["external"]), d = dayOf(["external"]);
    const quiet = rows.flatMap((r) => r.comms.silences.filter((s) => s.holder === "external").map(() => r));
    if (list.length) out.push({ key: "external", title: "Waiting on outside bodies (not a case manager failure)", days: d, cases: list.length, sharePct: share(d),
      found: `${plural(d, "late day")} ${were(d)} spent with WES, skills assessment bodies, USCIS or IRCC, longer than the plan allows.${(() => { const k = new Set(quiet.map((r) => r.c.id)).size; return k ? ` ${num(k)} of these cases also went ${SETTINGS.FOLLOW_UP_EVERY.external}+ working days without a client update.` : ""; })()}`,
      where: topBy(list, stageOf).map(([k, n]) => `${k}: ${n}`).join("; "), who: "",
      fix: "Track each outside application's reference and expected date, and update the client every three weeks while it is pending." });
  }
  // 10. the case manager bot rules after calls
  {
    const pe = parts.find((x) => x.key === "callemail"), pt = parts.find((x) => x.key === "calltask"), pd = parts.find((x) => x.key === "calldesc");
    const miss = (pe.missed || 0) + (pt.missed || 0) + (pd.missed || 0);
    if (miss) out.push({ key: "aftercall", title: "Calls without the follow-up email, next task or notes", days: null, cases: new Set([...rows.filter((r) => r.comms.hygiene.some((h) => !h.ok)).map((r) => r.c.id)]).size, sharePct: null,
      found: `On ${num(pe.missed)} of ${plural(pe.due, "call day")} no email reached the client that day; ${num(pt.missed)} of ${num(pt.due)} had no next follow-up task; ${num(pd.missed)} of ${plural(pd.due, "connected call")} ${pd.missed === 1 ? "has" : "have"} no notes.`,
      where: "", who: cmRows.filter((c) => c.hygienePct != null).sort((a, b) => a.hygienePct - b.hygienePct).slice(0, 3).map((c) => `${c.name} (${c.hygienePct}%)`).join(", "),
      fix: "After every call: a same-day email recapping it, the next task set, and a line saying what was discussed." });
  }
  // 11. tasks ticked in bulk
  {
    const list = rows.filter((r) => r.comms.stats.bulkClosedTasks >= SETTINGS.BULK_TASKS);
    if (list.length) out.push({ key: "bulk", title: "Follow-up tasks ticked in bulk", days: null, cases: list.length, sharePct: null,
      found: `On ${plural(list.length, "case")}, tasks were marked complete in one go, often months after they were due, so the task list no longer shows what was really followed up. Those tasks were judged on the contact logged around them instead.`,
      where: "", who: topBy(list, owner).map(([k, n]) => `${k} (${n})`).join(", "),
      fix: "Tick a task when the follow-up is done, not in a clean-up. A clean-up hides which follow-ups were missed." });
  }
  // 12. tags
  {
    const p = parts.find((x) => x.key === "handoff");
    if (p.due && p.late + p.missed) out.push({ key: "handoff", title: "Tags between case managers and the petition team not answered (possible)", days: null, cases: null, sharePct: null,
      found: `${num(p.late + p.missed)} of ${plural(p.due, "note")} that tagged someone and asked them to act ${p.late + p.missed === 1 ? "shows" : "show"} no later note, email or call from that person within ${SETTINGS.MENTION_REPLY_HOURS} working hours: ${num(p.owedByCm)} owed by the case manager, ${num(p.owedByTeam)} by colleagues. Replies left as comments cannot be read, so check before acting.`,
      where: "", who: "", fix: "Answer a tag with a fresh note (not only a comment) so the hand-off is visible, and close the loop with the client." });
  }
  // 13. data
  {
    const conflicts = rows.filter((r) => r.facts.programNote);
    if (conflicts.length) out.push({ key: "data", title: "Program labels that do not match the deal", days: null, cases: conflicts.length, sharePct: null,
      found: `${plural(conflicts.length, "case")} ${conflicts.length === 1 ? "has" : "have"} an Immigration Program that is empty, holds two programs, or contradicts the deal name, so the wrong timeline may be applied.`,
      where: "", who: topBy(conflicts, owner).map(([k, n]) => `${k} (${n})`).join(", "), fix: "Set Immigration Program to the one program the client is on." });
  }
  // the order: the problems that explain late days, largest first; then the rest by how many
  // cases they touch (the inherited backlog is context, not a cause, so it never leads)
  const weight = (x) => (x.key === "inherited" || x.days == null ? -1 : x.days);
  return out.sort((a, b) => weight(b) - weight(a) || (b.cases || 0) - (a.cases || 0));
}

module.exports = { attribute, story, byCaseManager, byStage, commParts, rootProblems, tallyComms, BUCKET, SIDE_LABEL, median, pct, SCORED, HYGIENE };
