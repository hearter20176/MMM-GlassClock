# MMM-GlassClock

Liquid-glass clock module that matches the aesthetic of MMM-AmbientWeather, MMM-MyAgenda, MMM-GlassCalendar, and MMM-GlassDailyCalendar. Shows time/date plus optional sun/moon rise/set chips with bundled Lottie animations.

## Features

- Glass card styling with shimmer, glow shadows behind the digits, and the shared glass palette.
- Sun/moon chips with Lottie animations (`sunrise`, `sunset`, `moonrise`, `moonset`); sunrise/sunset text in `#fbbf24`, moonrise/moonset text in `#7dd3fc`.
- Day-only re-rendering: the DOM rebuilds when the day changes; time/seconds update in place for smoothness.
- Timezone-aware via `moment-timezone`, 12/24h support, configurable AM/PM casing, optional seconds.

## Installation

```bash
cd ~/MagicMirror/modules
git clone https://github.com/your-repo/MMM-GlassClock.git  # or copy this folder into modules/
cd MMM-GlassClock
npm install
```

## Configuration

Add the module to your `config.js`:

```js
{
  module: "MMM-GlassClock",
  position: "bottom_bar",
  config: {
    timeformat: 12,           // 12 or 24
    timezone: "America/New_York",
    displaySeconds: true,
    showPeriod: true,
    showPeriodUpper: true,
    showTime: true,
    showDate: true,
    showSunTimes: true,
    showMoonTimes: true,
    latitude: 40.7128,        // required for sun/moon times
    longitude: -74.0060,
    dateFormat: "dddd, MMMM Do",
    performanceProfile: "auto", // "auto" | "pi" | "full"
    reduceMotion: false         // true disables lottie + seconds on Pi/reduced-motion
  }
}
```

### Options

- `timeformat`: `12` or `24` hour clock. Default follows MagicMirror `config.timeFormat`.
- `timezone`: IANA timezone string (uses `moment-timezone`). `null` = system time.
- `displaySeconds`: Show seconds beside the minutes. Default `true`.
- `showPeriod`: Show AM/PM when using 12-hour time. Default `true`.
- `showPeriodUpper`: Uppercase AM/PM. Default `false`.
- `showTime`: Toggle the time row. Default `true`.
- `showDate`: Toggle the date row. Default `true`.
- `showSunTimes`: Show sunrise/sunset chips (Lottie + `#fbbf24` text). Requires `latitude` and `longitude`. Default `false`.
- `showMoonTimes`: Show moonrise/moonset chips (Lottie + `#7dd3fc` text). Requires coordinates. Default `false`.
- `latitude` / `longitude`: Decimal degrees for solar/lunar times. Falls back to `lat`/`lon` keys if present.
- `dateFormat`: Moment.js format string for the date. Default `dddd, MMMM Do`.
- `animationSpeed`: Milliseconds for DOM update animation. Default `300`.
- `performanceProfile`: `"auto"` detects Pi/ARM, `"pi"` forces low-frequency updates and disables heavy motion, `"full"` keeps all effects.
- `reduceMotion`: Force low-motion mode (suppresses Lottie animations and seconds tick) even on non-Pi devices; also obeys system `prefers-reduced-motion`.

## Styling

`MMM-GlassClock.css` carries the gradients, blurs, shimmer, and shadow treatments used in the companion glass modules. Adjust widths, font sizes, or accent colors there if you need a custom fit.
