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
    animationSpeed: 300
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
    this.tickTimer = null;
    this.rendered = false;
    this.lastRenderedDay = null;
    this.lottiePlayers = {};
    this.tzWarned = false;
    this.momentWithTz =
      typeof moment === "function" && typeof moment.tz === "function"
        ? moment
        : null;
    this.momentTzRequested = false;

    this.ensureMomentTimezone();
    moment.locale(config.language || "en");
    this.scheduleTick();
  },

  suspend() {
    clearTimeout(this.tickTimer);
    this.tickTimer = null;
  },

  resume() {
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
    const delay = this.config.displaySeconds
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
      const baseDate = currentMoment.toDate();
      this.sunTimes = SunCalc.getTimes(baseDate, lat, lon);
      this.moonTimes = SunCalc.getMoonTimes(baseDate, lat, lon);
      this.lastCalcDate = dateKey;
    } catch (error) {
      Log.error(`[MMM-GlassClock] Failed to calculate sun/moon times: ${error}`);
      this.sunTimes = null;
      this.moonTimes = null;
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

    const showSeconds = this.config.displaySeconds && this.config.showTime;
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

  loadLottie(container, animName) {
    if (!container || !window.lottie) return;

    const key = `${this.identifier}-${animName}`;
    if (this.lottiePlayers[key]) {
      this.lottiePlayers[key].destroy();
      delete this.lottiePlayers[key];
    }

    const player = window.lottie.loadAnimation({
      container,
      renderer: "svg",
      loop: true,
      autoplay: true,
      path: this.file(`animations/${animName}.json`)
    });

    this.lottiePlayers[key] = player;
  },

  buildChip(label, value, extraClass = "", animName = null) {
    const chip = document.createElement("div");
    chip.className = `glass-chip ${extraClass}`.trim();

    if (animName) {
      const icon = document.createElement("div");
      icon.className = "glass-chip-icon";
      chip.appendChild(icon);
      this.loadLottie(icon, animName);
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
  getRootNode() {
    return document.getElementById(`glass-clock-${this.identifier}`);
  },

  updateSecondsDom(timeParts) {
    const root = this.getRootNode();
    if (!root) return;
    const secondsEl = root.querySelector(".clock-seconds");
    if (secondsEl && timeParts.seconds) {
      secondsEl.textContent = timeParts.seconds;
    }
  },

  getDom() {
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

    return wrapper;
  }
});
