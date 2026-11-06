// About / FAQ: the Switch modding stack in plain English, plus credits.
import { h } from './dom';

const CREDITS: [string, string][] = [
  ['Atmosphère', 'https://github.com/Atmosphere-NX/Atmosphere'],
  ['Skyline', 'https://github.com/skyline-dev/skyline'],
  ['ARCropolis', 'https://github.com/Raytwo/ARCropolis'],
  ['Smashline', 'https://github.com/HDR-Development/smashline'],
  ['NRO Hook', 'https://github.com/ultimate-research/nro-hook-plugin'],
];

const QA: [string, (string | HTMLElement)[]][] = [
  ['What is this?', ['A free tool that reads Atmosphère crash reports and your SD card, and tells you in plain English what broke and how to fix it. Think LOOT for Skyrim, but for Smash Ultimate mods.']],
  ['Is anything uploaded?', ['No. Everything runs in your browser on your device. The only network requests are the optional GameBanana lookups, which go straight from your browser to GameBanana. Crash logs and files never leave your computer unless you choose to share them in a feedback issue.']],
  ['How does the modding stack fit together?', [
    h('ul', {},
      h('li', {}, h('strong', {}, 'Atmosphère'), ': the custom firmware. It lets the console load modified game files and writes crash reports to atmosphere/crash_reports/.'),
      h('li', {}, h('strong', {}, 'Skyline'), ': a code-injection framework. Atmosphère loads it into Smash as exefs/subsdk9 (+ main.npdm), and it then loads every plugin in romfs/skyline/plugins/.'),
      h('li', {}, h('strong', {}, 'ARCropolis'), ': a Skyline plugin that swaps game files for the ones in ultimate/mods/. Almost every mod depends on it.'),
      h('li', {}, h('strong', {}, 'Smashline'), ': a plugin that lets movesets add new code (their plugin.nro). Version 2.0.0 changed some functions, which is why old movesets crash on it and new ones crash on 1.6.8.'),
      h('li', {}, h('strong', {}, 'Param Config, One Slot Effects, Stage Config, The CSK Collection, NRO Hook'), ': other plugins that movesets and UI mods rely on.'),
    ),
  ]],
  ['What does "confidence" mean?', ['Certain: the evidence leaves no doubt (e.g. an exact crash signature or a file hash). Likely: matches a known real case. Possible: a reasonable guess, so confirm it (usually by moving one mod out and launching once).']],
  ['Why does a crash make the game check for corrupted data?', ['After any crash, Smash runs its "corrupted data check" on the next launch. It\'s normal and harmless, but it makes trial-and-error slow, which is why this tool tries to get the answer from the log.']],
  ['How do I get files off my Switch?', ['Boot Hekate, open Tools → USB Tools → SD Card, and connect the Switch to your PC. The SD card shows up as a drive (mass storage), which is faster and more reliable than MTP. Crash logs are in atmosphere/crash_reports/.']],
  ['Does this help with piracy?', ['No. This tool only diagnoses mods for a game you own. Anything to do with piracy is out of scope.']],
  ['A diagnosis was wrong. What now?', ['Use the 👎 link under the diagnosis. It opens a GitHub issue with the summary filled in, so the rule can be fixed. Rules live in a data file, so new crash types can be added by anyone through a pull request.']],
];

export function renderAbout(root: HTMLElement) {
  root.append(
    h('section', { class: 'hero' }, h('h1', {}, 'About Smash Mod Doctor')),
    ...QA.map(([q, a]) => h('section', { class: 'panel' }, h('h3', {}, q), ...a.map((x) => (typeof x === 'string' ? h('p', {}, x) : x)))),
    h(
      'section',
      { class: 'panel' },
      h('h3', {}, 'Credits'),
      h('p', {}, 'This tool only exists because of the people who build and maintain the modding stack. Please support them:'),
      h(
        'ul',
        {},
        ...CREDITS.map(([name, url]) => h('li', {}, h('a', { href: url, target: '_blank', rel: 'noopener' }, name))),
        h('li', {}, 'Param Config, One Slot Effects, Stage Config and The CSK Collection authors, and every moveset creator on GameBanana.'),
      ),
      h('p', {}, 'Built by Esa. Open source under the MIT licence.'),
    ),
  );
}
