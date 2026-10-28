import { describe, expect, it } from 'vitest';
import { CATALOG_VERSION, DEFAULT_SETTINGS, hydrateRoom, setReady, updateSettings } from '../src/rooms/game';

function lobby() {
  return hydrateRoom({
    code: 'TEST', hostId: 'host', abandonedAt: null,
    players: [
      { id: 'host', nickname: 'Host', token: 'private-host', ready: true },
      { id: 'guest', nickname: 'Guest', token: 'private-guest', ready: true },
    ],
  });
}
const settings = { ...DEFAULT_SETTINGS, amount: 10, includeEndings: false, includeSoundtracks: false };

describe('match preferences', () => {
  it('saves the host choices and clears readiness only when settings change', () => {
    const room = lobby();
    expect(updateSettings(room, room.players[0], settings, 0)).toBeUndefined();
    expect(room.settings).toEqual(settings);
    expect(room.settingsRevision).toBe(1);
    expect(room.players.every(player => !player.ready)).toBe(true);
    room.players[1].ready = true;
    expect(updateSettings(room, room.players[0], settings, 0)).toBeUndefined();
    expect(room.players[1].ready).toBe(true);
    expect(room.settingsRevision).toBe(1);
  });

  it('rejects a guest, locked match and stale edit without changing stored settings', () => {
    const room = lobby();
    expect(updateSettings(room, room.players[1], settings, 0)).toContain('host');
    expect(updateSettings(room, room.players[0], settings, -1)).toContain('another tab');
    room.phase = 'preparing';
    expect(updateSettings(room, room.players[0], settings, 0)).toContain('locked');
    expect(room.settings).toEqual(DEFAULT_SETTINGS);
  });

  it.each([0, -1, 1000, 1.5, '10', null, Infinity])('rejects invalid count %j', amount => {
    const room = lobby();
    expect(updateSettings(room, room.players[0], { ...settings, amount }, 0)).toContain('whole number');
    expect(room.settingsRevision).toBe(0);
  });

  it('validates booleans and never accepts a repeat-anime override', () => {
    const room = lobby();
    expect(updateSettings(room, room.players[0], { ...settings, includeEndings: 'false' }, 0)).toContain('true or false');
    expect(updateSettings(room, room.players[0], { ...settings, repeatAnimes: true }, 0)).toBeUndefined();
    expect(room.settings.repeatAnimes).toBe(false);
  });

  it('rejects an in-flight Ready for the old preferences', () => {
    const room = lobby();
    updateSettings(room, room.players[0], settings, 0);
    expect(setReady(room, room.players[1], undefined, CATALOG_VERSION, 0, ['host', 'guest'], 0)).toContain('settings changed');
    expect(room.players[1].ready).toBe(false);
    expect(setReady(room, room.players[1], undefined, CATALOG_VERSION, 0, ['host', 'guest'], 1)).toBeUndefined();
  });
});
