// 9-whatsapp.js — did the team answer, or follow up, on WhatsApp instead?
//
// Case managers text clients in Chatwoot. Before a client email is called unanswered, or a
// stretch with no follow-up is called a gap, Chatwoot is checked for a message from the team
// to that client. It can only ever clear someone: nothing found there counts against anyone.
const { SETTINGS } = require("./config");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0, ACC = null;
const cache = new Map();
const stats = { looked: 0, matched: 0, messages: 0, errors: 0 };
const on = () => SETTINGS.USE_WHATSAPP && !!process.env.CHATWOOT_TOKEN;

async function cw(path) {
  const wait = last + 200 - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const res = await fetch(SETTINGS.CHATWOOT_URL.replace(/\/+$/, "") + path, { headers: { api_access_token: process.env.CHATWOOT_TOKEN, Accept: "application/json" } });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  const t = await res.text();
  if (t.trim().startsWith("<")) throw new Error("Chatwoot returned a web page; check CHATWOOT_URL");
  return JSON.parse(t);
}
const toMs = (v) => typeof v === "number" ? (v > 1e12 ? v : v * 1000) : (/^\d+$/.test(String(v)) ? Number(v) * 1000 : Date.parse(v) || 0);

async function account() {
  if (ACC) return ACC;
  if (SETTINGS.CHATWOOT_ACCOUNT_ID) return (ACC = SETTINGS.CHATWOOT_ACCOUNT_ID);
  const me = await cw("/api/v1/profile");
  return (ACC = (me.accounts && me.accounts[0] && me.accounts[0].id) || null);
}

// every message the team sent this client on WhatsApp since `sinceMs`, found by phone number.
// null = could not be checked
async function staffMessages(phone, sinceMs) {
  const digits = String(phone || "").split("/")[0].replace(/\D/g, "");
  if (digits.length < 9) return [];
  const key = digits.slice(-9);
  if (cache.has(key)) return cache.get(key);
  stats.looked++;
  let times = [];
  try {
    const acc = await account();
    const found = await cw(`/api/v1/accounts/${acc}/contacts/search?q=${encodeURIComponent(key)}`);
    const contacts = (found.payload || []).filter((c) => String(c.phone_number || "").replace(/\D/g, "").endsWith(key));
    if (contacts.length) stats.matched++;
    for (const c of contacts.slice(0, 2)) {
      const convs = await cw(`/api/v1/accounts/${acc}/contacts/${c.id}/conversations`);
      for (const conv of (convs.payload || []).slice(0, 6)) {
        let r = await cw(`/api/v1/accounts/${acc}/conversations/${conv.id}/messages`);
        let batch = r.payload || [];
        const all = [...batch];
        for (let i = 0; i < 40 && batch.length; i++) {
          const oldest = batch.reduce((a, m) => (!a || m.id < a.id ? m : a), null);
          if (!oldest || toMs(oldest.created_at) < sinceMs) break;
          r = await cw(`/api/v1/accounts/${acc}/conversations/${conv.id}/messages?before=${oldest.id}`);
          batch = r.payload || [];
          all.push(...batch);
        }
        for (const m of all) {
          const out = String(m.message_type) === "1" || m.message_type === "outgoing";
          const bot = /agentbot|captain/i.test(String(m.sender_type || ""));
          const t = toMs(m.created_at);
          if (out && !m.private && !bot && t >= sinceMs) times.push(t);
        }
      }
    }
    stats.messages += times.length;
  } catch { stats.errors++; times = null; }
  cache.set(key, times);
  return times;
}

module.exports = { staffMessages, stats, whatsappOn: on };
