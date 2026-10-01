const test = require("node:test");
const assert = require("node:assert/strict");

global.Module = { register: (_name, def) => { global.__mod = def; } };
global.Log = { info: () => {}, warn: () => {}, error: () => {} };
global.config = {};
global.moment = require("moment-timezone");
global.SunCalc = require("suncalc");

// Minimal DOM: elements with parent links so isConnected works like a browser.
const makeEl = (tag) => ({
  tag,
  className: "",
  id: "",
  textContent: "",
  children: [],
  parentNode: null,
  attached: false, // only meaningful on a root node
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  },
  get childNodes() {
    return this.children;
  },
  get isConnected() {
    let n = this;
    while (n.parentNode) n = n.parentNode;
    return n.attached === true;
  }
});
const body = { classList: { toggle() {}, contains() { return false; } } };
global.document = { body, createElement: makeEl, getElementById: () => null };

// Fake lottie that records every player it creates. destroy() clears the container
// like the real thing, so a destroyed visible player means a blank chip.
const players = [];
global.window = {
  matchMedia: () => ({ matches: false }),
  lottie: {
    loadAnimation(opts) {
      assert.ok(opts.container.isConnected, "player created for a detached container");
      const listeners = {};
      const player = {
        opts,
        container: opts.container,
        destroyed: false,
        populated: true,
        playing: !!opts.autoplay,
        totalFrames: 360,
        get isConnected() { return this.container.isConnected; },
        play() { this.playing = true; },
        pause() { this.playing = false; },
        destroy() {
          this.destroyed = true;
          this.populated = false;
          this.playing = false;
        },
        goToAndStop(frame) { this.stoppedAt = frame; this.playing = false; },
        addEventListener(name, fn) { listeners[name] = fn; },
        emit(name) { if (listeners[name]) listeners[name](); }
      };
      players.push(player);
      return player;
    }
  }
};

require("../MMM-GlassClock.js");
const mod = global.__mod;

const makeModule = (cfg = {}) => {
  const ctx = Object.assign({}, mod, {
    name: "MMM-GlassClock",
    identifier: "test",
    config: Object.assign({}, mod.defaults, {
      latitude: 40.7128,
      longitude: -74.006,
      timezone: "America/New_York",
      showSunTimes: true,
      showMoonTimes: true
    }, cfg),
    file: (p) => p,
    updateDom() {},
    sendNotification() {}
  });
  ctx.start();
  clearTimeout(ctx.tickTimer);
  ctx.tickTimer = null;
  return ctx;
};

const hasSeconds = (ctx) => {
  const dom = ctx.getDom();
  const timeRow = dom.children[0].children[0];
  return timeRow.children.some((c) => c.className === "clock-seconds");
};

// Simulates MagicMirror: build the new tree, then swap it in (old detached, new attached).
const swapIn = (ctx, current) => {
  const next = ctx.getDom();
  if (current) current.attached = false;
  next.attached = true;
  ctx._startAnimations();
  return next;
};
const livePlayers = () => players.filter((p) => !p.destroyed);

test.beforeEach(() => {
  players.length = 0;
});

test("seconds render with performanceProfile pi", () => {
  const ctx = makeModule({ performanceProfile: "pi" });
  assert.equal(ctx.renderSeconds, true);
  assert.equal(hasSeconds(ctx), true);
});

test("seconds render with reduceMotion true", () => {
  const ctx = makeModule({ reduceMotion: true });
  assert.equal(ctx.renderSeconds, true);
  assert.equal(hasSeconds(ctx), true);
});

test("seconds depend only on displaySeconds/showTime; tick delay is per-second", () => {
  const ctx = makeModule({ performanceProfile: "pi", reduceMotion: true });
  const realSetTimeout = global.setTimeout;
  let captured = null;
  global.setTimeout = (fn, delay) => { captured = delay; return 0; };
  try {
    ctx.getNow = () => moment.tz("2026-09-28T10:00:10.250", "America/New_York");
    ctx.scheduleTick();
  } finally {
    global.setTimeout = realSetTimeout;
  }
  assert.equal(captured, 1000 - 250 + 25);

  assert.equal(makeModule({ displaySeconds: false }).renderSeconds, false);
  assert.equal(hasSeconds(makeModule({ displaySeconds: false })), false);
  assert.equal(makeModule({ showTime: false }).renderSeconds, false);
});

test("iconAnimation defaults: once on pi, loop on full", () => {
  assert.equal(makeModule({ performanceProfile: "pi" }).iconAnimation, "once");
  assert.equal(makeModule({ performanceProfile: "full" }).iconAnimation, "loop");
});

test("iconAnimation auto resolves from the detected profile", () => {
  Object.defineProperty(global, "navigator", {
    value: { userAgent: "Mozilla/5.0 (X11; Linux aarch64)" },
    configurable: true
  });
  try {
    assert.equal(makeModule({ performanceProfile: "auto" }).iconAnimation, "once");
  } finally {
    delete global.navigator;
  }
  assert.equal(makeModule({ performanceProfile: "auto" }).iconAnimation, "loop");
});

test("explicit iconAnimation wins over profile; reduceMotion forces static", () => {
  assert.equal(makeModule({ performanceProfile: "pi", iconAnimation: "loop" }).iconAnimation, "loop");
  assert.equal(makeModule({ performanceProfile: "full", iconAnimation: "once" }).iconAnimation, "once");
  assert.equal(
    makeModule({ performanceProfile: "full", iconAnimation: "loop", reduceMotion: true }).iconAnimation,
    "static"
  );
  assert.equal(makeModule({ iconAnimation: "bogus", performanceProfile: "full" }).iconAnimation, "loop");
});

test("prefers-reduced-motion forces static icons but keeps seconds", () => {
  const saved = global.window.matchMedia;
  global.window.matchMedia = () => ({ matches: true });
  try {
    const ctx = makeModule({ performanceProfile: "full" });
    assert.equal(ctx.iconAnimation, "static");
    assert.equal(ctx.renderSeconds, true);
  } finally {
    global.window.matchMedia = saved;
  }
});

test("loop mode creates looping autoplay players only after the tree is attached", () => {
  const ctx = makeModule({ iconAnimation: "loop" });
  const dom = ctx.getDom();
  assert.equal(players.length, 0, "no players for an unattached tree");
  dom.attached = true;
  ctx._startAnimations();
  assert.ok(players.length >= 2);
  players.forEach((p) => {
    assert.equal(p.opts.loop, true);
    assert.equal(p.opts.autoplay, true);
  });
  ctx._clearAnimTimer();
});

test("once mode creates players with loop:false", () => {
  const ctx = makeModule({ iconAnimation: "once" });
  swapIn(ctx, null);
  assert.ok(players.length >= 2);
  players.forEach((p) => {
    assert.equal(p.opts.loop, false);
    assert.equal(p.opts.autoplay, true);
  });
  ctx._clearAnimTimer();
});

test("static mode never plays and parks on a single frame", () => {
  const ctx = makeModule({ iconAnimation: "static" });
  swapIn(ctx, null);
  assert.ok(players.length >= 2);
  players.forEach((p) => {
    assert.equal(p.opts.loop, false);
    assert.equal(p.opts.autoplay, false);
    assert.equal(p.playing, false);
    p.emit("DOMLoaded");
    assert.equal(p.stoppedAt, 359);
  });
  ctx.suspend();
  ctx.resume();
  ctx._startAnimations();
  clearTimeout(ctx.tickTimer);
  ctx._clearAnimTimer();
  players.forEach((p) => assert.equal(p.playing, false));
});

test("normal swap: old players live until the new tree attaches, then are destroyed (no blink)", () => {
  const ctx = makeModule({ iconAnimation: "loop" });
  const first = swapIn(ctx, null);
  const perRender = livePlayers().length;
  const second = ctx.getDom(); // new tree built, old still on screen
  assert.equal(livePlayers().length, perRender);
  livePlayers().forEach((p) => assert.equal(p.populated, true));
  assert.equal(players.length, perRender, "no new players before the new tree attaches");
  first.attached = false;
  second.attached = true;
  ctx._startAnimations();
  assert.equal(livePlayers().length, perRender);
  assert.equal(players.filter((p) => p.destroyed).length, perRender);
  livePlayers().forEach((p) => assert.equal(p.isConnected, true));
  ctx._clearAnimTimer();
});

test("skipped swap: chips stay populated and no off-screen players are created", () => {
  const ctx = makeModule({ iconAnimation: "loop" });
  swapIn(ctx, null);
  const perRender = livePlayers().length;
  ctx.getDom(); // MagicMirror discards this tree (identical markup)
  ctx._startAnimations();
  assert.equal(players.length, perRender);
  assert.equal(livePlayers().length, perRender);
  livePlayers().forEach((p) => {
    assert.equal(p.populated, true);
    assert.equal(p.isConnected, true);
  });
  ctx._clearAnimTimer();
});

// Drives the real MM 2.33 startup sequence (see qa2-startup-sim.js) using only
// getDom() and notifications. Timers are faked so the poll runs deterministically.
const withFakeTimers = (fn) => {
  const realSet = global.setTimeout;
  const realClear = global.clearTimeout;
  const timers = new Map();
  let seq = 0;
  global.setTimeout = (cb) => { timers.set(++seq, cb); return seq; };
  global.clearTimeout = (id) => { timers.delete(id); };
  const runTimers = () => {
    const due = Array.from(timers.entries());
    timers.clear();
    due.forEach(([, cb]) => cb());
  };
  try {
    fn(runTimers, timers);
  } finally {
    global.setTimeout = realSet;
    global.clearTimeout = realClear;
  }
};

test("startup (current MM ordering): discarded render, then attached render + DOM_CREATED; no duplicates", () => {
  withFakeTimers((runTimers) => {
    const ctx = makeModule({ iconAnimation: "once" });
    ctx.getDom(); // start(): updateDom(300), skipped (no wrapper yet)
    const second = ctx.getDom(); // modulesStarted: updateDom(0) swaps in
    ctx.notificationReceived("MODULE_DOM_UPDATED"); // late notification of the discarded render
    second.attached = true;
    ctx.notificationReceived("MODULE_DOM_CREATED");
    runTimers();
    const containers = livePlayers().map((p) => p.container);
    assert.ok(containers.length >= 2);
    assert.equal(new Set(containers).size, containers.length);
    assert.equal(players.length, containers.length);
    livePlayers().forEach((p) => assert.equal(p.isConnected, true));
  });
});

test("startup with only MODULE_DOM_CREATED delivered (async start): players still bind", () => {
  withFakeTimers((runTimers) => {
    const ctx = makeModule({ iconAnimation: "once" });
    const dom = ctx.getDom(); // updateDom(0) from modulesStarted; swap not yet attached
    assert.equal(players.length, 0);
    dom.attached = true;
    ctx.notificationReceived("MODULE_DOM_CREATED");
    assert.ok(livePlayers().length >= 2);
    runTimers();
    assert.equal(livePlayers().length, players.length);
  });
});

test("startup with no notification at all: bounded poll from getDom binds once attached", () => {
  withFakeTimers((runTimers) => {
    const ctx = makeModule({ iconAnimation: "once" });
    const dom = ctx.getDom();
    assert.equal(players.length, 0);
    dom.attached = true;
    runTimers();
    assert.ok(livePlayers().length >= 2);
  });
});

test("once players never replay after finishing, even across polls and notifications", () => {
  withFakeTimers((runTimers) => {
    const ctx = makeModule({ iconAnimation: "once" });
    const dom = ctx.getDom();
    dom.attached = true;
    ctx.notificationReceived("MODULE_DOM_CREATED");
    livePlayers().forEach((p) => { p.emit("complete"); p.playing = false; });
    ctx.notificationReceived("MODULE_DOM_UPDATED");
    runTimers();
    ctx.resume();
    livePlayers().forEach((p) => assert.equal(p.playing, false));
  });
});

test("poll gives up with a single warning when containers never attach", () => {
  withFakeTimers((runTimers, timers) => {
    const warnings = [];
    const savedWarn = global.Log.warn;
    global.Log.warn = (m) => warnings.push(m);
    try {
      const ctx = makeModule({ iconAnimation: "loop" });
      ctx.getDom(); // never attached
      for (let i = 0; i < 60; i++) runTimers();
      assert.equal(timers.size, 0);
      assert.equal(livePlayers().length, 0);
      assert.equal(warnings.filter((w) => w.includes("Gave up")).length, 1);
    } finally {
      global.Log.warn = savedWarn;
    }
  });
});

test("no duplicate players after repeated swaps", () => {
  const ctx = makeModule({ iconAnimation: "loop" });
  let cur = swapIn(ctx, null);
  const perRender = livePlayers().length;
  for (let i = 0; i < 5; i++) cur = swapIn(ctx, cur);
  assert.equal(livePlayers().length, perRender);
  assert.equal(ctx.lottieInstances.length, perRender);
  ctx._clearAnimTimer();
});

test("re-render dropping chips (moon alwaysUp) reaps their players after swap", () => {
  const ctx = makeModule({ iconAnimation: "loop" });
  const cur = swapIn(ctx, null);
  const before = livePlayers().length;
  ctx.moonTimes = { alwaysUp: true };
  swapIn(ctx, cur);
  assert.ok(livePlayers().length < before);
  assert.equal(livePlayers().length, ctx.lottieInstances.length);
  livePlayers().forEach((p) => assert.equal(p.isConnected, true));
  ctx._clearAnimTimer();
});

test("day rollover re-render swaps without leaking players", () => {
  const ctx = makeModule({ iconAnimation: "loop" });
  let cur = null;
  ctx.updateDom = function () { cur = swapIn(this, cur); };
  const days = ["2026-09-28T23:59:59", "2026-09-29T00:00:01", "2026-09-30T00:00:01"];
  const realSetTimeout = global.setTimeout;
  global.setTimeout = () => 0;
  try {
    days.forEach((d) => {
      ctx.getNow = () => moment.tz(d, "America/New_York");
      ctx.scheduleTick();
    });
  } finally {
    global.setTimeout = realSetTimeout;
  }
  assert.ok(livePlayers().length <= 4);
  assert.equal(livePlayers().length, ctx.lottieInstances.length);
});

test("MODULE_DOM_UPDATED binds players to the attached tree", () => {
  const ctx = makeModule({ iconAnimation: "once" });
  const dom = ctx.getDom();
  dom.attached = true;
  ctx.notificationReceived("MODULE_DOM_UPDATED");
  assert.ok(livePlayers().length >= 2);
  ctx._clearAnimTimer();
});

test("a throwing destroy() is contained", () => {
  const ctx = makeModule({ iconAnimation: "loop" });
  const cur = swapIn(ctx, null);
  players.forEach((p) => { p.destroy = () => { throw new Error("boom"); }; });
  assert.doesNotThrow(() => swapIn(ctx, cur));
  ctx._clearAnimTimer();
});

test("suspend pauses and blocks creation; resume plays only unfinished once-players", () => {
  const ctx = makeModule({ iconAnimation: "once" });
  swapIn(ctx, null);
  const live = livePlayers();
  live[0].emit("complete");
  ctx.suspend();
  assert.equal(ctx.tickTimer, null);
  live.forEach((p) => assert.equal(p.playing, false));
  const count = players.length;
  const dom = ctx.getDom();
  dom.attached = true;
  ctx._startAnimations();
  assert.equal(players.length, count, "no players created while suspended");
  ctx.resume();
  clearTimeout(ctx.tickTimer);
  ctx._clearAnimTimer();
  assert.equal(live[0].playing, false);
  assert.equal(live[1].playing, true);
});
