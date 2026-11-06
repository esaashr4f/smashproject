# Smash Mod Doctor

A free, open-source website that diagnoses **Super Smash Bros. Ultimate** mod setups on modded Switch consoles.

- **Crash Log Explainer**: drop a crash report from `atmosphere/crash_reports/` and get a plain-English diagnosis and fix.
- **SD Card Scanner**: pick your SD card and get a health report covering plugins, broken mod folders, costume slot clashes and which Smashline version your movesets need.
- **GameBanana info**: link each mod to its GameBanana page to see when it was last updated, what it requires and recent problem reports.

Everything runs **in your browser**. Nothing is uploaded.

> Status: v0.1. All 29 real crash logs in `fixtures/` are diagnosed correctly, and the scanner passes the CSV fixture and the 41 real moveset binaries.

---

## Try it on your computer (Windows, PowerShell)

You need **Node.js** (the JavaScript runtime that runs the build tools) and **Git**.

1. Install them once (skip any you already have):

   ```powershell
   winget install OpenJS.NodeJS.LTS
   winget install Git.Git
   ```

   Close and reopen PowerShell afterwards so it picks up the new commands.

2. Get the code and install its dependencies:

   ```powershell
   cd $HOME\Documents
   git clone https://github.com/esaashr4f/smashproject.git
   cd smashproject
   npm install
   ```

3. Start the dev server and open the URL it prints (usually http://localhost:5173):

   ```powershell
   npm run dev
   ```

   Edit any file in `src/` and the page reloads instantly.

4. Run the tests (do this before every commit):

   ```powershell
   npm test
   ```

### Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server with instant reload |
| `npm test` | Runs every fixture through the explainer and scanner |
| `npm run build` | Type-checks, then builds the static site into `dist/` |
| `npm run explain -- path\to\file.log` | Explains a crash log in the terminal |
| `npm run scan-csv -- path\to\modfiles.csv` | Scans a CSV listing in the terminal |
| `npm run callsites -- fixtures\private_mod_binaries` | Shows the clone_weapon analysis per moveset |
| `npm run hash-release -- file.nro "ARCropolis" "4.1.1"` | Prints a `known_plugins.json` entry for a downloaded release file |
| `npm run fingerprints -- 559266 490640` | Downloads GameBanana mods and records their plugin hashes |

---

## Put it online (Vercel)

It's a static site (plain HTML/CSS/JS files), so hosting is free.

1. Push this repo to GitHub (already done if you're reading this there).
2. On https://vercel.com, click **Add New → Project** and import `esaashr4f/smashproject`.
3. Vercel detects Vite automatically: build command `npm run build`, output folder `dist`. Click **Deploy**.
4. Every push to the main branch redeploys automatically. Every other branch gets its own preview URL.

GitHub Pages also works, because the build uses relative paths.

---

## How it works

```
src/
  core/                    pure logic: runs in the browser AND in Node for tests
    crashlog/parse.ts      crash report text -> typed CrashLog object
    crashlog/match.ts      CrashLog + rules.json -> ranked diagnoses
    crashlog/demangle.ts   _ZN2nn2fs8OpenFile... -> nn::fs::OpenFile
    scanner/source.ts      FileSource interface: folder / CSV / in-memory
    scanner/model.ts       file list -> mods
    scanner/checks/*.ts    one file per group of checks
    scanner/crossref.ts    crash reports x scan ("it's probably Blaze")
    scanner/scan.ts        runs everything, builds the report
    nro/strings.ts         smashline_* names in a plugin.nro
    nro/smashline.ts       names -> which Smashline version is needed
    nro/callsite.ts        reads the moveset's code to settle clone_weapon's layout
    gamebanana.ts          GameBanana API client
    report.ts              Markdown export
  data/                    the knowledge: rules, fingerprints, fighter names...
  ui/                      the website (plain TypeScript, no framework)
fixtures/                  real crash logs and listings with known answers
tests/                     Vitest tests that run the fixtures
scripts/                   command-line helpers
```

**Why this split:** the parsing and rules don't know they're in a browser. The UI hands them a `FileSource` (an SD card folder, a CSV listing or a fake tree in a test), and the same checks run on all three. That's why the tests can check real crash logs without a browser.

**Why knowledge lives in data files:** adding a crash type or plugin version should be a data edit, not a code change, so other people can contribute rules through a pull request.

### Adding a crash rule

1. Put the real log in `fixtures/crash_logs/` and add its expected `rule` to `fixtures/crash_logs/EXPECTED.json`.
2. Add the rule to `src/data/rules.json`. Conditions you can use:
   - `{ "field": "pc.module", "eq": "Skyline" }`, plus `in`, `min`, `max`, `matches` (regex), `notMatches`
   - fields: `programId`, `processName`, `exceptionType`, `address`, `resultCode`, `resultModule`, `pc.module`, `pc.moduleOffset`, `pc.symbol`, `pc.symbolOffset`, the same for `lr.*`, and `context.smashlineVersion` (when the scanner knows it)
   - `{ "stack": { "module": "arcropolis" } }`, which matches when any stack frame is in that module (also `moduleMatches`, `symbol`, `symbolMatches`)
   - `{ "moduleLoaded": "smashline" }`, `{ "dumpString": "mate/mod" }`, `{ "any": [...] }`, `{ "not": ... }`
   - `prefer`: optional conditions that make a match more specific. A known `context.*` value that contradicts one lowers the confidence.
3. `npm test`. The new log must match, and all the old ones must still pass.

### The Smashline check, explained

Smashline 2.0 changed `clone_weapon`'s arguments **without renaming it**, so a moveset's name list can't always tell which version it was built for (32 of the 41 test movesets were in that position). The scanner settles it in three steps:

1. **Names** (`nro/smashline.ts`): 2.0-only names mean it needs 2.0. Names in no release mean it needs an unreleased Smashline (Tetrimino). No version-sensitive names mean it works with either.
2. **Call site** (`nro/callsite.ts`): for `clone_weapon` users, it finds where the code calls the looked-up function and checks which CPU registers it fills first. Old layout = arguments up to `x7`; new layout = kind in `w4`, flag in `w5`, nothing above. On the 41 real movesets this agrees with every known answer, **including Herobrine**, which has no 2.0-only names but crashed on 1.6.8.
3. **Update date** (GameBanana) as a fallback hint when the code can't be read.

---

## Decisions that differ from the original brief, and why

- **No GameBanana proxy.** Tested on 2026-11-06: GameBanana's API sends `access-control-allow-origin: *`, so the browser can call it directly. No server needed.
- **No capstone/WASM disassembler.** The call-site check only needs about 10 instruction encodings, so `callsite.ts` decodes them by hand (about 150 lines). That avoids downloading a few MB of WebAssembly. Prototyped against capstone first.
- **`pickel` is Steve, not Piranha Plant** (Piranha Plant is `packun`). The original notes for the 20:34 crash said Piranha Plant; `EXPECTED.json` now has a correction note.
- **Folder drag-and-drop** as well as `showDirectoryPicker`, so the full scan also works in Firefox and Safari on desktop, not just via CSV.
- **ARCropolis / NRO Hook hashes are not added yet.** This build environment couldn't download GitHub release assets. Use `npm run hash-release` on the official release files to add them (never a "latest" link).

## Privacy

- Crash logs, SD card files and scan results never leave your device.
- GameBanana lookups go straight from your browser to GameBanana, and only when you link a mod.
- Mod links and the theme setting are saved in your browser's localStorage.
- `fixtures/private_mod_binaries/` (third-party mod files used for testing) is git-ignored and must never be published.

## Credits

Built on the work of the Atmosphère, Skyline, ARCropolis, Smashline, NRO Hook, Param Config, One Slot Effects, Stage Config and The CSK Collection developers, and every moveset creator on GameBanana.

## Licence

MIT. See [LICENSE](LICENSE).
