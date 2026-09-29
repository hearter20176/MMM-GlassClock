const test = require("node:test");
const assert = require("node:assert/strict");

// Capture the module definition by overriding Module.register before require,
// matching the pattern used by MMM-HomeAssistantStatusDashboard's tests.
global.Module = { register: (_name, def) => { global.__mod = def; } };
global.Log = { info: () => {}, warn: () => {}, error: () => {} };
global.config = {};
global.moment = require("moment-timezone");
global.SunCalc = require("suncalc");

// Minimal document/body stub with a classList supporting toggle()/contains(),
// enough for applyPageTheme's mm-day/mm-night bookkeeping.
const makeClassList = (owner) => ({
  toggle(name, force) {
    const has = owner.classes.has(name);
    const shouldHave = force === undefined ? !has : force;
    if (shouldHave) owner.classes.add(name);
    else owner.classes.delete(name);
    return shouldHave;
  },
  contains(name) {
    return owner.classes.has(name);
  }
});
const body = { classes: new Set() };
body.classList = makeClassList(body);
Object.defineProperty(body, "className", {
  get() {
    return Array.from(body.classes).join(" ");
  },
  set(value) {
    body.classes = new Set(value ? value.split(/\s+/).filter(Boolean) : []);
  }
});
global.document = { body };

require("../MMM-GlassClock.js");
const mod = global.__mod;

const LAT = 40.7128;
const LON = -74.006;
const TZ = "America/New_York";

const makeContext = (overrides = {}) =>
  Object.assign(
    {
      config: { latitude: LAT, longitude: LON, themeClass: true, themeOverride: null },
      sunTimes: null,
      moonTimes: null,
      lastCalcDate: null,
      lastThemeMode: null,
      sendNotification(notification, payload) {
        this.notifications = this.notifications || [];
        this.notifications.push({ notification, payload });
      }
    },
    overrides
  );

// A stand-in for the plain-Date fallback object getNow() returns when moment
// is unavailable: only format/milliseconds/seconds/toDate exist, no
// clone/valueOf/hours.
const makeFallbackNow = (date) => ({
  format: (fmt) => {
    if (fmt === "YYYY-MM-DD") {
      const pad = (n) => String(n).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }
    return date.toISOString();
  },
  milliseconds: () => date.getMilliseconds(),
  seconds: () => date.getSeconds(),
  toDate: () => date
});

test("updateSunAndMoonTimes: 00:00:30 local tick resolves to sun times for the SAME calendar date", () => {
  const ctx = makeContext();
  const tick = moment.tz("2026-09-28T00:00:30", TZ);

  mod.updateSunAndMoonTimes.call(ctx, tick);

  assert.ok(ctx.sunTimes, "sunTimes should be populated");
  const sunriseDateKey = moment.tz(ctx.sunTimes.sunrise, TZ).format("YYYY-MM-DD");
  const sunsetDateKey = moment.tz(ctx.sunTimes.sunset, TZ).format("YYYY-MM-DD");
  assert.equal(sunriseDateKey, "2026-09-28");
  assert.equal(sunsetDateKey, "2026-09-28");
});

test("applyPageTheme: day at 10:00 local, night at 21:00 local, using SAME-day sun times", () => {
  const ctx = makeContext();
  document.body.className = "";

  // Seed sun times via the same anchored calculation used at the 00:00:30 tick.
  mod.updateSunAndMoonTimes.call(ctx, moment.tz("2026-09-28T00:00:30", TZ));

  mod.applyPageTheme.call(ctx, moment.tz("2026-09-28T10:00:00", TZ));
  assert.equal(document.body.classList.contains("mm-day"), true);
  assert.equal(document.body.classList.contains("mm-night"), false);

  mod.applyPageTheme.call(ctx, moment.tz("2026-09-28T21:00:00", TZ));
  assert.equal(document.body.classList.contains("mm-day"), false);
  assert.equal(document.body.classList.contains("mm-night"), true);
});

test("contract: the page-theme notification name is exactly PAGE_THEME_CHANGED (MMM-GlassCalendar and MMM-GlassDailyCalendar both listen for this literal string; renaming it silently breaks both)", () => {
  const ctx = makeContext();
  mod.applyPageTheme.call(ctx, moment.tz("2026-09-28T10:00:00", TZ));
  assert.equal(ctx.notifications.length, 1);
  assert.equal(ctx.notifications[0].notification, "PAGE_THEME_CHANGED");
});

test("applyPageTheme: sends PAGE_THEME_CHANGED once at startup and only again on an actual change", () => {
  const ctx = makeContext();
  mod.updateSunAndMoonTimes.call(ctx, moment.tz("2026-09-28T00:00:30", TZ));

  mod.applyPageTheme.call(ctx, moment.tz("2026-09-28T10:00:00", TZ));
  assert.equal(ctx.notifications.length, 1);
  assert.deepEqual(ctx.notifications[0], {
    notification: "PAGE_THEME_CHANGED",
    payload: { mode: "day" }
  });

  // Still daytime a few minutes later: no additional notification.
  mod.applyPageTheme.call(ctx, moment.tz("2026-09-28T10:05:00", TZ));
  assert.equal(ctx.notifications.length, 1);

  // Transition to night: exactly one more notification.
  mod.applyPageTheme.call(ctx, moment.tz("2026-09-28T21:00:00", TZ));
  assert.equal(ctx.notifications.length, 2);
  assert.deepEqual(ctx.notifications[1], {
    notification: "PAGE_THEME_CHANGED",
    payload: { mode: "night" }
  });
});

test("applyPageTheme: hour fallback (no sun times) uses the moment's own hour, not the system-local hour", () => {
  const ctx = makeContext({ sunTimes: null, moonTimes: null });

  // moment.tz gives 22:00 in Los Angeles; the plain JS Date wrapping that same
  // instant reports whatever hour the TEST RUNNER's system clock is in
  // (typically a different value). Using nowMoment.hours() must give 22
  // (night) regardless of the system timezone.
  const laNight = moment.tz("2026-09-28T22:00:00", "America/Los_Angeles");
  mod.applyPageTheme.call(ctx, laNight);
  assert.equal(document.body.classList.contains("mm-night"), true);
  assert.equal(document.body.classList.contains("mm-day"), false);
});

test("notificationReceived: re-sends PAGE_THEME_CHANGED on ALL_MODULES_STARTED so late subscribers get startup state", () => {
  const ctx = makeContext({ lastThemeMode: "day" });
  mod.notificationReceived.call(ctx, "ALL_MODULES_STARTED", null, ctx);
  assert.equal(ctx.notifications.length, 1);
  assert.deepEqual(ctx.notifications[0], {
    notification: "PAGE_THEME_CHANGED",
    payload: { mode: "day" }
  });
});

test("notificationReceived: does nothing on ALL_MODULES_STARTED if no theme has been computed yet", () => {
  const ctx = makeContext({ lastThemeMode: null });
  mod.notificationReceived.call(ctx, "ALL_MODULES_STARTED", null, ctx);
  assert.equal((ctx.notifications || []).length, 0);
});

test("applyPageTheme: plain-Date fallback (no moment) does not throw and still resolves day/night", () => {
  const ctx = makeContext({ sunTimes: null, moonTimes: null });

  const dayDate = new Date(2026, 8, 28, 10, 0, 0);
  assert.doesNotThrow(() => mod.applyPageTheme.call(ctx, makeFallbackNow(dayDate)));
  assert.equal(document.body.classList.contains("mm-day"), true);

  const nightDate = new Date(2026, 8, 28, 21, 0, 0);
  assert.doesNotThrow(() => mod.applyPageTheme.call(ctx, makeFallbackNow(nightDate)));
  assert.equal(document.body.classList.contains("mm-night"), true);
});

test("updateSunAndMoonTimes: plain-Date fallback (no clone) does not throw", () => {
  const ctx = makeContext();
  const fallbackNow = makeFallbackNow(new Date(2026, 8, 28, 0, 0, 30));
  assert.doesNotThrow(() => mod.updateSunAndMoonTimes.call(ctx, fallbackNow));
  assert.ok(ctx.sunTimes);
});
