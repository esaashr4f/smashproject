import { describe, expect, it } from 'vitest';
import { fetchMod, milestoneFlags, parseModId, problemReports, requirementProduct } from '../src/core/gamebanana';

// Shapes copied from real API responses (Herobrine, mod 559266).
const profile = {
  _sName: 'Herobrine V2.75 [ MOVESET ]',
  _sVersion: 'v2.5',
  _sProfileUrl: 'https://gamebanana.com/mods/559266',
  _tsDateUpdated: 1793848012,
  _aRequirements: [['Smashline 2', 'https://github.com/HDR-Development/smashline/releases/latest'], ['The CSK Collection', 'https://gamebanana.com/mods/499008']],
  _aFiles: [{ _idRow: 1877181, _sFile: 'herobrine_moveset.zip', _tsDateAdded: 1793847861, _nFilesize: 44126292, _sDownloadUrl: 'https://gamebanana.com/dl/1877181', _sDescription: '2.75 ( Smashline V2.2 )' }],
};
const posts = { _aRecords: [{ _sText: '<p>How do you get it to work on 13.0.5? It crashes my game.</p>', _tsDateAdded: 1792294368 }, { _sText: '<p>Love it!</p>', _tsDateAdded: 1792294000 }] };
const fakeFetch = async (url: string) => ({ ok: true, status: 200, json: async () => (url.includes('/Posts') ? posts : profile) });

describe('GameBanana', () => {
  it('parses a profile', async () => {
    const m = await fetchMod(559266, fakeFetch);
    expect(m.name).toContain('Herobrine');
    expect(m.updated?.toISOString().slice(0, 10)).toBe('2026-11-05');
    expect(m.requirements.map((r) => requirementProduct(r.name))).toEqual(['Smashline', 'The CSK Collection']);
    expect(m.files[0]?.downloadUrl).toBe('https://gamebanana.com/dl/1877181');
  });
  it('keeps only problem comments, as plain text', async () => {
    const p = await problemReports(559266, fakeFetch);
    expect(p).toHaveLength(1);
    expect(p[0]?.text).toBe('How do you get it to work on 13.0.5? It crashes my game.');
  });
  it('parses links and milestone flags', () => {
    expect(parseModId('https://gamebanana.com/mods/559266')).toBe(559266);
    expect(parseModId('559266')).toBe(559266);
    expect(milestoneFlags(new Date('2026-10-01')).map((f) => f.label)).toEqual(['before Smashline 2.0.0']);
    expect(milestoneFlags(new Date('2025-01-01'))).toHaveLength(2);
    expect(milestoneFlags(new Date('2026-11-05'))).toHaveLength(0);
  });
});
