// 4-timeline.js — where a case is, where it should be, and how it got there. From the deal's
// own history: every stage it sat in and for how long, who owned it and since when, when it
// was on hold, and who held it while it was with the petition team. No network in here.
const { IDEAL_DAYS, PROGRAMS, SUBMITTED_STATUSES, PROGRAM_VALUES, NAME_SAYS_AUSTRALIA, NAME_SAYS_CANADA,
  PETITION_STATUS_CLIENT, LOR_STATUS_CLIENT, STATUS_RULES, MILESTONES } = require("./config");
const { ms, DAY } = require("./1-clock");

const multi = (v) => String(v || "").split(";").map((s) => s.trim()).filter(Boolean);
const hasAny = (v, list) => { const vals = multi(v).map((x) => x.toLowerCase()); return list.some((l) => vals.includes(String(l).toLowerCase())); };

// ---------------------------------------------------------------- the program
function programOf(p) {
  if (p.pipeline === PROGRAMS.USA.pipeline) return { program: "USA", note: "" };
  const vals = multi(p.immigration_program);
  const aus = vals.some((v) => PROGRAM_VALUES.Australia.includes(v));
  const can = vals.some((v) => PROGRAM_VALUES.Canada.includes(v));
  const name = String(p.dealname || "");
  const nameAus = NAME_SAYS_AUSTRALIA.test(name), nameCan = NAME_SAYS_CANADA.test(name);
  let program, note = "";
  if (aus && !can) program = "Australia";
  else if (can && !aus) program = "Canada";
  else if (aus && can) { program = nameAus && !nameCan ? "Australia" : "Canada"; note = `Immigration Program holds both (${vals.join(", ")}); the deal name decided`; }
  else { program = nameAus && !nameCan ? "Australia" : "Canada"; note = vals.length ? `Immigration Program is "${vals.join(", ")}"; treated as ${program}` : `Immigration Program is empty; treated as ${program} from the deal name`; }
  if (!note && program === "Canada" && nameAus && !nameCan) note = `The deal name says Australia but the Immigration Program says ${vals.join(", ")}`;
  if (!note && program === "Australia" && nameCan && !nameAus) note = `The deal name says Canada but the Immigration Program says Australia`;
  return { program, note };
}

// ---------------------------------------------------------------- status
function statusOf(clientStatus, appStatus) {
  if (hasAny(clientStatus, STATUS_RULES.closed) || hasAny(appStatus, STATUS_RULES.appClosed)) return "closed";
  if (hasAny(clientStatus, STATUS_RULES.paused) || hasAny(appStatus, STATUS_RULES.appPaused)) return "paused";
  if (hasAny(clientStatus, STATUS_RULES.unresponsive)) return "unresponsive";
  return "live";
}

// value of a property at time t, from its history (or the current value when there is none)
function valueAt(hist, t, current) {
  if (!hist || !hist.length) return current;
  let v = null;
  for (const h of hist) { if (h.at <= t) v = h.value; else break; }
  return v == null ? (hist[0].at > t ? "" : current) : v;
}

// intervals of one state over time, from two histories
function stateIntervals(hCs, hAs, curCs, curAs, from, to) {
  const points = [...new Set([from, ...(hCs || []).map((h) => h.at), ...(hAs || []).map((h) => h.at)].filter((t) => t >= from && t < to))].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = i + 1 < points.length ? points[i + 1] : to;
    const st = statusOf(valueAt(hCs, a, curCs), valueAt(hAs, a, curAs));
    const last = out[out.length - 1];
    if (last && last.state === st) last.to = b; else out.push({ from: a, to: b, state: st });
  }
  return out;
}

// ---------------------------------------------------------------- stages and phases
// which phase a stage belongs to, and who holds the case there
function stageInfo(program, stageId, submitted) {
  const P = PROGRAMS[program];
  if (!P) return { phaseIndex: null, type: "cm", unknown: true };
  if (P.finishStage && String(stageId) === P.finishStage && submitted) {
    const a = P.after[stageId];
    return { phaseIndex: P.phases.length, after: true, finished: true, type: a.type, days: a.days || null };
  }
  for (let i = 0; i < P.phases.length; i++) {
    const t = P.phases[i].stages[String(stageId)];
    if (t) return { phaseIndex: i, phaseKey: P.phases[i].key, phaseLabel: P.phases[i].label, type: t, days: P.phases[i].days };
  }
  const a = P.after[String(stageId)];
  if (a) return { phaseIndex: P.phases.length, after: true, finished: true, type: a.type, days: a.days || null, done: a.type === "done" };
  return { phaseIndex: null, type: "cm", unknown: true };
}

// [{ stageId, from, to }] in this pipeline, oldest first
function stageVisits(hist, props, stages, now) {
  const pipeline = String(props.pipeline);
  const inPipe = (sid) => stages[sid] ? stages[sid].pipelineId === pipeline : true;
  let points = (hist || []).filter((h) => h.value && inPipe(h.value)).map((h) => ({ stageId: h.value, at: h.at }));
  let source = "history";
  if (!points.length) {
    // no history: HubSpot's "date entered" for each stage (the latest entry into each)
    points = Object.entries(props).filter(([k, v]) => /^hs_v2_date_entered_\d+$/.test(k) && v)
      .map(([k, v]) => ({ stageId: k.replace("hs_v2_date_entered_", ""), at: ms(v) })).filter((x) => x.at && inPipe(x.stageId));
    source = "entry dates";
  }
  if (!points.length) { points = [{ stageId: String(props.dealstage), at: ms(props.hs_v2_date_entered_current_stage) || ms(props.createdate) }]; source = "current stage only"; }
  points.sort((a, b) => a.at - b.at);
  // the current stage is always last, whatever the history says
  if (points[points.length - 1].stageId !== String(props.dealstage)) points.push({ stageId: String(props.dealstage), at: ms(props.hs_v2_date_entered_current_stage) || points[points.length - 1].at });
  const visits = [];
  for (const p of points) {
    const last = visits[visits.length - 1];
    if (last && last.stageId === p.stageId) continue;
    if (last) last.to = Math.max(last.from, p.at);
    visits.push({ stageId: p.stageId, from: p.at, to: now });
  }
  visits[visits.length - 1].to = now;
  return { visits, source };
}

// the start of the current owner's latest unbroken spell of ownership
function ownerStart(hist, props) {
  const current = String(props.hubspot_owner_id || "");
  const assigned = ms(props.hubspot_owner_assigneddate);
  const list = (hist || []).filter((h) => h.value !== undefined);
  if (!list.length || list[list.length - 1].value !== current) return { at: assigned || ms(props.createdate), previous: "", source: "assigned date" };
  let i = list.length - 1;
  while (i > 0 && list[i - 1].value === current) i--;
  const prev = i > 0 ? list[i - 1].value : "";
  return { at: list[i].at, previous: prev, source: list[i].at < assigned - DAY ? "owner history (the assigned date moved later)" : "owner history" };
}

// who holds a USA petition stage, over time, from Petition Status and LOR Status
function petitionHolder(hPs, hLor, curPs, curLor, from, to) {
  const points = [...new Set([from, ...(hPs || []).map((h) => h.at), ...(hLor || []).map((h) => h.at)].filter((t) => t >= from && t < to))].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = i + 1 < points.length ? points[i + 1] : to;
    const ps = valueAt(hPs, a, curPs), lor = valueAt(hLor, a, curLor);
    let who = null, why = "";
    if (PETITION_STATUS_CLIENT.includes(ps)) { who = "client"; why = `Petition Status "${ps}"`; }
    else if (LOR_STATUS_CLIENT.includes(lor) && !ps) { who = "client"; why = `LOR Status "${lor}"`; }
    else if (ps) { who = "petition"; why = `Petition Status "${ps}"`; }
    else if (lor) { who = "petition"; why = `LOR Status "${lor}"`; }
    if (!who) continue;
    const last = out[out.length - 1];
    if (last && last.who === who && last.why === why && last.to === a) last.to = b; else out.push({ from: a, to: b, who, why });
  }
  return out;
}

// the time inside [a, b] that falls outside the intervals given
function minus(a, b, intervals) {
  let t = Math.max(0, b - a);
  for (const iv of intervals) { const s = Math.max(a, iv.from), e = Math.min(b, iv.to); if (e > s) t -= e - s; }
  return Math.max(0, t);
}
// the moment `budget` ms of active (not paused) time has passed after `from`
function afterActive(from, budget, paused, limit) {
  let t = from, left = budget;
  const ps = paused.filter((p) => p.to > from).sort((x, y) => x.from - y.from);
  for (const p of ps) {
    if (p.from > t) { const run = p.from - t; if (run >= left) return t + left; left -= run; }
    t = Math.max(t, p.to);
    if (t >= limit) return limit;
  }
  return t + left;
}

// ---------------------------------------------------------------- one case, end to end
function buildFacts(c, { stages, now, fromMs, stageLabel }) {
  const p = c.props;
  const { program, note: programNote } = programOf(p);
  const P = PROGRAMS[program];
  const { visits, source: visitSource } = stageVisits(c.history.dealstage, p, stages, now);
  const start = visits[0].from || ms(p.closedate) || ms(p.createdate);
  const own = ownerStart(c.history.hubspot_owner_id, p);
  const reviewStart = Math.max(own.at || fromMs, fromMs);
  const status = statusOf(p.client_status, p.application_status);
  const states = stateIntervals(c.history.client_status, c.history.application_status, p.client_status, p.application_status, start, now);
  const paused = states.filter((s) => s.state === "paused" || s.state === "closed");
  const unresponsive = states.filter((s) => s.state === "unresponsive");

  // Express Entry & PNP is HOF's step until Application Status shows the profile submitted
  const subHist = c.history.application_status || [];
  const submittedAt = (from) => {
    const hit = subHist.find((h) => h.at >= from && hasAny(h.value, SUBMITTED_STATUSES));
    if (hit) return hit.at;
    if (!subHist.length && hasAny(p.application_status, SUBMITTED_STATUSES)) return from;
    if (subHist.length && hasAny(valueAt(subHist, from, p.application_status), SUBMITTED_STATUSES)) return from;
    return null;
  };

  // stage visits with their phase, split where a profile was submitted mid-stage
  const parts = [];
  for (const v of visits) {
    if (P && P.finishStage && v.stageId === P.finishStage) {
      const sAt = submittedAt(v.from);
      if (sAt != null && sAt < v.to) {
        if (sAt > v.from) parts.push({ ...v, to: sAt, info: stageInfo(program, v.stageId, false) });
        parts.push({ ...v, from: sAt, info: stageInfo(program, v.stageId, true), submittedSplit: true });
        continue;
      }
    }
    parts.push({ ...v, info: stageInfo(program, v.stageId, false) });
  }
  for (const v of parts) { v.label = stageLabel(v.stageId); v.order = (stages[v.stageId] || {}).order || 0; }
  const current = parts[parts.length - 1];

  // ---- the 5-month plan ----
  const pausedMs = (a, b) => (b - a) - minus(a, b, paused);
  const phases = P ? P.phases : [];
  const cum = []; let acc = 0;
  for (const ph of phases) { acc += ph.days * DAY; cum.push(acc); }
  const ideal = IDEAL_DAYS * DAY;
  const expectedAt = (t) => {
    const active = Math.max(0, (t - start) - pausedMs(start, t));
    const i = cum.findIndex((c2) => active < c2);
    return { index: i === -1 ? phases.length : i, active };
  };
  // the phase a case was in at time t (after a step back, the phase it went back to)
  const phaseAt = (t) => {
    let v = parts[0];
    for (const x of parts) { if (x.from <= t) v = x; else break; }
    return v.info.phaseIndex == null ? null : v.info.phaseIndex;
  };
  const behindAt = (t) => {
    const e = expectedAt(t), a = phaseAt(t);
    if (a == null) return null;
    if (a >= phases.length) return 0;                      // HOF's part is finished
    const shouldLeave = cum[a];
    return Math.max(0, e.active - shouldLeave);
  };
  const exp = expectedAt(now);
  const actualIndex = current.info.phaseIndex;
  let finished = actualIndex != null && actualIndex >= phases.length;
  // how far behind the plan the case would be today if it were in phase `idx`
  const behindFor = (idx) => idx == null ? null : idx >= phases.length ? 0 : Math.max(0, exp.active - cum[idx]);
  let behindMs = behindAt(now);
  const inheritedMs = own.at > start ? behindAt(Math.min(own.at, now)) : 0;
  // when HOF's part first finished, and whether that was inside the five months
  const finishVisit = parts.find((v) => v.info.finished);
  const finishAt = finishVisit ? finishVisit.from : null;
  const lateAtFinish = finishAt != null ? Math.max(0, (finishAt - start - pausedMs(start, finishAt)) - ideal) : null;
  const activeInPhase = (() => {
    // time in the current phase: back to the first stage of the unbroken run of this phase
    let i = parts.length - 1;
    while (i > 0 && parts[i - 1].info.phaseIndex === current.info.phaseIndex && !current.info.after) i--;
    return { from: parts[i].from, active: (now - parts[i].from) - pausedMs(parts[i].from, now) };
  })();
  let projectedFinish = null;
  if (!finished && actualIndex != null) {
    const left = Math.max(0, phases[actualIndex].days * DAY - activeInPhase.active) + phases.slice(actualIndex + 1).reduce((s, ph) => s + ph.days * DAY, 0);
    projectedFinish = now + left;
  }

  // ---- phase visits, for comparing each phase with its share of the five months ----
  const phaseVisits = [];
  for (const v of parts) {
    const key = v.info.after ? `after:${v.stageId}` : v.info.phaseIndex == null ? `unknown:${v.stageId}` : `phase:${v.info.phaseIndex}`;
    const last = phaseVisits[phaseVisits.length - 1];
    if (last && last.key === key) { last.to = v.to; last.stages.push(v); continue; }
    const budgetDays = v.info.after ? v.info.days : v.info.phaseIndex == null ? null : phases[v.info.phaseIndex].days;
    phaseVisits.push({ key, from: v.from, to: v.to, stages: [v], budgetDays,
      label: v.info.after ? v.label : v.info.phaseIndex == null ? v.label : phases[v.info.phaseIndex].label });
  }
  // A day is late when the case is behind the plan: still in a phase after the date by which
  // the five months say it should have left it. A case that finished inside the five months
  // has no late days, even if one phase took longer than its share. Stages after HOF's part
  // that have their own allowance (an RFE, an ITA) are late once that allowance runs out.
  for (const pv of phaseVisits) {
    pv.activeMs = (pv.to - pv.from) - pausedMs(pv.from, pv.to);
    pv.over = pv.budgetDays != null && pv.activeMs > pv.budgetDays * DAY;
    pv.current = pv === phaseVisits[phaseVisits.length - 1];
    if (pv.key.startsWith("phase:")) {
      const i = Number(pv.key.slice(6));
      if (finishAt != null && lateAtFinish === 0 && pv.from < finishAt) { pv.excessFrom = null; continue; }
      pv.excessFrom = Math.max(pv.from, afterActive(start, cum[i], paused, Infinity));
      pv.shouldLeaveBy = afterActive(start, cum[i], paused, Infinity);
    } else if (pv.key.startsWith("after:") && pv.budgetDays != null) pv.excessFrom = afterActive(pv.from, pv.budgetDays * DAY, paused, pv.to);
    else pv.excessFrom = null;
  }

  // ---- who holds a petition stage (USA), and client-held application statuses ----
  const holder = program === "USA"
    ? petitionHolder(c.history.petition_status, c.history.lor_status, p.petition_status || "", p.lor_status || "", start, now) : [];
  const appClient = [];
  {
    const hA = c.history.application_status || [];
    const pts = [...new Set([start, ...hA.map((h) => h.at)].filter((t) => t >= start && t < now))].sort((a, b) => a - b);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = i + 1 < pts.length ? pts[i + 1] : now, v = valueAt(hA, a, p.application_status);
      if (hasAny(v, STATUS_RULES.appClient)) appClient.push({ from: a, to: b, why: `Application Status "${multi(v).join(", ")}"` });
    }
  }

  // who holds the case at time t
  const typeAt = (t) => {
    let v = parts[0];
    for (const x of parts) { if (x.from <= t) v = x; else break; }
    let type = v.info.type;
    if (type === "petition") {
      const h = holder.find((x) => x.from <= t && t < x.to);
      if (h && h.who === "client") type = "client";
    }
    if ((type === "cm" || type === "petition") && unresponsive.some((u) => u.from <= t && t < u.to)) type = "client";
    if (type === "cm" && appClient.some((x) => x.from <= t && t < x.to) && !v.info.after) type = "client";
    return type;
  };

  // ---- stage not updated: the emails say the case moved on, so it is judged where it really is
  const stale = staleEvidence(c, program, current, phases);
  let effectiveIndex = actualIndex;
  if (stale && actualIndex != null && stale.rank > actualIndex) { effectiveIndex = stale.rank; behindMs = behindFor(stale.rank); if (stale.rank >= phases.length) finished = true; }
  const phaseLabelOf = (i) => i == null ? current.label : i >= phases.length ? `Finished (${P ? P.finishLabel : "done"})` : phases[i].label;

  return {
    program, programNote, programLabel: P ? P.label : program, finishLabel: P ? P.finishLabel : "",
    start, ownerStart: own.at, ownerSource: own.source, previousOwner: own.previous, reviewStart,
    status, states, paused, unresponsive, visits: parts, visitSource, phaseVisits, current, holder, appClient,
    stageId: current.stageId, stageLabel: current.label, stageSince: current.from, stageInfo: current.info,
    expectedIndex: exp.index, expectedLabel: exp.index >= phases.length ? `Finished (${P ? P.finishLabel : "done"})` : phases[exp.index].label,
    actualIndex, actualLabel: phaseLabelOf(actualIndex), effectiveIndex, effectiveLabel: phaseLabelOf(effectiveIndex),
    finished, done: !!current.info.done, finishAt, lateAtFinish,
    behindMs, inheritedMs, idealFinish: start + ideal + pausedMs(start, now), projectedFinish, behindFor, phaseLabelOf,
    phaseSince: activeInPhase.from, activeInPhaseMs: activeInPhase.active,
    phaseBudgetDays: current.info.after ? current.info.days : actualIndex == null ? null : (phases[actualIndex] || {}).days,
    typeAt, stale,
  };
}

// an outbound email subject (or a note) showing a later phase than the stage says. The
// furthest phase shown wins, dated by the first line that showed it.
function staleEvidence(c, program, current, phases) {
  const rules = MILESTONES[program] || [];
  if (current.info.finished || current.info.phaseIndex == null) return null;
  const rankOf = (key) => key === "finished" ? phases.length : phases.findIndex((ph) => ph.key === key);
  let best = null;
  for (const e of c.events) {
    if (e.at < current.from) continue;
    let text = "", kind = "";
    if (e.kind === "email" && e.dir === "out" && e.toClient && !e.bulk) { text = e.subject || ""; kind = "subject"; }
    else if (e.kind === "note" && !e.compliance) { text = e.text || ""; kind = "note"; }
    else continue;
    for (const r of rules) {
      const re = kind === "subject" ? r.subject : r.note;
      if (!re) continue;
      const m = re.exec(text);
      if (!m) continue;
      const rank = rankOf(r.phase);
      if (rank > current.info.phaseIndex && (!best || rank > best.rank))
        best = { at: e.at, rank, phase: r.phase, phaseLabel: r.phase === "finished" ? "finished" : phases[rank].label,
          quote: (kind === "subject" ? text : text.slice(Math.max(0, m.index - 40), m.index + 120)).trim(), kind, eventId: e.id };
      break;
    }
  }
  return best;
}

module.exports = { buildFacts, programOf, statusOf, stageInfo, stageVisits, ownerStart, petitionHolder, stateIntervals, valueAt, multi, hasAny, minus, afterActive, staleEvidence };
