# Smash Mod Doctor: project brief

> A free, open-source, browser-based tool that diagnoses Super Smash Bros. Ultimate mod setups on modded Switch consoles. It **explains crash logs in plain English**, **scans the SD card** for incompatible or broken mods, and tells the user exactly what to fix.
>
> Working name: **Smash Mod Doctor** (rename freely). Owner: **Esa**.

Read this whole brief, plus the files in `data/` and `fixtures/`, before writing code. Everything here comes from a real, long debugging session on Esa's own Switch. The fixtures are **real crash logs with known answers**, so treat them as the test suite.

---

## 0. Working with Esa

- Esa is 18, on a gap year, and an aspiring founder. He wants to **learn** while building: how the web stack works, why decisions are made, how to ship. Explain your choices briefly and in plain language as you go. Don't drown him in jargon. Do teach him the real concepts.
- He thinks from first principles and dislikes arbitrary rules. When you pick a tool or pattern, give the one-line reason.
- He prefers **step-by-step instructions** with exact commands. His computer is a **Windows Surface Laptop 3**. Use PowerShell for terminal commands, not bash, unless you're inside your own sandbox.
- He has no interest in piracy. The tool must never help with piracy (no sigpatches, no NSP/ticket advice, nothing about pirated games). If a crash log or folder shows piracy tooling, say neutrally that it's out of scope.
- Be honest about uncertainty. Several "obvious" conclusions in the original session turned out wrong until they were checked against real files. **Verify against real data, never assume.**
- Commit small and often, with clear messages. Push to GitHub when he's set it up.

---

## 1. The problem (why this exists)

Smash Ultimate's mod scene runs on a stack of community plugins:
- **Atmosphère** (custom firmware)
- **Skyline** (code-injection framework, `exefs/subsdk9` + `main.npdm`)
- **ARCropolis** (file replacement, `libarcropolis.nro`)
- **Smashline** (custom moveset code, `libsmashline_plugin.nro`)
- **NRO Hook**, **Param Config**, **One Slot Effects**, **Stage Config**, **The CSK Collection** (all `.nro` plugins)

Hundreds of community movesets and mods sit on top of that, each built against particular plugin versions.

When anything mismatches, the game **just crashes**. The only clue is a dense crash report in `atmosphere/crash_reports/`. Every crash also triggers an automatic, unskippable "corrupted data check" on the next launch, so trial and error is slow and painful. In one evening Esa hit **every** kind of failure in the table below, and diagnosing them took hours of manual log reading, binary inspection and GameBanana research. Nothing currently does this automatically. **Skyrim has LOOT; Smash has nothing.** This tool fills that gap.

### The real failure modes we diagnosed (each is a feature requirement)
| # | Failure | How it showed up | Real cause |
|---|---|---|---|
| 1 | **Skyline page-boundary bug** | Data Abort at `0x69`, PC `Skyline + 0x4c58` | Skyline verifies a 4-byte patch with an 8-byte read; it crosses a page edge on 13.0.5 → deliberate abort. Fixed with a patched `subsdk9`. |
| 2 | **Smashline version mismatch, old mod on 2.0** | Abort at small address (0x30/0x5a/0xb9), LR `smashline_clone_weapon + 0x340` | Smashline **2.0.0** (28 Oct 2026) changed `clone_weapon`'s signature; old movesets pass a number where text is expected. |
| 3 | **Smashline version mismatch, new mod on 1.6.8** | Abort at `0x5`, LR `smashline_clone_weapon + 0xa0` | The reverse: a 2.0-built moveset on 1.6.8. |
| 4 | **Misidentified plugin version** | n/a | The user and the assistant both believed Smashline was 1.6.8. The file was 2.0.0 (identified by hash and size). |
| 5 | **Param Config / ARCropolis file-open abort** | `2002-4802`, `nn::fs::OpenFile` from `libparam_config` or `arcropolis` | Disabled (dot-prefixed) and broken mod folders left **inside** `mods/`; a corrupted entry; CSK config folders without the CSK plugin. |
| 6 | **Broken mod folder** | ARCropolis `memcpy` crash | The `ultron` folder contained a stray nested `{Moveset} Shadow` folder (a second copy of Shadow's `plugin.nro`) and was **missing** its own `plugin.nro`. |
| 7 | **Mod requires an unreleased plugin** | clone_weapon crash | Tetrimino calls Smashline functions that exist in no public release. |
| 8 | **Moveset's own code crashes** | LR inside `smashline_<name>` module | That moveset is broken on this game version. |
| 9 | **Outdated mod** | Various | Last updated before game 13.0.5 (1 Sept 2026) or before Smashline 2.0. |
| 10 | **Homebrew app crashes** (not Smash) | Program ID `01007ef00011e000` (hbloader) | appstore / Themezer-NX / NX-Shell outdated. |
| 11 | **Fighter crash via Smashline interpreter** | Crash in game code during vanilla Piranha Plant scripts | Likely a Smashline 2.0 issue with that fighter. |

---

## 2. Product overview

Three tools in one site, built in this order:

1. **Crash Log Explainer (MVP).** Drop a `.log` file → plain-English diagnosis + fix.
2. **SD Card Scanner.** Pick the SD card folder → full health report of plugins and mods.
3. **GameBanana integration.** Identify each mod, its age, requirements and update status.

Later: **setups/profiles** (swap mod sets and Smashline versions), **"is this safe to add?"** pre-download check, a **community signature library**, and maybe a Switch homebrew version.

### Core principles
- **Runs entirely in the browser, on the user's machine.** No uploads by default. Privacy is a selling point.
- **No install.** It's a website. A static site keeps hosting free.
- **Knowledge lives in data files** (JSON rules and fingerprints), not in code. Adding a new crash type or plugin version should be a data edit.
- **Be honest about confidence.** Every finding carries a confidence level (`certain`, `likely`, `possible`) and explains its evidence. Never claim certainty you don't have.
- **Plain English first, technical detail on demand.** Each finding has a one-line summary, a fix, and an expandable "why we think this" section showing the evidence (e.g. `LR = smashline_clone_weapon + 0x340`).

---

## 3. Tech stack (recommended, explain the choices to Esa)

| Choice | Pick | Why |
|---|---|---|
| Language | **TypeScript** | Catches mistakes before they run, and makes parsing code safer |
| Build tool | **Vite** | Fast, simple, and makes a static site |
| UI | **Plain TypeScript + light components, or Preact/React if it helps** | Keep it simple; the hard part is the logic, not the UI |
| Styling | Simple CSS (or Tailwind) | Clean, readable, dark mode |
| Tests | **Vitest** | Runs the fixtures as automated tests |
| Hashing | Web Crypto `crypto.subtle.digest('SHA-256', …)` | Built into every browser, nothing to install |
| Folder access | **File System Access API** (`window.showDirectoryPicker`) | Lets Chrome and Edge read a folder the user picks, with permission |
| Hosting | **Vercel** (Esa already uses it for another project) or GitHub Pages | Free static hosting |
| Optional backend | Vercel serverless functions | Only if GameBanana's API blocks browser requests (CORS), or for log submissions |
| Repo | Public GitHub repo, **MIT licence** for code | Trust, and community rule contributions |

Separate **pure logic** (parsers, rules engine, scanners) from the **UI**. The logic must run in Node for tests and in the browser for users.

Suggested structure:
```
/src
  /core
    crashlog/parse.ts        # text → CrashLog object
    crashlog/match.ts        # CrashLog + rules → Diagnosis[]
    scanner/walk.ts          # directory handle → file tree (abstracted, so tests can feed fake trees)
    scanner/checks/*.ts      # one file per check
    nro/strings.ts           # extract smashline_* names from a binary
    hash.ts
    types.ts
  /data                      # rules.json, known_plugins.json, smashline names, fighters.json
  /ui
/fixtures                    # crash_logs/, modfiles_*.csv, private_mod_binaries/ (gitignored)
/tests
```

---

## 4. Feature 1: Crash Log Explainer (build this first)

### 4.1 Input
The user drags in one or more `.log` files, or pastes the text. Atmosphère names its logs `<unix_seconds>_<program_id>.log` (e.g. `01793920898_01006a800016e000.log`). Show each log's date and time from the timestamp, in the user's local time.

### 4.2 Atmosphère crash report format (v1.7)
Plain text. The key fields, with real examples from `fixtures/crash_logs/`:
```
Atmosphère Crash Report (v1.7):
Result:                          0x4A8 (2168-0002)
Process Info:
    Process Name:                Application          ← 'Application' = a game; 'hbloader' = homebrew app
    Program ID:                  01006a800016e000     ← Smash Ultimate. 01007ef00011e000 = hbloader/homebrew
Exception Info:
    Type:                        Data Abort | Instruction Abort | User Break
    Address:                     0000000000000069     ← address it tried to access
    Break Reason / Break Address (User Break only)
Crashed Thread Info:
    Thread ID / Thread Name
    Registers: X[00]..X[28], FP, LR, SP, PC
        e.g. PC: 0000006118165c58 (Skyline + 0x4c58)
        e.g. LR: 00000039fed48f24 (smashline + 0x20f24) (smashline_clone_weapon + 0xa0)
    Stack Trace: ReturnAddress[NN]: <addr> (module + off) (symbol + off)
    Stack Dump / TLS Dump (hex)
Module Info:
    Number of Modules
    Module NN: Address range, Name, Module Id
Thread Report:  (every thread, same layout)
```
Parsing notes:
- Annotations are optional and nested: `(module + 0xoff)` and then optionally `(symbol + 0xoff)`. Some symbols are C++-mangled (e.g. `_ZN2nn2fs8OpenFile...`). Demangle the common ones for display (`nn::fs::OpenFile`).
- **Result** shows hex plus `MMMM-DDDD`. `2168-xxxx` = CPU exception. `2002-xxxx` = filesystem module 2; 4000–4999 is the "DataCorrupted" range. The upper bits of the raw hex can be garbage; use the formatted code.
- The **game version** appears as ASCII in a TLS dump (e.g. bytes `31 33 2e 30 2e 35` = `13.0.5`). Extract it heuristically: look for `\d+\.\d+\.\d+` in decoded TLS/stack bytes. Show it ("Game version: 13.0.5").
- Decode stack and TLS hex to ASCII and look for useful strings (paths like `mate/mod` = fragment of `ultimate/mods`, module names, `DualLogger`).
- Some files in a crash folder aren't crash reports (e.g. `dns_mitm_startup.log`). Detect that and say so.
- **Loaded modules list** = which plugins were actually loaded when it crashed. Very useful ("Smashline wasn't even loaded yet, so it's not Smashline's code").

### 4.3 Rules engine
Rules live in `src/data/rules.json`. Each rule has:
```jsonc
{
  "id": "smashline2_old_clone_weapon_abi",
  "title": "A moveset built for an older Smashline is running on Smashline 2.0",
  "severity": "error",
  "confidence": "likely",
  "match": {                          // all conditions must hold
    "programId": "01006a800016e000",
    "exceptionType": ["Data Abort"],
    "crashedLR.symbol": "smashline_clone_weapon",
    "crashedLR.symbolOffset": [0x340],     // offset differs per Smashline build; may be a list
    "faultAddress.max": 4096              // small address → integer misused as pointer
  },
  "summary": "…plain English…",
  "fix": ["…step…", "…step…"],
  "evidence": ["LR = {crashedLR}", "Fault address = {address}"],
  "learnMore": "https://github.com/HDR-Development/smashline/wiki/%5BREAD!%5D-Major-Update-Information"
}
```
Design the matcher so conditions can test:
- any parsed field
- module present or absent in the module list
- PC/LR module and offset (exact, list or range)
- symbol name
- Result code
- address ranges
- "return address N is in module X"

Several rules may match. Rank by specificity, then show the best one first and others as "also possible". If nothing matches, use the **generic fallback**: describe in plain English where it crashed ("inside the One Slot Effects plugin, while loading"), which plugins were loaded, and the game version. Offer an opt-in "submit this log" (§7).

### 4.4 Initial rules (must pass every fixture in `fixtures/crash_logs/EXPECTED.json`)
1. **`skyline_page_boundary_verify`:** PC = `Skyline + 0x4c58`, Data Abort, address `0x69`. Explain the bug and point to the fix (patched `subsdk9` / upstream Skyline issue). Note that it shows up when Smashline is installed.
2. **`smashline2_old_clone_weapon_abi`:** LR symbol `smashline_clone_weapon`, offset `+0x340` (Smashline 2.0.0 build), PC `smashline + 0x55d8`, small fault address. Fix: use Smashline 1.6.8 for old movesets, or update the moveset. If the scanner has run, **name the likely culprits** (movesets that use `clone_weapon` and have no 2.0-only names).
3. **`smashline168_new_clone_weapon_abi`:** LR `smashline_clone_weapon + 0xa0` (1.6.8 build), PC `smashline + 0x540c`, small address. Fix: use Smashline 2.0 for that moveset.
   - Rules 2 and 3 **depend on the Smashline build**. Key them on the offset for each known build, and also on which build is installed if the scanner knows. A third, newer build will need new offsets, so keep them in data.
4. **`paramconfig_openfile_abort`:** User Break, `nn::diag::detail::Abort` → `nn::fs::OpenFile`, return address in `libparam_config`, Result `2002-4802`. Fix: move disabled (dot-prefixed) mods **out of** `mods/`, remove broken entries, run the scanner.
5. **`arcropolis_openfile_abort`:** same, but the return address is in `arcropolis`. Fix: as above; also check CSK config folders against the CSK plugin.
6. **`arcropolis_memcpy_bad_mod_folder`:** PC `__memcpy_device`, LR `arcropolis + 0x5c1f4`. Fix: a mod folder is malformed. Run the scanner, which looks for nested mod folders, a missing `plugin.nro`, duplicate plugins.
7. **`moveset_code_crash`:** PC or LR inside a module whose name starts with `smashline_` but isn't `smashline` itself (e.g. `smashline_alucardssm`). Fix: that moveset's own code crashed; remove or update it. Show the module name.
8. **`vanilla_fighter_via_smashline_interpreter`:** crashed in `cross2_Release.nss`, with a `lua2cpp_<fighter>.nrs` frame and `smashline_interpreter` in the stack trace. Map internal fighter names to display names (`pickel` → Piranha Plant). Ship a `fighters.json` mapping all internal names (mario, captain, pitb, chrom, dolly, pickel, richter, wolf, …).
9. **`homebrew_app_crash`:** Program ID `01007ef00011e000` (hbloader); report the app module name (appstore, themezer-nx, NX-Shell). "Not Smash: this homebrew app crashed." Add known-app advice.
10. **`not_a_crash_log`:** no "Atmosphère Crash Report" header.

Write a **Vitest test** that runs every fixture in `fixtures/crash_logs/` and checks the top rule equals `EXPECTED.json`'s `rule`. That's your safety net forever.

### 4.5 Output UI
For each log:
- a headline ("Smashline version mismatch")
- severity colour and confidence badge
- 2–3 sentence plain-English explanation
- numbered fix steps
- an expandable "Evidence" panel showing the key log lines, highlighted
- game version, crash time, and the loaded-plugins list

Batch view: drop a whole `crash_reports` folder and get a **timeline** grouped by diagnosis ("14 crashes: 8 × Skyline bug, 4 × Smashline mismatch, …").

---

## 5. Feature 2: SD Card Scanner

### 5.1 Access
- **Chrome/Edge:** `showDirectoryPicker()`; the user picks the SD root (e.g. `D:\` when the Switch is in Hekate's USB mass-storage mode, which is recommended over MTP). Read-only at first.
- **Fallback (Firefox/Safari/mobile):** the user runs a one-line PowerShell command that outputs a CSV of `Mod,Path,Size` (see `fixtures/modfiles_esa_2026-11-05.csv` for the exact format Esa produced) and drops the CSV in. CSV mode can't hash or read binaries, so say what's skipped.
- Abstract file access behind an interface (`list(dir)`, `size(path)`, `read(path, maxBytes?)`). Tests then use fake in-memory trees, and the CSV mode plugs into the same checks.

### 5.2 Known SD layout
```
/atmosphere/contents/01006A800016E000/exefs/          → main.npdm, subsdk9 (Skyline). Nothing else should be here.
/atmosphere/contents/01006A800016E000/romfs/skyline/plugins/   → *.nro plugins ONLY
/atmosphere/contents/01006A800016E000/manual_html/    → created by ARCropolis 4.1 (normal)
/atmosphere/contents/01006A800016E000/romfs_metadata.bin → created by Atmosphère (normal)
/atmosphere/contents/01006A800016E000/romfs/smashline/development.nro → Smashline dev-plugin slot (warn if present)
/atmosphere/crash_reports/*.log                        → feed straight into the Explainer
/ultimate/mods/<ModFolder>/...                         → active mods
/ultimate/arcropolis/                                  → config, cache (cache/13.0.5/offsets.toml), logs
/ultimate/mods_all/ (Esa's convention)                 → inactive library (recommend this pattern)
```

### 5.3 Checks (each produces findings with severity, confidence and a fix)
**Base setup**
- Skyline present? Identify `subsdk9` by hash (`data/known_plugins.json`): official (has the page-boundary bug, so warn if Smashline is installed) or the patched build. Extra files in `exefs` = error.
- Each plugin `.nro`: identify product and version by hash; unknown hash → report size and "unrecognised build". Flag non-`.nro` files in `plugins/` (including `.nro.off`, which Skyline may still try to load; recommend moving backups out of the folder).
- Known incompatibilities, e.g.:
  - Smashline < 1.6.7 on game 13.0.5
  - CSK < 6.0.0 on 13.0.5
  - the "OUTDATED" One Slot Effects
  - Stage Config < 1.1.1
- Duplicate plugins (same product twice).

**Mods folder hygiene**
- **Dot-prefixed folders inside `mods/`** → warning: "ARCropolis skips these, but Param Config and others may still scan them; move them out." This caused real crashes.
- Entries that are files, not folders, at the top of `mods/` (Bandana Dee case) → error.
- Folder names with `{}`, `[]` or non-ASCII characters → info/warn ("rename to something simple").
- Very long paths (> 180 chars) → warn.

**Per-mod structure**
- Expected top-level content: game folders (`fighter`, `ui`, `effect`, `sound`, `camera`, `stage`, `stream;`, `assist`, `item`, `prebuilt;`, …) plus mod files (`config.json`, `info.toml`, `plugin.nro`, `preview.webp`, `*.toml` like `config_param.toml`, `config_stage.toml`, `victory.toml`).
  - **`stream;` with a semicolon is legitimate.**
- **Extra wrapper folder** (the mod folder contains just one folder that itself contains `fighter/`, `ui/` …) → error, with the fix "move contents up one level".
- **Nested mod inside a mod** (a subfolder containing its own `config.json`/`plugin.nro`) → error. This is the Ultron/Shadow case.
- **Duplicate `plugin.nro`**: same hash in two different mod folders → error ("one mod's code is copied into another mod").
- **Moveset with no `plugin.nro`** when other signs say it's a moveset (custom fighter files plus `config.json`), or its listed requirements include Smashline → warn ("this moveset's code file is missing").
- Zero-byte files: a few are normal placeholders (each mod in the fixture has around 8), so **don't flag them**. Flag only if a key file (`plugin.nro`, `config.json`, models) is empty.

**Smashline compatibility (the killer feature)**
- For each mod's `plugin.nro`, read the bytes and extract ASCII strings matching `smashline_[A-Za-z0-9_]+`.
  - **Important:** these are **string literals in rodata used for runtime lookup**, not dynamic-symbol imports. Don't parse `.dynsym` for them.
- Compare against `data/smashline_1.6.8_names.txt` and `data/smashline_2.0.0_names.txt`:
  - Uses any **2.0-only** name → **needs Smashline 2.0** (certain)
  - Uses names in **neither** version → **needs an unreleased/private Smashline** (certain, e.g. Tetrimino)
  - Uses `clone_weapon` / `update_weapon_count` / `whitelist_kirby_copy_article` with no 2.0-only names → **ABI-sensitive, version unknown**. Use GameBanana's last-updated date (before 28 Oct 2026 → likely 1.6.8; after → check) plus crash evidence. Herobrine is the real counter-example: updated 2026-11-05, no 2.0-only names, but new ABI. Mark `possible`, not `likely`.
  - Uses none of the ABI-sensitive names → **works with either** (likely)
  - Ignore non-API strings: `smashline_test`, `smashline_plugin`, `smashline_<fightername>` (package/module names). `smashline_install_symbol_hook` = info only.
- **Stretch (very valuable):** settle ABI-sensitive cases by **call-site analysis**. Find the code that loads the `smashline_clone_weapon` string, follow how the resolved function pointer is called, and check argument registers. Old ABI = `(str ptr x0, len x1, i32 kind w2, str x3/x4, str x5/x6, bool w7)`. New = `(str x0/x1, str x2/x3, i32 kind w4, bool w5)`. Verified in Smashline 1.6.8's disassembly: the function saves exactly that old layout. A JS AArch64 disassembler (e.g. capstone compiled to wasm) could do this. Only attempt it after everything else works.
- Report the result as a **compatibility matrix**: "With Smashline 1.6.8: these N mods work, these M need 2.0. With 2.0: …". Recommend the version that runs the most of the user's mods. Fixture: `fixtures/private_mod_binaries/EXPECTED.json` (**gitignored**; these are third-party mod binaries, so don't publish them).

**Costume slot clashes**
- From paths like `fighter/<fighter>/model/body/c80/...` (any `cNN`/`cNNN` path segment under `fighter/<name>/`), compute each mod's (fighter, slot range).
- Overlapping fighter + slot across two mods → error ("these two mods fight over Sonic c80"). Fixture result: **no clashes** among Esa's 15 mods. Ranges include Alucard richter c120–127, Blaze sonic c80–91, Tails sonic c64–71, Iron Man mario c48–55, Thwomp ike c40–47, Hilda ike c128–135, …
- Note: multiple mods sharing `ui/message/msg_name.xmsbt`, `msg_menu.xmsbt`, `msg_tips.xmsbt` or `*.prcxml` is **normal**. ARCropolis merges xmsbt/prcxml patches, so **don't flag these**. Only flag real same-path replacements of non-patch files (`.nutexb`, `.numshb`, `.nuanmb`, `.prc`, `.bntx`, …).

**Requirements**
- Mods list requirements on GameBanana (§6) and sometimes in `info.toml`/README. Check each required plugin is present (Smashline, Param Config, One Slot Effects, CSK, Stage Config, NRO Hook, **Ozone**; Ozone is an `exefs` replacement for Skyline, so flag that it conflicts with patched Skyline).
- CSK "extras" folders (12-Hour Time…, Unlock All Characters, etc.) need the CSK plugin.
- **Alucard-style validation:** some mods ship `ultimate/.movesets/<name>.toml` for ARCropolis plugin validation. Understand that format.

**Crash logs on the card**
- Auto-load `atmosphere/crash_reports/` and run the Explainer, then **cross-reference**. E.g. a Smashline-mismatch crash plus the scan's ABI-sensitive list → "the likely culprit is Herobrine (updated after Smashline 2.0)".

### 5.4 Output
- A summary card: "3 errors, 5 warnings, 18 mods OK".
- A per-mod table:
  - name
  - fighter/slots
  - Smashline needs
  - last updated (GameBanana)
  - status
  - issues
- Base-setup panel: Skyline, ARCropolis and plugins, each with a ✅/⚠️/❌ and the version.
- Export the report as Markdown or text, so users can paste it into Discord or GitHub when asking for help.

---

## 6. Feature 3: GameBanana integration

### 6.1 API (public, no key; verify behaviour and CORS)
Smash Ultimate game ID: **6498**. Endpoints used successfully in the original session (via curl):
- `https://gamebanana.com/apiv11/Mod/{id}/ProfilePage`: name, `_sVersion`, `_tsDateUpdated`/`_tsDateModified`, `_aFiles` (each with `_sFile`, `_tsDateAdded`, `_sDescription`, `_sDownloadUrl`, size), `_aRequirements` (`[name, url]` pairs), `_sText` (HTML description)
- `https://gamebanana.com/apiv11/Mod/{id}/Posts?_nPage=1&_nPerpage=30&_sSort=newest`: comments (`_aRecords[]._sText`, `_tsDateAdded`), useful for spotting "crashes on 13.0.5" reports
- `https://gamebanana.com/apiv11/Mod/{id}/Updates?_nPage=1&_nPerpage=5`: changelog
- `https://gamebanana.com/apiv11/Util/Search/Results?_sModelName=Mod&_sOrder=best_match&_idGameRow=6498&_sSearchString=<q>`: search
- Downloads: `https://gamebanana.com/dl/{fileId}`

Notes: Python `urllib` with its default user agent got **403**; curl worked. Set a sensible `User-Agent` if calling from a server. **Test CORS from the browser early.** If it's blocked, add a tiny Vercel function proxy with caching, and respect GameBanana's terms and rate limits.

### 6.2 Identifying which mod a folder is
1. **Fingerprint database (best).** Build an offline script that, for popular Smash moveset mods, downloads each file version, hashes its `plugin.nro` (and maybe `config.json`), and stores `{hash → modId, fileId, version, date}` in `data/fingerprints.json`. Then a user's copy is identified **exactly**, including "you have an old version, the newer one was released X". Start with a few hundred popular mods; grow over time. Store hashes only, never the binaries.
2. **Name matching:** folder name and `config.json`/`info.toml` names vs GameBanana search. Show as a guess and let the user confirm.
3. **Manual link:** the user pastes the GameBanana URL once; remember it in `localStorage`.

### 6.3 What to show per mod
- Last updated, flagged against key dates:
  - before **1 Sept 2026** (game 13.0.5) → "pre-13.0.5, may be broken"
  - before **28 Oct 2026** (Smashline 2.0) → affects the ABI verdict
- Listed requirements vs what's installed.
- "Newer version available" (fingerprint match).
- Recent comments mentioning crash, 13.0.5, freeze or broke, as a "community reports" hint, clearly labelled as unverified.

Keep these dates in data (`data/milestones.json`), not code: future game or plugin updates will add more.

---

## 7. Later features (design for them, don't build yet)
- **Setups/profiles:** saved sets of active mods plus Smashline version ("1.6.8 set", "2.0 set"). Switching moves folders between `mods/` and `mods_all/` and swaps `libsmashline_plugin.nro` from a backup folder outside `plugins/`. Needs **write** permission via the File System Access API. Add a confirmation screen listing every move, and an undo log.
- **"Is this safe to add?":** paste a GameBanana link → fetch info (and the fingerprint if known) → compatibility verdict against the scanned setup before downloading.
- **Community signature library:**
  - opt-in log submission (strip nothing sensitive is present in these logs, but still show the user what's sent)
  - stored for review
  - new rules added by PR
  - credit contributors
- **Switch homebrew version** (much later): the same checks on-console.
- **Other games** with Skyline/ARCropolis-style stacks.

---

## 8. Data files provided (in this folder)
- `data/known_plugins.json`: verified SHA-256 + size for Smashline 1.6.7, 1.6.8 and 2.0.0, Param Config, CSK 6.0.0, One Slot Effects (13.0.5), Stage Config 1.1.1, official Skyline `subsdk9`/`main.npdm`, and the patched `subsdk9`. **Extend it** with ARCropolis (4.0.10, 4.1.0, 4.1.1), NRO Hook 0.4.0 and older builds by downloading release assets and hashing them yourself. **Never trust "latest" links for identification.** That exact mistake cost hours.
- `data/smashline_1.6.8_names.txt`, `data/smashline_2.0.0_names.txt`: `smashline_*` names present in each official binary.
- `fixtures/crash_logs/*.log` + `EXPECTED.json`: 28 real crash reports plus 1 non-crash log, with ground-truth diagnoses.
- `fixtures/modfiles_esa_2026-11-05.csv`: a real `Mod,Path,Size` listing of 17 active mods (the ultron/{Moveset} Shadow problem is in there). Expected scanner findings:
  - the nested-mod error in `ultron`
  - the `[UI] CSS 91-255 Slots` bracket-name info
  - no slot clashes
  - no xmsbt false positives
  - `Unlock All Characters` recognised as a CSK extra (`flags/unlock_all_fighters.flag`)
- `fixtures/private_mod_binaries/*.nro` + `EXPECTED.json`: 41 real moveset `plugin.nro` files with expected Smashline verdicts. **Add this folder to `.gitignore`.**

---

## 9. Milestones and definition of done
1. **Setup:** Vite + TS + Vitest repo, README, `.gitignore`, deploy "hello world" to Vercel. Teach Esa git basics as you go.
2. **Crash parser:** parses every fixture into a typed object (unit tests).
3. **Rules engine + 10 rules:** all fixtures match `EXPECTED.json` (tests pass).
4. **Explainer UI:** drag-and-drop, batch timeline, evidence panel. Deploy. *This is the first shippable version.* Esa can share it.
5. **Scanner core:** abstract file access, CSV mode, structure, hygiene and slot checks (tests on the CSV fixture).
6. **Binary checks:** hashing (known plugins), Smashline name scan (tests on the private binaries), compatibility matrix.
7. **Live folder mode:** `showDirectoryPicker`, progress bar (SD cards are slow; read only what you need: sizes for everything, bytes only for `.nro` files and small configs).
8. **Crash × scan cross-referencing.**
9. **GameBanana:** CORS test → proxy if needed → search, profile, comments → per-mod info.
10. **Fingerprint DB builder script** (Node, offline) + first batch.
11. Polish:
    - accessibility
    - mobile layout for the explainer (people often have the log on their phone)
    - dark mode
    - an about/FAQ page explaining the Switch modding stack in plain English (also a learning resource)
    - credits to the plugin authors

For each milestone, tell Esa what was built, how to try it, and what he learned.

---

## 10. Launch and distribution (when the Explainer is solid)
- **Write-up:** a short post explaining the tool, plus a demo GIF.
- **Where:**
  - GameBanana (Smash Ultimate → Tools/Apps section)
  - r/SmashBrosUltimate and modding subreddits
  - Smash modding Discords
  - replies to GitHub issues where users post these exact crashes. Smashline issue #95 (5 Nov 2026) is a live example; be genuinely helpful, not spammy.
- **Feedback loop:** a "this diagnosis was wrong/right" button feeding the rule library.
- **Metrics:** count diagnoses served (privacy-respecting, no logs stored without opt-in).
- Contact plugin authors (Skyline, Smashline, ARCropolis maintainers). The tool helps them by turning vague bug reports into precise ones.

---

## 11. Accuracy rules (non-negotiable)
- Never present a guess as fact. Use confidence levels everywhere.
- Every rule must be backed by at least one real log or a documented source.
- Identify versions by **hash**, never by filename or "latest" links.
- Don't flag normal things: the `stream;` folder, a few zero-byte files, shared `.xmsbt`/`.prcxml` patches, `manual_html`, `romfs_metadata.bin`.
- When unsure, tell the user how to confirm (e.g. "move X out and launch once").
- Nothing in the tool should facilitate piracy.

Good luck. Build it so the next person with a crashing Switch gets their answer in ten seconds instead of five hours.
