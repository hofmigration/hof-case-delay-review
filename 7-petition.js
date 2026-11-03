// 7-petition.js — every USA case, checked against Petition Studio. Read-only (GET only).
//
// Petition Studio knows who holds a petition right now and for how long: the writer, the
// reviewer, the brainstorm specialist, the forms specialist, the client, or the case manager.
// Its own filters say where a case is stuck (brainstorm overdue, review unanswered, document
// audit open, client never invited...). That decides whether a USA delay sits with the
// petition team, with the client, or with the case manager.
//
// Cases are matched to HubSpot by the client's email, then by name. A name that matches more
// than one case, or none, is listed for checking rather than guessed.
const { SETTINGS, PS_STATUS, PS_PROBES, PS_CLOSED, PETITION_TEAM_ROLES, ROLE_LABEL, PS_RANK_OF_PHASE } = require("./config");
const { ms, HOUR } = require("./1-clock");

const sleep = (t) => new Promise((r) => setTimeout(r, t));
const on = () => SETTINGS.USE_PETITION_STUDIO && !!process.env.PETITION_API_KEY;
const stats = { calls: 0, errors: 0 };

async function api(path) {
  const key = process.env.PETITION_API_KEY;
  const url = path.startsWith("http") ? path : `${SETTINGS.PETITION_API_BASE.replace(/\/+$/, "")}${path}`;
  for (let a = 0; a < 5; a++) {
    let res;
    stats.calls++;
    try { res = await fetch(url, { headers: { "x-api-key": key, Accept: "application/json" } }); }
    catch (e) { if (a === 4) throw new Error(`Cannot reach Petition Studio: ${e.message}`); await sleep(1500 * (a + 1)); continue; }
    if (res.status === 429 || res.status >= 500) { await sleep(1500 * (a + 1)); continue; }
    if (res.status === 401 || res.status === 403) throw new Error("Petition Studio refused the API key");
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return res.json();
  }
  throw new Error(`Petition Studio kept failing: ${path}`);
}
const qs = (f = {}) => { const p = Object.entries(f).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`); return p.length ? `?${p.join("&")}` : ""; };
const asList = (r) => (Array.isArray(r) ? r : (r && (r.cases || r.data || r.results || r.items)) || []);
async function listCases(filters = {}) { return asList(await api(`/external/case-history${qs(filters)}`)); }
const getCase = (id) => api(`/external/cases/${encodeURIComponent(id)}`).then((r) => (r && (r.case || r.data)) || r);
const searchCases = (q) => api(`/external/cases/search?q=${encodeURIComponent(q)}`).then(asList);
async function mapPool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { stats.errors++; out[k] = { error: e.message }; } }
  }));
  return out;
}

// ---------------------------------------------------------------- tolerant reading
function pick(obj, ...names) {
  if (!obj || typeof obj !== "object") return undefined;
  for (const n of names) for (const k of Object.keys(obj)) if (k.toLowerCase() === n.toLowerCase() && obj[k] !== null && obj[k] !== "") return obj[k];
  return undefined;
}
const truthy = (v) => v === true || /^(true|yes|y|1|on|hold|on_hold)$/i.test(String(v ?? ""));
const personName = (p) => (p && typeof p === "object" ? (p.name || p.email || "") : String(p || ""));
const personEmail = (p) => (p && typeof p === "object" ? String(p.email || "").toLowerCase() : "");

// ---------------------------------------------------------------- matching
const HONOR = /\b(dr|mr|mrs|ms|miss|eng|engr|prof|sir|madam)\b\.?/g;
const NOISE = /\b(usa|us|eb|eb2|eb-2|niw|eb2niw|can|canada|aus|australia|dual|single|hold|on hold|pr|case|client|petition|co|c o|and)\b/g;
function nameTokens(s) {
  const t = String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[\/|,;:()\-–_]+/g, " ").replace(HONOR, " ").replace(/[^a-z\s]/g, " ").replace(NOISE, " ");
  return [...new Set(t.split(/\s+/).filter((w) => w.length > 1))];
}
const keyOf = (tokens) => [...tokens].sort().join(" ");

function buildIndex(rows) {
  const byEmail = new Map(), byKey = new Map(), bySquash = new Map(), byDeal = new Map(), list = [];
  for (const r of rows) {
    const email = String(pick(r, "client_email", "email", "clientEmail") || (pick(r, "client") && pick(pick(r, "client"), "email")) || "").toLowerCase();
    const name = String(pick(r, "client_name", "clientName", "name") || (pick(r, "client") && pick(pick(r, "client"), "name")) || "");
    const deal = String(pick(r, "hubspot_deal_id", "hubspotDealId", "deal_id", "dealId", "hubspot_id") || "");
    const tokens = nameTokens(name);
    const x = { row: r, email, name, tokens, deal };
    list.push(x);
    if (email) { if (!byEmail.has(email)) byEmail.set(email, []); byEmail.get(email).push(x); }
    if (tokens.length) { const k = keyOf(tokens); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(x); }
    if (tokens.length) { const q = tokens.join(""); if (!bySquash.has(q)) bySquash.set(q, []); bySquash.get(q).push(x); }
    if (deal) byDeal.set(deal, x);
  }
  return { byEmail, byKey, bySquash, byDeal, list };
}

// the Petition Studio case for one HubSpot case, or why there is none
function matchCase(c, index, ownerName) {
  if (index.byDeal.has(String(c.id))) return { hit: index.byDeal.get(String(c.id)), how: "HubSpot deal id" };
  const narrow = (xs) => {
    if (xs.length <= 1) return xs;
    const first = String(ownerName || "").toLowerCase().split(" ")[0];
    const same = xs.filter((x) => { const cm = pick(x.row, "case_manager"); return first && personName(cm).toLowerCase().startsWith(first); });
    return same.length ? same : xs;
  };
  const emails = [...new Set([c.email, ...c.contacts.map((p) => p.email)].map((e) => String(e || "").toLowerCase()).filter(Boolean))];
  for (const e of emails) {
    const xs = narrow(index.byEmail.get(e) || []);
    if (xs.length === 1) return { hit: xs[0], how: "client email" };
    if (xs.length > 1) return { ambiguous: xs, how: "client email" };
  }
  const names = [c.client, ...c.contacts.map((p) => p.name), c.props.dealname].filter(Boolean);
  for (const n of names) {
    const t = nameTokens(n);
    if (t.length < 2) continue;
    const xs = narrow(index.byKey.get(keyOf(t)) || []);
    if (xs.length === 1) return { hit: xs[0], how: "client name" };
    if (xs.length > 1) return { ambiguous: xs, how: "client name" };
    const ys = narrow((index.bySquash && index.bySquash.get(t.join(""))) || []);
    if (ys.length === 1) return { hit: ys[0], how: "client name" };
    if (ys.length > 1) return { ambiguous: ys, how: "client name" };
  }
  // a fuller or shorter version of the same name ("Muzammal Hussain" / "Muzammal Shahzad Hussain")
  const t = nameTokens(c.client);
  if (t.length >= 2) {
    const xs = narrow(index.list.filter((x) => x.tokens.length >= 2 && (x.tokens.every((w) => t.includes(w)) || t.every((w) => x.tokens.includes(w)))));
    if (xs.length === 1) return { hit: xs[0], how: "similar name" };
    if (xs.length > 1) return { ambiguous: xs, how: "similar name" };
  }
  return null;
}

// ---------------------------------------------------------------- loading
async function loadStudio(log) {
  if (!on()) return { ok: false, why: SETTINGS.USE_PETITION_STUDIO ? "no PETITION_API_KEY secret" : "switched off in config.js" };
  try {
    const rows = await listCases({});
    const probeHits = new Map();
    for (const p of PS_PROBES) {
      try {
        for (const r of await listCases({ ...p.filter, hold: "hide" })) {
          const id = String(pick(r, "case_id", "id") || "");
          if (!id) continue;
          if (!probeHits.has(id)) probeHits.set(id, []);
          probeHits.get(id).push(p);
        }
      } catch (e) { log(`  Petition Studio check "${p.id}" could not run (${e.message})`); }
    }
    log(`Petition Studio: ${rows.length} cases listed`);
    return { ok: true, rows, index: buildIndex(rows), probeHits };
  } catch (e) {
    return { ok: false, why: e.message };
  }
}

// ---------------------------------------------------------------- what it says about one case
// row: the list row; full: the full case record (or null); returns who holds the case and why
function assess(row, full, now) {
  const rec = full && !full.error ? full : {};
  const status = String(pick(rec, "status") || pick(row, "status") || "").toLowerCase();
  const st = PS_STATUS[status] || null;
  const caseId = String(pick(row, "case_id", "id") || pick(rec, "case_id", "id") || "");
  const hold = truthy(pick(row, "hold", "on_hold", "is_on_hold")) || truthy(pick(rec, "hold", "on_hold", "is_on_hold")) || /hold/i.test(String(pick(row, "hold_status") || ""));
  const stage = pick(rec, "stage") || pick(row, "stage") || {};
  const enteredAt = ms(pick(stage, "clock_start_at") || pick(stage, "stage_entered_at") || pick(row, "status_changed_at", "updated_at"));
  let ageHours = Number(pick(stage, "age_hours"));
  if (!Number.isFinite(ageHours) && enteredAt) ageHours = Math.round((now - enteredAt) / HOUR);
  const role = st ? st.owner : null;
  const people = {
    case_manager: personName(pick(row, "case_manager") || pick(rec, "case_manager")),
    petition_writer: personName(pick(row, "petition_writer") || pick(rec, "petition_writer")),
    reviewer: personName(pick(row, "reviewer") || pick(rec, "reviewer")),
    brainstorm_specialist: personName(pick(row, "brainstorm_specialist") || pick(rec, "brainstorm_specialist")),
  };
  const review = pick(rec, "client_review", "clientReview") || {};
  const sentAt = ms(pick(review, "sent_at", "shared_at", "sent"));
  const approvedAt = ms(pick(review, "approved_at", "approved", "approval_date"));
  const findings = [];
  const out = { caseId, status, statusLabel: st ? st.label : (status || "unknown"), rank: st ? st.rank : null, role, ageHours: Number.isFinite(ageHours) ? ageHours : null,
    breachHours: st ? st.breachHours : null, over: false, hold, people, findings, holder: null, link: `${SETTINGS.PETITION_DASHBOARD}?case=${encodeURIComponent(caseId)}` };

  if (PS_CLOSED.includes(status)) { out.holder = { who: "done", why: "filed in Petition Studio" }; return out; }
  if (hold) { out.holder = { who: "paused", why: "on hold in Petition Studio" }; return out; }

  // the stage clock against its limit
  if (st && st.breachHours && out.ageHours != null && out.ageHours >= st.breachHours) {
    out.over = true;
    const since = enteredAt ? enteredAt + st.breachHours * HOUR : now - (out.ageHours - st.breachHours) * HOUR;
    const who = PETITION_TEAM_ROLES.includes(role) ? "petition" : role === "case_manager" ? "cm" : "client";
    out.holder = { who, role, since, why: `${st.label}: ${out.ageHours} business hours in Petition Studio against ${st.breachHours} allowed (${ROLE_LABEL[role] || role}${people[role] ? `: ${people[role]}` : ""})` };
    findings.push({ who, role, text: out.holder.why });
  }
  // the client has the petition and has not approved it
  if (sentAt && !approvedAt && !out.holder) {
    out.holder = { who: "client", role: "client", since: sentAt, why: `The petition was sent to the client for approval on ${new Date(sentAt).toISOString().slice(0, 10)} and is not approved` };
    findings.push({ who: "client", role: "client", text: out.holder.why });
  }
  // the filtered checks
  const hits = (assess.probeHits && assess.probeHits.get(caseId)) || [];
  for (const p of hits) {
    const r = p.owner || role;
    const who = PETITION_TEAM_ROLES.includes(r) ? "petition" : r === "case_manager" ? "cm" : r === "client" ? "client" : null;
    findings.push({ who, role: r, text: `Petition Studio: ${p.text}`, probe: p.id });
    if (!out.holder && who && p.id !== "stale_stage") out.holder = { who, role: r, since: enteredAt || now - 14 * 24 * HOUR, why: `Petition Studio: ${p.text}` };
  }
  if (!out.holder && status === "intake") out.holder = { who: "client", role: "client", since: enteredAt || null, why: "Petition Studio: onboarding and documents, waiting on the client" };
  if (!out.holder && st && PETITION_TEAM_ROLES.includes(role)) out.holder = { who: "petition", role, since: null, within: true, why: `${st.label} in Petition Studio, within its time (${out.ageHours ?? "?"} of ${st.breachHours} business hours)` };
  return out;
}
assess.probeHits = null;

// how far apart the two systems are, in phases (positive = Petition Studio is ahead)
function gap(psRank, phaseKey) {
  const h = PS_RANK_OF_PHASE[phaseKey];
  return psRank == null || h == null ? 0 : psRank - h;
}

// every USA case: match, read the full record, and say what Petition Studio shows
async function checkUSA(usaCases, studio, { now, ownerNames, log }) {
  const results = new Map();
  assess.probeHits = studio.probeHits;
  const matched = [], unmatched = [];
  for (const x of usaCases) {
    const m = matchCase(x.c, studio.index, ownerNames[String(x.c.props.hubspot_owner_id)]);
    if (m && m.hit) matched.push({ x, m });
    else if (m && m.ambiguous) results.set(x.c.id, { found: false, ambiguous: m.ambiguous.map((a) => a.name).slice(0, 4), how: m.how });
    else unmatched.push(x);
  }
  // not in the list: search by email, then by name (the search returns at most 15)
  let looked = 0;
  for (const x of unmatched) {
    if (looked >= SETTINGS.PETITION_SEARCH_LOOKUPS) { results.set(x.c.id, { found: false, why: "not found in the Petition Studio list (search limit reached)" }); continue; }
    if (!x.searchWorthy) { results.set(x.c.id, { found: false, why: "not in Petition Studio" }); continue; }
    looked++;
    let rows = [];
    try { rows = x.c.email ? await searchCases(x.c.email) : []; if (!rows.length) rows = await searchCases(x.c.client); } catch { rows = []; }
    const m = rows.length ? matchCase(x.c, buildIndex(rows), ownerNames[String(x.c.props.hubspot_owner_id)]) : null;
    if (m && m.hit) matched.push({ x, m: { ...m, how: `${m.how}, by search` } });
    else results.set(x.c.id, { found: false, why: "not in Petition Studio", ambiguous: m && m.ambiguous ? m.ambiguous.map((a) => a.name).slice(0, 4) : null });
  }
  const fulls = await mapPool(matched, SETTINGS.PETITION_CONCURRENCY, ({ m }) => getCase(String(pick(m.hit.row, "case_id", "id"))));
  matched.forEach(({ x, m }, i) => {
    const a = assess(m.hit.row, fulls[i], now);
    a.found = true; a.how = m.how; a.name = m.hit.name; a.fullRead = !!(fulls[i] && !fulls[i].error);
    results.set(x.c.id, a);
  });
  log(`Petition Studio: ${matched.length} of ${usaCases.length} USA cases matched (${looked} searched)`);
  return results;
}

module.exports = { loadStudio, checkUSA, assess, matchCase, buildIndex, nameTokens, gap, on, stats, pick };
