# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `package.json`: repository, homepage, bugs, license and keywords fields.
- README: Update section and trailing commas in the config examples.
- Node built-ins are imported with the `node:` scheme (for example `node:https`).
- ESLint (flat config) with an `npm run lint` script.
- Added CHANGELOG, CODE_OF_CONDUCT and a Dependabot configuration.

### Changed

- ESLint 10, with `defineConfig` in `eslint.config.mjs`; `npm run lint` runs `eslint` without the trailing `.`.
- Updated `moment` to 2.31 and `moment-timezone` to 0.6.
- Updated `suncalc` to 2.1. It ships only an ES module, so the module loads it with `import()` instead of `getScripts()`, and passes the clock's UTC offset so moonrise/moonset are for the local day. Sun and moon times now match a high-precision ephemeris to within seconds; 1.9 was off by up to 16 minutes for the moon.
- Lottie is the `lottie-web` npm package (pinned to 5.10.2, the same build) instead of a copy in `vendor/`.
- `package.json`: lowercase package name and `"type": "commonjs"`.
- ESLint reports unused catch bindings and arguments, and lints `package.json`, as modules.magicmirror.builders does.

## [1.0.0]

Released before this changelog was started. Commit history, newest first:

### 2026-10-03

- Add MIT license
- README: current screenshot and documentation review

### 2026-10-01

- Keep seconds ticking on the Pi; let the sun/moon icons play once

### 2026-09-29

- Fix day/night page theme: anchor sun times at local noon and broadcast PAGE_THEME_CHANGED

### 2026-09-25

- Mark the page day/night from sunrise and sunset

### 2025-11-29

- modified:   MMM-GlassClock.js 	modified:   README.md

### 2025-11-23

- Refine glass clock styling

### 2025-11-22

- modified:   MMM-GlassClock.css 	modified:   MMM-GlassClock.js

### 2025-11-21

- Initial release: glass clock module
