import { describe, expect, it } from 'vitest';
import { advance, answerTitles, beginCountdown, hydrateRoom, publicSnapshot, setReady, submit, CATALOG_VERSION } from '../src/rooms/game';

const ids = Object.keys(answerTitles).slice(0, 3).map(Number);
function match(players = 4, songs = 2) {
  const room = hydrateRoom({
    code: 'TEST', hostId: 'p0', abandonedAt: null,
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, nickname: `Player ${i}`, token: `secret-${i}` })),
    songs: Array.from({ length: songs }, (_, i) => ({ roundId: `round-${i}`, animeId: ids[i % ids.length], anime: `Private answer ${i}`, name: `Private title ${i}`, audioUrl: `https://audio.example/${i}` })),
  });
  const connected = room.players.map(player => player.id);
  beginCountdown(room, 0, connected);
  return { room, connected };
}
function answer(room: ReturnType<typeof match>['room'], player: number, animeId: number | null, now: number, actionId = `action-${player}`) {
  const connected = room.players.map(member => member.id);
  advance(room, now, connected);
  return submit(room, room.players[player], { roundId: 'round-0', animeId, actionId }, now, connected);
}

describe('authoritative match rules', () => {
  it('pins the catalog and keeps the first countdown at ten seconds', () => {
    const { room, connected } = match();
    expect(room.catalogVersion).toBe(CATALOG_VERSION);
    expect(room.startsAt).toBe(10_000);
    expect(setReady(room, room.players[0], 'round-0', CATALOG_VERSION, 1, connected)).toBeDefined();
    expect(room.startsAt).toBe(10_000);
    advance(room, 9_999, connected);
    expect(room.phase).toBe('countdown');
    advance(room, 10_000, connected);
    expect(room.phase).toBe('guessing');
    expect(room.deadline).toBe(100_000);
  });

  it('scores wrong/first-correct/pass/second-correct as -1,+4,0,+3', () => {
    const { room } = match();
    expect(answer(room, 0, ids[1], 12_000)).toBeUndefined();
    expect(room.deadline).toBe(32_000);
    answer(room, 1, ids[0], 13_000);
    const hidden = publicSnapshot(room, ['p0', 'p1', 'p2', 'p3'], 'p1');
    expect(hidden.players.every(player => player.score === 0)).toBe(true);
    expect(hidden.submission).toEqual({ actionId: 'action-1', animeId: ids[0] });
    expect(JSON.stringify(hidden)).not.toContain('Private answer');
    expect(JSON.stringify(hidden)).not.toContain('Private title');
    expect(JSON.stringify(hidden)).not.toContain('secret-');
    expect(JSON.stringify(hidden)).not.toContain('https://audio.example/1');
    expect(hidden).not.toHaveProperty('songs');
    answer(room, 2, null, 14_000);
    answer(room, 3, ids[0], 15_000);
    expect(room.result?.players.map(player => player.points)).toEqual([-1, 4, 0, 3]);
    expect(room.players.map(player => player.score)).toEqual([-1, 4, 0, 3]);
    expect(room.startsAt).toBe(25_000);
  });

  it('deduplicates accepted actions and refuses a different second answer', () => {
    const { room } = match();
    answer(room, 0, ids[0], 10_001);
    expect(answer(room, 0, ids[0], 10_002)).toBeUndefined();
    expect(answer(room, 0, ids[1], 10_003, 'replacement')).toBeDefined();
    expect(Object.keys(room.submissions)).toHaveLength(1);
    answer(room, 1, ids[0], 10_004);
    expect(room.submissions.p1.points).toBe(3);
  });

  it('does not start the short timer for passes, and reveals when all pass', () => {
    const { room } = match(2, 1);
    answer(room, 0, null, 15_000);
    expect(room.deadline).toBe(100_000);
    answer(room, 1, null, 16_000);
    expect(room.phase).toBe('completed');
    expect(room.completedAt).toBe(16_000);
    expect(room.players.map(player => player.score)).toEqual([0, 0]);
  });

  it('caps late first guesses at 90 seconds and rejects deadline-boundary submissions', () => {
    const { room } = match();
    answer(room, 0, ids[0], 95_000);
    expect(room.deadline).toBe(100_000);
    expect(answer(room, 1, ids[0], 100_000)).toBeDefined();
    expect(room.result?.players.map(player => player.points)).toEqual([4, 0, 0, 0]);
  });

  it('pauses between rounds when all disconnect and resumes with a fresh countdown', () => {
    const { room, connected } = match();
    advance(room, 10_000, connected);
    advance(room, 100_000, []);
    expect(room.phase).toBe('paused');
    expect(room.roundIndex).toBe(1);
    advance(room, 120_000, ['p0']);
    expect(room.startsAt).toBe(130_000);
    expect(room.phase).toBe('countdown');
    setReady(room, room.players[0], 'round-1', CATALOG_VERSION, 120_001, ['p0']);
    expect(room.startsAt).toBe(120_501);
  });

  it('rejects unknown IDs without treating them as wrong or starting the short timer', () => {
    const { room } = match();
    expect(answer(room, 0, -20, 10_001)).toBeDefined();
    expect(room.submissions).toEqual({});
    expect(room.deadline).toBe(100_000);
  });

  it('recovers a timed-out preparation and permits another readiness attempt', () => {
    const { room } = match();
    room.phase = 'preparing';
    room.generationId = 'old';
    room.preparationDeadline = 500;
    room.players.forEach(player => { player.ready = true; });
    advance(room, 500, ['p0']);
    expect(room.phase).toBe('lobby');
    expect(room.generationId).toBeUndefined();
    expect(room.players.every(player => !player.ready)).toBe(true);
  });
});
