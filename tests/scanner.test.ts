import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { csvSource, memorySource } from '../src/core/scanner/source';
import { scan } from '../src/core/scanner/scan';

const CSV = readFileSync('fixtures/modfiles_esa_2026-11-05.csv', 'utf8');

describe("CSV fixture (Esa's 17 active mods)", async () => {
  const r = await scan(csvSource(CSV));
  const ids = r.findings.map((f) => f.id);

  it('reads all 17 mods', () => expect(r.mods).toHaveLength(17));
  it('finds the nested Shadow inside ultron', () => {
    const f = r.findings.find((x) => x.id === 'nested_mod');
    expect(f?.mod).toBe('ultron');
    expect(f?.detail).toContain('{Moveset} Shadow');
    expect(r.findings.filter((x) => x.id === 'nested_mod')).toHaveLength(1);
  });
  it('flags the duplicate Shadow plugin by size (CSV cannot hash)', () => {
    const f = r.findings.find((x) => x.id === 'duplicate_moveset_plugin');
    expect(f?.confidence).toBe('possible');
    expect(f?.paths?.sort()).toEqual(['ultimate/mods/shadow/plugin.nro', 'ultimate/mods/ultron/{Moveset} Shadow/plugin.nro']);
  });
  it('gives bracket-name info for [UI] CSS 91-255 Slots', () => {
    const f = r.findings.find((x) => x.id === 'name_brackets' && x.mod === '[UI] CSS 91-255 Slots');
    expect(f?.severity).toBe('info');
  });
  it('finds no slot clashes and no xmsbt/prcxml false positives', () => {
    expect(ids).not.toContain('slot_clash');
    expect(ids).not.toContain('file_conflict');
  });
  it('recognises Unlock All Characters as a CSK extra', () => {
    const f = r.findings.find((x) => x.id === 'csk_extras');
    expect(f?.title).toContain('Unlock All Characters');
  });
  it('does not flag normal things', () => {
    expect(ids).not.toContain('empty_key_file'); // ~8 zero-byte placeholders per mod are normal
    expect(ids).not.toContain('wrapper_folder');
    expect(ids).not.toContain('dot_folders_in_mods');
    expect(ids).not.toContain('file_in_mods_root');
  });
  it('computes slot ranges from the brief', () => {
    const slots = Object.fromEntries(r.mods.map((m) => [m.name, m.slots]));
    expect(slots['Alucard']).toContain('Richter c120–127');
    expect(slots['blaze']).toContain('Sonic c80–91');
    expect(slots['tails']).toContain('Sonic c64–71');
    expect(slots['Ironman']).toContain('Mario c48–55');
    expect(slots['thwomp']).toContain('Ike c40–47');
    expect(slots['hilda']).toContain('Ike c128–135');
  });
  it('says what CSV mode skipped', () => expect(r.skipped.length).toBe(2));
});

describe('memory tree checks', () => {
  const sd = (extra: { path: string; size?: number; bytes?: string | Uint8Array }[]) =>
    memorySource([{ path: 'ultimate/mods/ok/fighter/mario/model/body/c08/model.numshb', size: 10 }, ...extra]);

  it('dot folders, loose files, wrappers, empty key files', async () => {
    const r = await scan(
      sd([
        { path: 'ultimate/mods/.old/fighter/mario/model/body/c09/a.nutexb', size: 5 },
        { path: 'ultimate/mods/Bandana Dee', size: 100 },
        { path: 'ultimate/mods/wrapped/Inner/fighter/luigi/model/body/c08/a.nutexb', size: 5 },
        { path: 'ultimate/mods/empty/config.json', size: 0 },
        { path: 'ultimate/mods/empty/fighter/fox/model/body/c08/a.nutexb', size: 5 },
      ]),
    );
    const ids = r.findings.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['dot_folders_in_mods', 'file_in_mods_root', 'wrapper_folder', 'empty_key_file']));
  });
  it('slot clash and same-file conflict, but shared xmsbt is fine', async () => {
    const r = await scan(
      sd([
        { path: 'ultimate/mods/a/fighter/sonic/model/body/c80/model.numshb', size: 5 },
        { path: 'ultimate/mods/b/fighter/sonic/model/body/c80/model.numshb', size: 6 },
        { path: 'ultimate/mods/a/ui/message/msg_name.xmsbt', size: 5 },
        { path: 'ultimate/mods/b/ui/message/msg_name.xmsbt', size: 5 },
      ]),
    );
    expect(r.findings.find((f) => f.id === 'slot_clash')?.title).toBe('a and b fight over Sonic c80');
    const conflict = r.findings.find((f) => f.id === 'file_conflict');
    expect(conflict?.paths).toEqual(['fighter/sonic/model/body/c80/model.numshb']);
  });
  it('base setup: plugin identification, backups, extra exefs, CSK extras without plugin', async () => {
    const T = 'atmosphere/contents/01006A800016E000/';
    const r = await scan(
      sd([
        { path: T + 'exefs/subsdk9', bytes: 'not really skyline' },
        { path: T + 'exefs/main.npdm', bytes: 'npdm' },
        { path: T + 'exefs/rtld', bytes: 'x' },
        { path: T + 'romfs/skyline/plugins/libarcropolis.nro', bytes: 'arc' },
        { path: T + 'romfs/skyline/plugins/libsmashline_plugin.nro', bytes: 'sl' },
        { path: T + 'romfs/skyline/plugins/libsmashline_plugin.nro.off', bytes: 'old' },
        { path: T + 'romfs/smashline/development.nro', bytes: 'dev' },
        { path: 'ultimate/mods/Unlock All/flags/unlock_all_fighters.flag', size: 0 },
        { path: 'ultimate/arcropolis/cache/13.0.5/offsets.toml', bytes: 'x' },
      ]),
    );
    const ids = r.findings.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['exefs_extra_files', 'non_nro_in_plugins', 'smashline_dev_plugin', 'csk_extras_without_plugin']));
    expect(r.base.items.find((i) => i.product === 'Smashline')?.version).toBe('unrecognised build');
    expect(r.base.gameVersion).toBe('13.0.5');
  });
});

const BIN = 'fixtures/private_mod_binaries/';
describe.skipIf(!existsSync(BIN))('binaries in a fake SD tree', () => {
  it('identical plugin.nro in two mods is certain; compat matrix and crash cross-reference', async () => {
    const shadow = new Uint8Array(readFileSync(BIN + 'shadow_plugin.nro'));
    const tetri = new Uint8Array(readFileSync(BIN + 'tetrimino_plugin.nro'));
    const goomba = new Uint8Array(readFileSync(BIN + 'goomba_plugin.nro'));
    const blaze = new Uint8Array(readFileSync(BIN + 'blaze_new_plugin.nro'));
    const logName = '01793917137_01006a800016e000.log';
    const r = await scan(
      memorySource([
        { path: 'ultimate/mods/shadow/plugin.nro', bytes: shadow },
        { path: 'ultimate/mods/ultron/{Moveset} Shadow/plugin.nro', bytes: shadow },
        { path: 'ultimate/mods/ultron/fighter/ganon/model/body/c64/a.nutexb', size: 3 },
        { path: 'ultimate/mods/tetrimino/plugin.nro', bytes: tetri },
        { path: 'ultimate/mods/goomba/plugin.nro', bytes: goomba },
        { path: 'ultimate/mods/blaze/plugin.nro', bytes: blaze },
        { path: 'atmosphere/crash_reports/' + logName, bytes: readFileSync('fixtures/crash_logs/' + logName) },
      ]),
      { lastUpdated: { blaze: new Date('2026-09-15') } },
    );
    const dup = r.findings.find((f) => f.id === 'duplicate_moveset_plugin');
    expect(dup?.confidence).toBe('certain');
    expect(r.findings.some((f) => f.id === 'needs_unreleased_smashline' && f.mod === 'tetrimino')).toBe(true);
    const v168 = r.matrix.versions.find((v) => v.version === '1.6.8')!;
    expect(v168.works).toContain('blaze');
    expect(v168.breaks).toEqual(expect.arrayContaining(['goomba', 'tetrimino']));
    expect(r.crashes[0]?.best.ruleId).toBe('smashline2_old_clone_weapon_abi');
    const x = r.findings.find((f) => f.id === 'xref_smashline2_culprits');
    expect(x?.title).toContain('tetrimino');
    expect(x?.title).toContain('blaze');
  });
});
