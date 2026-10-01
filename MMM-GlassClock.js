/* MMM-GlassClock
 * Liquid glass clock for MagicMirror
 *
 * Matches the aesthetic of MMM-AmbientWeather, MMM-MyAgenda, MMM-GlassCalendar, and MMM-GlassDailyCalendar.
 */

/* global Module, Log, moment, SunCalc, config */

Module.register("MMM-GlassClock", {
  // ---------------------------------------------------------------------------
  // Defaults
  // ---------------------------------------------------------------------------
  defaults: {
    timeformat: config.timeFormat || 24,
    timezone: config.timezone || null,
    displaySeconds: true,
    showPeriod: true,
    showPeriodUpper: false,
    showTime: true,
    showDate: true,
    showSunTimes: false,
    showMoonTimes: false,
    latitude: null,
    longitude: null,
    dateFormat: "dddd, MMMM Do",
    animationSpeed: 300,
    performanceProfile: "auto", // auto | pi | full
    reduceMotion: false,
    // Sun/moon chip icons: "auto" | "loop" | "once" | "static".
    // auto = "once" on the pi profile, "loop" on full. reduceMotion forces "static".
    // Independent of displaySeconds: the ticking seconds are never affected.
    iconAnimation: "auto",
    // Mark <body> with mm-day / mm-night from sunrise/sunset so the page theme
    // (css/custom.css) can switch palettes. themeOverride: "day" | "night" forces one.
    themeClass: true,
    themeOverride: null
  },

  // ---------------------------------------------------------------------------
  // Assets
  // ---------------------------------------------------------------------------
  getScripts() {
    return [
      this.file("node_modules/moment/min/moment-with-locales.min.js"),
      this.file(
        "node_modules/moment-timezone/builds/moment-timezone-with-data.min.js"
      ),
      this.file("vendor/lottie.min.js"),
      this.file("node_modules/suncalc/suncalc.js")
    ];
  },

  getStyles() {
    return ["MMM-GlassClock.css"];
  },

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  start() {
    Log.info(`Starting module: ${this.name}`);

    this.now = null;
    this.sunTimes = null;
    this.moonTimes = null;
    this.lastCalcDate = null;
    this.lastThemeMode = null;
    this.tickTimer = null;
    this.rendered = false;
    this.lastRenderedDay = null;
    this.lottieInstances = [];
    this.pendingAnims = [];
    this.renderGen = 0;
    this.animTimer = null;
    this.suspended = false;
    this.tzWarned = false;
    this.momentWithTz =
      typeof moment === "function" && typeof moment.tz === "function"
        ? moment
        : null;
    this.momentTzRequested = false;
    this.performanceProfile = this.resolvePerformanceProfile();
    // reduceMotion only affects decorative icon animation; a ticking digit is
    // not decorative motion, so seconds depend solely on displaySeconds/showTime.
    this.reduceMotion =
      this.config.reduceMotion === true ||
      !!(
        typeof window !== "undefined" &&
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      );
    this.renderSeconds = !!(this.config.displaySeconds && this.config.showTime);
    this.iconAnimation = this.resolveIconAnimation();
    // "static" still draws one Lottie frame (no non-Lottie fallback exists),
    // so the Lottie library is used in every mode.
    this.enableLottie = true;

    this.ensureMomentTimezone();
    moment.locale(config.language || "en");
    this.scheduleTick();
  },

  suspend() {
    clearTimeout(this.tickTimer);
    this.tickTimer = null;
    this.suspended = true;
    this._pauseAnimations();
  },

  resume() {
    this.suspended = false;
    this._startAnimations();
    this.scheduleTick();
  },

  // ---------------------------------------------------------------------------
  // Core helpers
  // ---------------------------------------------------------------------------
  ensureMomentTimezone() {
    // If tz already exists, cache it and return.
    if (typeof moment === "function" && typeof moment.tz === "function") {
      this.momentWithTz = moment;
      return;
    }

    // Attempt to inject the timezone build once if it's missing.
    if (!this.momentTzRequested) {
      this.momentTzRequested = true;
      const script = document.createElement("script");
      script.src = this.file(
        "node_modules/moment-timezone/builds/moment-timezone-with-data.min.js"
      );
      script.onload = () => {
        if (typeof moment === "function" && typeof moment.tz === "function") {
          this.momentWithTz = moment;
          this.tzWarned = false;
        }
      };
      script.onerror = () => {
        Log.error("[MMM-GlassClock] Failed to load moment-timezone build.");
      };
      document.body.appendChild(script);
    }
  },

  getMomentLib() {
    const globalMoment = typeof moment === "function" ? moment : null;

    // If the current global moment already has timezone support, prefer it.
    if (globalMoment && typeof globalMoment.tz === "function") {
      this.momentWithTz = globalMoment;
      return globalMoment;
    }

    // If timezone support was lost (because another module reloaded moment),
    // fall back to the cached instance that still has moment-timezone attached.
    if (
      this.momentWithTz &&
      typeof this.momentWithTz.tz === "function" &&
      typeof this.momentWithTz === "function"
    ) {
      if (!this.tzWarned) {
        Log.warn(
          "[MMM-GlassClock] Restoring moment-timezone instance; another module reloaded moment without tz support."
        );
        this.tzWarned = true;
      }
      return this.momentWithTz;
    }

    return globalMoment;
  },

  scheduleTick() {
    const current = this.getNow();
    this.now = current;

    const timeParts = this.formatClockTime(current);
    this.updateSunAndMoonTimes(current);
    this.applyPageTheme(current);

    const dayKey = current.format("YYYY-MM-DD");
    const needsFullRender = !this.rendered || dayKey !== this.lastRenderedDay;

    if (needsFullRender) {
      this.lastRenderedDay = dayKey;
      this.updateDom(this.config.animationSpeed);
      this.rendered = true;
    } else {
      this.updateTimeDom(timeParts);
    }

    const millis = current.milliseconds();
    const seconds = current.seconds();
    const delay = this.renderSeconds
      ? 1000 - millis + 25
      : (60 - seconds) * 1000 - millis + 25;

    clearTimeout(this.tickTimer);
    this.tickTimer = setTimeout(() => this.scheduleTick(), delay);
  },

  getNow() {
    const momentLib = this.getMomentLib();
    if (!momentLib || typeof momentLib !== "function") {
      Log.error("[MMM-GlassClock] moment is not available; falling back to Date().");
      const nowDate = new Date();
      const pad = (num) => String(num).padStart(2, "0");
      return {
        format: (fmt) => {
          const hours24 = nowDate.getHours();
          switch (fmt) {
            case "YYYY-MM-DD":
              return `${nowDate.getFullYear()}-${pad(
                nowDate.getMonth() + 1
              )}-${pad(nowDate.getDate())}`;
            case "h":
              return String(((hours24 + 11) % 12) + 1);
            case "HH":
              return pad(hours24);
            case "mm":
              return pad(nowDate.getMinutes());
            case "ss":
              return pad(nowDate.getSeconds());
            case "A":
              return hours24 >= 12 ? "PM" : "AM";
            case "a":
              return hours24 >= 12 ? "pm" : "am";
            default:
              return nowDate.toISOString();
          }
        },
        milliseconds: () => nowDate.getMilliseconds(),
        seconds: () => nowDate.getSeconds(),
        toDate: () => nowDate
      };
    }

    const tz = this.config.timezone || this.config.timeZone || null;
    if (tz && typeof momentLib.tz !== "function") {
      this.ensureMomentTimezone();
      if (!this.tzWarned) {
        Log.warn(
          "[MMM-GlassClock] moment-timezone is missing; using local time instead of configured timezone."
        );
        this.tzWarned = true;
      }
      return momentLib();
    }

    return tz && typeof momentLib.tz === "function"
      ? momentLib().tz(tz)
      : momentLib();
  },

  getTimeFormat() {
    const fmt = this.config.timeformat || this.config.timeFormat || 24;
    return fmt === 12 || fmt === "12" ? 12 : 24;
  },

  updateSunAndMoonTimes(currentMoment) {
    const lat =
      this.config.latitude !== null && this.config.latitude !== undefined
        ? this.config.latitude
        : this.config.lat;
    const lon =
      this.config.longitude !== null && this.config.longitude !== undefined
        ? this.config.longitude
        : this.config.lon;

    const hasCoords =
      lat !== null &&
      lat !== undefined &&
      lon !== null &&
      lon !== undefined &&
      !Number.isNaN(lat) &&
      !Number.isNaN(lon);

    const dateKey = currentMoment ? currentMoment.format("YYYY-MM-DD") : null;
    if (!hasCoords) {
      this.sunTimes = null;
      this.moonTimes = null;
      this.lastCalcDate = dateKey;
      return;
    }

    if (this.lastCalcDate === dateKey) {
      return;
    }

    try {
      // Anchor the calculation at local noon of the current calendar date rather
      // than "now". SunCalc.getTimes() returns the solar transit NEAREST the
      // instant it's given; right after local midnight that instant is still
      // close to the UTC day boundary and can resolve to YESTERDAY's transit
      // (e.g. 00:00 EDT is 04:00 UTC). Anchoring at noon guarantees the transit
      // used is the one for this date, regardless of UTC offset.
      const baseDate =
        typeof currentMoment.clone === "function"
          ? currentMoment
              .clone()
              .hour(12)
              .minute(0)
              .second(0)
              .millisecond(0)
              .toDate()
          : currentMoment.toDate();
      this.sunTimes = SunCalc.getTimes(baseDate, lat, lon);
      this.moonTimes = SunCalc.getMoonTimes(baseDate, lat, lon);
      this.lastCalcDate = dateKey;
    } catch (error) {
      Log.error(`[MMM-GlassClock] Failed to calculate sun/moon times: ${error}`);
      this.sunTimes = null;
      this.moonTimes = null;
    }
  },

  applyPageTheme(nowMoment) {
    if (!this.config.themeClass || typeof document === "undefined" || !document.body) return;
    let isDay;
    const forced = this.config.themeOverride;
    if (forced === "day" || forced === "night") {
      isDay = forced === "day";
    } else if (this.sunTimes && this.sunTimes.sunrise && this.sunTimes.sunset) {
      // Use toDate()/getTime() rather than moment-only accessors (valueOf/hours)
      // so this also works with the plain-Date fallback object getNow() returns
      // when moment isn't available.
      const t = nowMoment.toDate().getTime();
      isDay = t >= this.sunTimes.sunrise.getTime() && t < this.sunTimes.sunset.getTime();
    } else {
      // Prefer the moment's own hour (honours config.timezone via moment-tz)
      // over toDate().getHours(), which reports the SYSTEM-local hour. Only
      // fall back to toDate().getHours() for the plain-Date fallback object
      // getNow() returns when moment itself isn't available.
      const hour =
        typeof nowMoment.hours === "function"
          ? nowMoment.hours()
          : nowMoment.toDate().getHours();
      isDay = hour >= 7 && hour < 19;
    }

    const mode = isDay ? "day" : "night";
    if (this.lastThemeMode === mode) return;
    this.lastThemeMode = mode;

    document.body.classList.toggle("mm-day", isDay);
    document.body.classList.toggle("mm-night", !isDay);
    this.sendNotification("PAGE_THEME_CHANGED", { mode });
  },

  notificationReceived(notification) {
    // MagicMirror sends this after every updateDom() resolves (swapped or skipped):
    // the deterministic moment to reap the outgoing tree and bind the new containers.
    // MODULE_DOM_CREATED announces the very first render.
    if (notification === "MODULE_DOM_UPDATED" || notification === "MODULE_DOM_CREATED") {
      this._startAnimations();
    }

    // MagicMirror's `modules` list is still empty while start() runs (it's
    // only populated once all modules are registered), so the very first
    // applyPageTheme() call in start()/scheduleTick() broadcasts to nobody.
    // Re-send the already-computed theme once every module is listening.
    if (notification === "ALL_MODULES_STARTED") {
      if (this.lastThemeMode) {
        this.sendNotification("PAGE_THEME_CHANGED", { mode: this.lastThemeMode });
      }
    }
  },

  formatClockTime(nowMoment) {
    if (!nowMoment) {
      return {
        hours: "--",
        minutes: "--",
        seconds: "",
        period: ""
      };
    }

    const showSeconds = this.renderSeconds && this.config.showTime;
    const use12 = this.getTimeFormat() === 12;
    const period =
      use12 && this.config.showPeriod
        ? nowMoment.format(this.config.showPeriodUpper ? "A" : "a")
        : "";

    return {
      hours: use12 ? nowMoment.format("h") : nowMoment.format("HH"),
      minutes: nowMoment.format("mm"),
      seconds: showSeconds ? nowMoment.format("ss") : "",
      period
    };
  },

  formatMoment(dateObj) {
    if (!dateObj) return "--";
    const tz = this.config.timezone || this.config.timeZone || null;
    const momentLib = this.getMomentLib();
    if (!momentLib || typeof momentLib !== "function") return "--";

    const base =
      tz && typeof momentLib.tz === "function"
        ? momentLib(dateObj).tz(tz)
        : momentLib(dateObj);
    const format =
      this.getTimeFormat() === 12
        ? `h:mm ${this.config.showPeriodUpper ? "A" : "a"}`
        : "HH:mm";
    return base.format(format);
  },

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------
  getRootNode() {
    return document.getElementById(`glass-clock-${this.identifier}`);
  },

  updateTimeDom(timeParts) {
    const root = this.getRootNode();
    if (!root || !this.config.showTime) return;
    const hoursEl = root.querySelector(".clock-hours");
    const minutesEl = root.querySelector(".clock-minutes");
    const secondsEl = root.querySelector(".clock-seconds");
    const periodEl = root.querySelector(".clock-period");

    if (hoursEl) hoursEl.textContent = timeParts.hours;
    if (minutesEl) minutesEl.textContent = timeParts.minutes;
    if (secondsEl && timeParts.seconds) secondsEl.textContent = timeParts.seconds;
    if (periodEl && typeof timeParts.period === "string") {
      periodEl.textContent = timeParts.period;
    }
  },

  // ---- Lottie lifecycle -----------------------------------------------------
  //
  // getDom() builds a brand-new tree on every render while MagicMirror keeps the
  // previous tree attached for the fade-out, and may skip the swap entirely when
  // the markup is unchanged. So players are NOT destroyed in getDom(): they keep
  // running on the visible tree until their container is detached, at which point
  // _startAnimations() reaps them. Each render registers the exact container
  // elements it created (this.pendingAnims); a player is created only once such a
  // container is connected, at most one per container. renderGen invalidates the
  // fallback poll from older renders. this.lottieInstances holds { player,
  // container } for every live player.

  _clearAnimTimer() {
    if (this.animTimer) {
      clearTimeout(this.animTimer);
      this.animTimer = null;
    }
  },

  _destroyPlayer(entry) {
    try {
      entry.player.destroy();
    } catch (error) {
      Log.warn(`[MMM-GlassClock] Failed to destroy Lottie player: ${error}`);
    }
  },

  // Destroys players whose container is no longer in the document.
  _reapDetachedAnimations() {
    this.lottieInstances = (this.lottieInstances || []).filter((entry) => {
      if (entry.container.isConnected) return true;
      this._destroyPlayer(entry);
      return false;
    });
  },

  // Starts a new render generation; live players are left alone.
  _beginRender() {
    this.renderGen = (this.renderGen || 0) + 1;
    this._clearAnimTimer();
    this.pendingAnims = [];
  },

  _registerAnimation(container, animName) {
    if (!this.enableLottie || !animName || !container) return;
    this.pendingAnims.push({ container, file: animName, player: null });
  },

  // "loop" always plays, "once" only if it has not finished, "static" never.
  _playLive() {
    if (this.iconAnimation === "static") return;
    (this.lottieInstances || []).forEach((entry) => {
      const player = entry.player;
      if (player.glassDone) return;
      if (typeof player.play === "function") player.play();
    });
  },

  _pauseAnimations() {
    this._clearAnimTimer();
    (this.lottieInstances || []).forEach((entry) => {
      if (typeof entry.player.pause === "function") entry.player.pause();
    });
  },

  // Creates players for registered containers that are now attached and reaps
  // players on detached containers. Containers not attached yet (new tree waiting
  // for the old one to fade out) are retried on a short bounded poll.
  _startAnimations(attempts = 50) {
    this._clearAnimTimer();
    if (!this.enableLottie) return;
    this._reapDetachedAnimations();
    // MM sets hidden=false when a show starts but calls resume() only after the
    // fade; a module MM reports visible is not suspended.
    if (this.suspended && this.hidden === false) this.suspended = false;
    if (this.suspended) return;
    if (typeof window === "undefined" || !window.lottie) return;

    const gen = this.renderGen;
    const mode = this.iconAnimation;
    let waiting = false;
    this.pendingAnims.forEach((item) => {
      if (item.player) return;
      if (!item.container.isConnected) {
        waiting = true;
        return;
      }
      let player;
      try {
        player = window.lottie.loadAnimation({
          container: item.container,
          renderer: "svg",
          loop: mode === "loop",
          autoplay: mode !== "static",
          path: this.file(`animations/${item.file}.json`)
        });
      } catch (error) {
        Log.warn(`[MMM-GlassClock] Failed to start Lottie animation ${item.file}: ${error}`);
        item.player = { destroy() {}, play() {}, pause() {} }; // do not retry
        return;
      }
      if (mode === "static" && typeof player.addEventListener === "function") {
        // Draw one frame (the last) without starting playback.
        player.addEventListener("DOMLoaded", () => {
          player.goToAndStop(Math.max(0, Math.floor(player.totalFrames) - 1), true);
        });
      }
      if (mode === "once" && typeof player.addEventListener === "function") {
        player.addEventListener("complete", () => {
          player.glassDone = true;
        });
      }
      item.player = player;
      this.lottieInstances.push({ player, container: item.container });
    });
    this._playLive();

    // Players from a previous render still attached are reaped once swapped out.
    const staleLeft = this.lottieInstances.some(
      (entry) => !this.pendingAnims.some((item) => item.player === entry.player)
    );
    if ((waiting || staleLeft) && attempts > 0) {
      this.animTimer = setTimeout(() => {
        this.animTimer = null;
        if (gen !== this.renderGen) return;
        this._startAnimations(attempts - 1);
      }, 100);
    } else if (waiting && !this.lottieInstances.length && this.gaveUpGen !== gen) {
      // Not a failure while the previous tree is still live with players (skipped swap).
      this.gaveUpGen = gen;
      Log.warn("[MMM-GlassClock] Gave up waiting for icon containers to attach");
    }
  },

  buildChip(label, value, extraClass = "", animName = null) {
    const chip = document.createElement("div");
    chip.className = `glass-chip ${extraClass}`.trim();

    if (animName && this.enableLottie) {
      const icon = document.createElement("div");
      icon.className = "glass-chip-icon";
      chip.appendChild(icon);
      this._registerAnimation(icon, animName);
    }

    const content = document.createElement("div");
    content.className = "glass-chip-content";

    const labelEl = document.createElement("div");
    labelEl.className = "glass-chip-label";
    labelEl.textContent = label;

    const valueEl = document.createElement("div");
    valueEl.className = "glass-chip-value";
    valueEl.textContent = value;

    content.appendChild(labelEl);
    content.appendChild(valueEl);

    chip.appendChild(content);
    return chip;
  },

  buildSunSection() {
    const container = document.createElement("div");
    container.className = "glass-clock-row";

    if (!this.sunTimes) {
      container.appendChild(
        this.buildChip("Sunrise", "Set latitude/longitude", "glass-chip-muted")
      );
      return container;
    }

    container.appendChild(
      this.buildChip(
        "Sunrise",
        this.formatMoment(this.sunTimes.sunrise),
        "sunrise",
        "sunrise"
      )
    );
    container.appendChild(
      this.buildChip(
        "Sunset",
        this.formatMoment(this.sunTimes.sunset),
        "sunset",
        "sunset"
      )
    );
    return container;
  },

  buildMoonSection() {
    const container = document.createElement("div");
    container.className = "glass-clock-row";

    if (!this.moonTimes) {
      container.appendChild(
        this.buildChip("Moonrise", "Set latitude/longitude", "glass-chip-muted")
      );
      return container;
    }

    if (this.moonTimes.alwaysUp) {
      container.appendChild(this.buildChip("Moon", "Up all day", "moon"));
      return container;
    }

    if (this.moonTimes.alwaysDown) {
      container.appendChild(this.buildChip("Moon", "Below horizon", "moon"));
      return container;
    }

    container.appendChild(
      this.buildChip(
        "Moonrise",
        this.formatMoment(this.moonTimes.rise),
        "moon",
        "moonrise"
      )
    );
    container.appendChild(
      this.buildChip(
        "Moonset",
        this.formatMoment(this.moonTimes.set),
        "moon",
        "moonset"
      )
    );
    return container;
  },

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------
  updateSecondsDom(timeParts) {
    const root = this.getRootNode();
    if (!root) return;
    const secondsEl = root.querySelector(".clock-seconds");
    if (secondsEl && timeParts.seconds) {
      secondsEl.textContent = timeParts.seconds;
    }
  },

  getDom() {
    this._beginRender();

    const wrapper = document.createElement("div");
    wrapper.className = "MMM-GlassClock";
    wrapper.id = `glass-clock-${this.identifier}`;

    const card = document.createElement("div");
    card.className = "glass-clock-card";
    wrapper.appendChild(card);

    const now = this.now || this.getNow();
    const timeParts = this.formatClockTime(now);

    if (this.config.showTime) {
      const timeRow = document.createElement("div");
      timeRow.className = "glass-clock-time";

      const hoursEl = document.createElement("span");
      hoursEl.className = "clock-hours";
      hoursEl.textContent = timeParts.hours;

      const separatorEl = document.createElement("span");
      separatorEl.className = "clock-separator";
      separatorEl.textContent = ":";

      const minutesEl = document.createElement("span");
      minutesEl.className = "clock-minutes";
      minutesEl.textContent = timeParts.minutes;

      timeRow.appendChild(hoursEl);
      timeRow.appendChild(separatorEl);
      timeRow.appendChild(minutesEl);

      if (timeParts.seconds) {
        const secondsEl = document.createElement("span");
        secondsEl.className = "clock-seconds";
        secondsEl.textContent = timeParts.seconds;
        timeRow.appendChild(secondsEl);
      }

      if (timeParts.period) {
        const periodEl = document.createElement("span");
        periodEl.className = "clock-period";
        periodEl.textContent = timeParts.period;
        timeRow.appendChild(periodEl);
      }

      card.appendChild(timeRow);
    }

    if (this.config.showDate) {
      const dateRow = document.createElement("div");
      dateRow.className = "glass-clock-date";
      dateRow.textContent = now ? now.format(this.config.dateFormat) : "";
      card.appendChild(dateRow);
    }

    const metaContainer = document.createElement("div");
    metaContainer.className = "glass-clock-meta";

    if (this.config.showSunTimes) {
      metaContainer.appendChild(this.buildSunSection());
    }

    if (this.config.showMoonTimes) {
      metaContainer.appendChild(this.buildMoonSection());
    }

    if (metaContainer.childNodes.length > 0) {
      card.appendChild(metaContainer);
    }

    // The tree is not attached yet; this arms the bounded poll so players bind
    // once it is, regardless of which DOM notification (if any) arrives.
    this._startAnimations();

    return wrapper;
  },

  resolveIconAnimation() {
    if (this.reduceMotion) return "static";
    const requested = String(this.config.iconAnimation || "auto").toLowerCase();
    if (requested === "loop" || requested === "once" || requested === "static") {
      return requested;
    }
    return this.performanceProfile === "pi" ? "once" : "loop";
  },

  resolvePerformanceProfile() {
    const requested = (this.config.performanceProfile || "auto").toLowerCase();
    if (requested === "pi" || requested === "full") return requested;
    const ua =
      typeof navigator !== "undefined" && navigator.userAgent ? navigator.userAgent : "";
    const isPi =
      ua.includes("raspberry") ||
      ua.includes("armv7") ||
      ua.includes("aarch64") ||
      ua.includes("linux arm");
    return isPi ? "pi" : "full";
  }
});
