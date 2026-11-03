// 1-clock.js — time. The working-hour clock (weekends and UAE holidays paused), deadlines,
// and how dates are written. No network in here, so every rule is tested on invented dates.
const { SETTINGS } = require("./config");

const MIN = 60e3, HOUR = 3600e3, DAY = 24 * HOUR;
const OFF = SETTINGS.TZ_OFFSET_HOURS * HOUR;
const dayStart = (t) => Math.floor((t + OFF) / DAY) * DAY - OFF;   // midnight, Pakistan time
const dateKey = (t) => new Date(t + OFF).toISOString().slice(0, 10);
const weekday = (t) => new Date(t + OFF).getUTCDay();
const localHour = (t) => new Date(t + OFF).getUTCHours();
const pad = (n) => String(n).padStart(2, "0");

let NOW = Date.now();
const setNow = (t) => { NOW = t; };
const now = () => NOW;

function makeClock(holidays = SETTINGS.HOLIDAYS) {
  const off = new Set(holidays || []);
  const isWorkingDay = (t) => !SETTINGS.WEEKEND_DAYS.includes(weekday(t)) && !off.has(dateKey(t));
  const nextWorkingDayFrom = (d) => { let x = d; for (let i = 0; i < 60 && !isWorkingDay(x); i++) x += DAY; return x; };

  // `hours` of working time after t. Friday 3pm + 24 -> Monday 3pm.
  function deadline(t, hours = 24) {
    let cursor = isWorkingDay(t) ? t : nextWorkingDayFrom(dayStart(t) + DAY);
    let remaining = hours * HOUR;
    for (let i = 0; i < 2000; i++) {
      const end = dayStart(cursor) + DAY;
      if (end - cursor >= remaining) return cursor + remaining;
      remaining -= end - cursor;
      cursor = nextWorkingDayFrom(end);
    }
    return cursor;
  }

  // a call request: by the end of the same working day, or of the next one if it came after
  // the cut-off or on a day off
  function sameWorkingDay(t) {
    let d = dayStart(t);
    if (!isWorkingDay(t) || localHour(t) >= SETTINGS.CALL_SAME_DAY_CUTOFF_HOUR) d = nextWorkingDayFrom(d + DAY);
    return d + DAY;
  }

  // a promise: the time named, or the end of the day named. A day off moves to the end of
  // the next working day, and the report says so.
  function promiseDeadline(dateStr, timeStr) {
    const m = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const start = Date.UTC(+m[1], +m[2] - 1, +m[3]) - OFF;
    if (!isWorkingDay(start)) return { due: nextWorkingDayFrom(start) + DAY, moved: true };
    const tm = String(timeStr || "").match(/^(\d{1,2}):(\d{2})$/);
    if (tm) return { due: start + +tm[1] * HOUR + +tm[2] * MIN, moved: false };
    return { due: start + DAY, moved: false };
  }

  // a task: by the end of the day it was due (a due day that is a day off moves on)
  const endOfDay = (t) => (isWorkingDay(t) ? dayStart(t) + DAY : nextWorkingDayFrom(dayStart(t) + DAY) + DAY);

  // working time between two moments, in ms
  function workingBetween(a, b) {
    if (!(b > a)) return 0;
    let total = 0;
    for (let d = dayStart(a), i = 0; d < b && i < 4000; d += DAY, i++) {
      if (!isWorkingDay(d)) continue;
      const s = Math.max(a, d), e = Math.min(b, d + DAY);
      if (e > s) total += e - s;
    }
    return total;
  }
  const workingDaysBetween = (a, b) => workingBetween(a, b) / DAY;

  return { isWorkingDay, deadline, sameWorkingDay, promiseDeadline, endOfDay, workingBetween, workingDaysBetween };
}

// ---- reading HubSpot dates ----
function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if (new Date(t).getUTCDate() !== +m[3]) return null;
  return t - OFF;
}
const ms = (v) => {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (/^\d{10,}$/.test(s)) return Number(s);
  return Date.parse(s) || 0;
};

// ---- wording ----
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const yearOf = (t) => new Date(t + OFF).getUTCFullYear();
// "Tue 14 Oct, 15:20" (the year is added when it is not this year)
const fmtWhen = (t) => {
  if (!t) return "";
  const d = new Date(t + OFF);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${yearOf(t) !== yearOf(NOW) ? ` ${d.getUTCFullYear()}` : ""}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
// "14 Oct 2026"
const fmtDay = (t) => { if (!t) return ""; const d = new Date(t + OFF); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
// "14 Oct", or "14 Oct 2025" when the year is not this one
const fmtShort = (t) => { if (!t) return ""; const d = new Date(t + OFF); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${yearOf(t) !== yearOf(NOW) ? ` ${d.getUTCFullYear()}` : ""}`; };
// an end-of-day deadline reads better as "end of Tue 15 Sep" than "Wed 16 Sep, 00:00"
const fmtDue = (t) => (t === dayStart(t) ? `end of ${fmtWhen(t - 1).replace(/, \d\d:\d\d$/, "")}` : fmtWhen(t));
const hrs = (x) => Math.max(0, Math.round(x / HOUR));
const days = (x) => Math.max(0, Math.round(x / DAY));
const days1 = (x) => Math.max(0, Math.round((10 * x) / DAY) / 10);
const span = (x) => {
  const h = hrs(x);
  if (h < 48) return `${h} hr${h === 1 ? "" : "s"}`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
};
const num = (n) => (typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-US") : String(n));
const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
// a JS date whose UTC reading is Pakistan wall time, for Excel cells
const xlDate = (t) => (t ? new Date(t + OFF) : null);
// how many days from `from` to `to` (both included, Pakistan time) are in `set` of "YYYY-MM-DD"
const daysIn = (set, from, to) => {
  if (!set || !set.size || from == null) return 0;
  const end = Math.min(Math.max(from, to == null ? from : to), from + 400 * DAY);
  let n = 0;
  for (let t = dayStart(from); t <= end; t += DAY) if (set.has(dateKey(t))) n++;
  return n;
};

module.exports = { makeClock, parseDay, ms, fmtWhen, fmtDay, fmtShort, fmtDue, hrs, days, days1, span, plural, num, xlDate, daysIn,
  dayStart, dateKey, localHour, setNow, now, MIN, HOUR, DAY, OFF, MONTHS, MONTHS_LONG };
