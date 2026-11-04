import { expect, it, vi } from 'vitest';
import { runInDurableObject, runDurableObjectAlarm } from 'cloudflare:test';
import worker, { Room } from '../src';
import { env } from './fixtures';
import { CATALOG_VERSION, answerTitles, type RoomState } from '../src/rooms/game';
import { prepareMatch } from '../src/rooms/match';

vi.mock('../src/rooms/match', async importOriginal => ({
  ...await importOriginal<typeof import('../src/rooms/match')>(), prepareMatch: vi.fn(),
}));
interface Session { token: string; playerId: string; room: { code: string } }
async function post(path: string, nickname: string): Promise<Session> {
  const response = await worker.fetch(new Request(`https://api.example${path}`, {
    method: 'POST', body: JSON.stringify({ nickname }),
  }), env, {} as ExecutionContext);
  return response.json();
}
async function open(session: Session) {
  const response = await worker.fetch(new Request(`https://api.example/rooms/${session.room.code}/connect`, {
    headers: { Upgrade: 'websocket', Origin: 'https://animasters.pages.dev', 'Sec-WebSocket-Protocol': `animasters, token.${session.token}` },
  }), env, {} as ExecutionContext);
  const socket = response.webSocket!;
  socket.accept();
  return socket;
}
async function saved(code: string): Promise<RoomState> {
  return runInDurableObject(env.ROOMS.getByName(code), (_instance: Room, state) =>
    JSON.parse(state.storage.sql.exec<{ data: string }>('SELECT data FROM lobby').one().data));
}

it.each([false, true])('runs the countdown while generation is pending (times out: %s)', async timesOut => {
  const songs = [{
    roundId: 'prepared-song',
    animeId: Number(Object.keys(answerTitles)[0]),
    anime: 'Hidden anime',
    name: 'Hidden title',
    audioUrl: 'https://audio.example/prepared',
  }];
  let finishGeneration!: (value: typeof songs) => void;
  const generation = new Promise<typeof songs>(resolve => { finishGeneration = resolve; });
  vi.mocked(prepareMatch).mockReturnValueOnce(generation);

  const host = await post('/rooms', 'Host');
  const socket = await open(host);
  const snapshots: { room: { phase: string; matchStartsAt?: number } }[] = [];
  socket.addEventListener('message', event => { snapshots.push(JSON.parse(event.data as string)); });
  const ready = JSON.stringify({ v: 1, type: 'ready', catalogVersion: CATALOG_VERSION, settingsRevision: 0 });
  socket.send(ready);

  await vi.waitFor(async () => expect((await saved(host.room.code)).phase).toBe('preparing'));
  const preparing = await saved(host.room.code);
  await vi.waitFor(() => expect(snapshots).toContainEqual(expect.objectContaining({
    room: expect.objectContaining({ phase: 'preparing', matchStartsAt: preparing.preparationDeadline }),
  })));

  if (timesOut) {
    const stub = env.ROOMS.getByName(host.room.code);
    // Expire the fixed budget without waiting five wall-clock seconds.
    await runInDurableObject(stub, (_instance: Room, state) => {
      const room = JSON.parse(state.storage.sql.exec<{ data: string }>('SELECT data FROM lobby').one().data);
      room.preparationDeadline = Date.now() - 1;
      state.storage.sql.exec('UPDATE lobby SET data = ?', JSON.stringify(room));
    });
    await runDurableObjectAlarm(stub);
    const failed = await saved(host.room.code);
    expect(failed.phase).toBe('lobby');
    expect(failed.error).toBe('This is taking longer than expected.');
    expect(failed.players.every(player => !player.ready)).toBe(true);

    // An obsolete response must not replace a fresh readiness attempt.
    vi.mocked(prepareMatch).mockResolvedValueOnce([{ ...songs[0], roundId: 'retry-song' }]);
    socket.send(ready);
    finishGeneration(songs);
    await vi.waitFor(async () => expect((await saved(host.room.code)).phase).toBe('countdown'));
    expect((await saved(host.room.code)).songs?.[0].roundId).toBe('retry-song');
  } else {
    finishGeneration(songs);
    await vi.waitFor(async () => expect((await saved(host.room.code)).phase).toBe('countdown'));
    expect((await saved(host.room.code)).startsAt).toBe(preparing.preparationDeadline);
  }

  socket.close(1000);
});

it('completes a match, preserves standings on rematch failure, and starts one fresh match after retry', async () => {
  const animeId = Number(Object.keys(answerTitles)[0]);
  vi.mocked(prepareMatch).mockResolvedValue([
    {
      roundId: 'first', animeId, anime: 'Hidden anime', name: 'Hidden title',
      audioUrl: 'https://audio.example/one',
      artworkUrl: 'https://images.example/first-poster.jpg',
    },
  ]);
  const host = await post('/rooms', 'Host');
  const guest = await post(`/rooms/${host.room.code}/join`, 'Guest');
  const hostSocket = await open(host);
  let guestSocket = await open(guest);
  const snapshots: { room: { phase: string; result?: unknown; submission?: unknown } }[] = [];
  hostSocket.addEventListener('message', event => { snapshots.push(JSON.parse(event.data as string)); });
  // The guest's old readiness must be cleared when the host saves preferences.
  const oldReady = JSON.stringify({ v: 1, type: 'ready', catalogVersion: CATALOG_VERSION });
  guestSocket.send(oldReady);
  await vi.waitFor(async () => expect((await saved(host.room.code)).players[1].ready).toBe(true));
  const preferences = { amount: 1, repeatAnimes: false, includeOpenings: false, includeEndings: true, includeSoundtracks: false };
  hostSocket.send(JSON.stringify({ v: 1, type: 'settings', settings: preferences, settingsRevision: 0 }));
  await vi.waitFor(async () => expect((await saved(host.room.code)).settingsRevision).toBe(1));
  expect((await saved(host.room.code)).players.every(player => !player.ready)).toBe(true);
  const ready = JSON.stringify({ v: 1, type: 'ready', catalogVersion: CATALOG_VERSION, settingsRevision: 1 });
  hostSocket.send(ready);
  await vi.waitFor(async () => expect((await saved(host.room.code)).players[0].ready).toBe(true));
  expect(prepareMatch).not.toHaveBeenCalled();
  guestSocket.send(ready);
  guestSocket.send(ready);
  await vi.waitFor(async () => expect((await saved(host.room.code)).phase).toBe('countdown'));
  expect(prepareMatch).toHaveBeenCalledTimes(1);
  expect(prepareMatch).toHaveBeenCalledWith(expect.anything(), preferences);
  const countdown = await saved(host.room.code);
  expect(countdown.startsAt! - Date.now()).toBeGreaterThan(4000);
  expect(JSON.stringify(snapshots)).not.toContain('Hidden anime');
  expect(JSON.stringify(snapshots)).not.toContain('first-poster.jpg');
  const denied = await worker.fetch(new Request(`https://api.example/rooms/${host.room.code}/join`, {
    method: 'POST', body: JSON.stringify({ nickname: 'Late' }),
  }), env, {} as ExecutionContext);
  expect(denied.status).toBe(409);

  const stub = env.ROOMS.getByName(host.room.code);
  await runInDurableObject(stub, (_instance: Room, state) => {
    const room = JSON.parse(state.storage.sql.exec<{ data: string }>('SELECT data FROM lobby').one().data);
    room.startsAt = Date.now() - 1;
    state.storage.sql.exec('UPDATE lobby SET data = ?', JSON.stringify(room));
  });
  await runDurableObjectAlarm(stub);
  hostSocket.send(JSON.stringify({ v: 1, type: 'guess', roundId: 'first', actionId: 'one', animeId }));
  await vi.waitFor(async () => expect((await saved(host.room.code)).submissions[host.playerId]).toBeDefined());
  expect(JSON.stringify(snapshots)).not.toContain('first-poster.jpg');
  guestSocket.send(JSON.stringify({ v: 1, type: 'guess', roundId: 'first', actionId: 'two', animeId: null }));
  await vi.waitFor(async () => expect((await saved(host.room.code)).phase).toBe('results'));
  await vi.waitFor(() => expect(snapshots).toContainEqual(expect.objectContaining({
    room: expect.objectContaining({
      phase: 'results',
      result: expect.objectContaining({ artworkUrl: 'https://images.example/first-poster.jpg' }),
    }),
  })));
  expect((await saved(host.room.code)).players.map(player => player.score)).toEqual([2, 0]);

  const finalReveal = await saved(host.room.code);
  expect(finalReveal.startsAt! - Date.now()).toBeGreaterThan(9_000);
  expect(finalReveal.completedAt).toBeUndefined();
  expect(await runInDurableObject(stub, (_instance: Room, state) => state.storage.getAlarm())).toBe(finalReveal.startsAt);
  const readyForResults = JSON.stringify({ v: 1, type: 'ready', roundId: 'first' });
  hostSocket.send(readyForResults);
  await vi.waitFor(async () => expect((await saved(host.room.code)).players[0].ready).toBe(true));
  expect((await saved(host.room.code)).startsAt).toBe(finalReveal.startsAt);
  guestSocket.send(readyForResults);
  await vi.waitFor(async () => expect((await saved(host.room.code)).startsAt!).toBeLessThan(finalReveal.startsAt!));
  await vi.waitFor(async () => expect((await saved(host.room.code)).phase).toBe('completed'));
  expect((await saved(host.room.code)).players.every(player => !player.ready)).toBe(true);

  // Keep the same room and standings while players choose a rematch.
  const playAgain = (revision: number) => JSON.stringify({
    v: 1, type: 'ready-next-match', completedRoundId: 'first',
    catalogVersion: CATALOG_VERSION, settingsRevision: revision,
  });
  guestSocket.send(playAgain(1));
  await vi.waitFor(async () => expect((await saved(host.room.code)).players[1].ready).toBe(true));
  // A refreshed browser must enable audio and opt in again, even after completion.
  guestSocket = await open(guest);
  expect((await saved(host.room.code)).players[1].ready).toBe(false);
  guestSocket.send(playAgain(1));
  await vi.waitFor(async () => expect((await saved(host.room.code)).players[1].ready).toBe(true));
  const nextPreferences = { ...preferences, includeOpenings: true };
  hostSocket.send(JSON.stringify({ v: 1, type: 'settings', settings: nextPreferences, settingsRevision: 1 }));
  await vi.waitFor(async () => expect((await saved(host.room.code)).settingsRevision).toBe(2));
  const waiting = await saved(host.room.code);
  expect(waiting.phase).toBe('completed');
  expect(waiting.players.every(player => !player.ready)).toBe(true);
  expect(waiting.players.map(player => player.score)).toEqual([2, 0]);

  // A failed rematch returns to the final standings, with settings still editable.
  vi.mocked(prepareMatch).mockRejectedValueOnce(new Error('Temporary generator failure'));
  hostSocket.send(playAgain(2));
  await vi.waitFor(async () => expect((await saved(host.room.code)).players[0].ready).toBe(true));
  hostSocket.send(JSON.stringify({ v: 1, type: 'unready' }));
  await vi.waitFor(async () => expect((await saved(host.room.code)).players[0].ready).toBe(false));
  hostSocket.send(playAgain(2));
  await vi.waitFor(async () => expect((await saved(host.room.code)).players[0].ready).toBe(true));
  expect(prepareMatch).toHaveBeenCalledTimes(1);
  guestSocket.send(playAgain(2));
  await vi.waitFor(async () => expect((await saved(host.room.code)).error).toContain('Could not prepare'));
  const failed = await saved(host.room.code);
  expect(failed.phase).toBe('completed');
  expect(failed.completedAt).toBe(waiting.completedAt);
  expect(failed.result).toEqual(waiting.result);
  expect(failed.players.map(player => player.score)).toEqual([2, 0]);
  expect(failed.players.every(player => !player.ready)).toBe(true);

  // Retrying creates one fresh sequence and resets only match-specific state.
  vi.mocked(prepareMatch).mockResolvedValueOnce([
    { roundId: 'second-match', animeId, anime: 'Next anime', name: 'Next title', audioUrl: 'https://audio.example/two' },
  ]);
  hostSocket.send(playAgain(2));
  guestSocket.send(playAgain(2));
  guestSocket.send(playAgain(2));
  await vi.waitFor(async () => expect((await saved(host.room.code)).phase).toBe('countdown'));
  expect(prepareMatch).toHaveBeenCalledTimes(3);
  expect(prepareMatch).toHaveBeenLastCalledWith(expect.anything(), nextPreferences);
  const rematch = await saved(host.room.code);
  expect(rematch.code).toBe(host.room.code);
  expect(rematch.players.map(player => player.id)).toEqual([host.playerId, guest.playerId]);
  expect(rematch.players.map(player => player.score)).toEqual([0, 0]);
  expect(rematch.result).toBeUndefined();
  expect(rematch.completedAt).toBeUndefined();
  expect(rematch.submissions).toEqual({});
  expect(rematch.roundIndex).toBe(0);
  expect(rematch.songs?.[0].roundId).toBe('second-match');
  expect(rematch.startsAt! - Date.now()).toBeGreaterThan(4000);
  const alarm = await runInDurableObject(stub, (_instance: Room, state) => state.storage.getAlarm());
  expect(alarm).toBe(rematch.startsAt);
  hostSocket.close(1000);
  guestSocket.close(1000);
});

it.each([true, false])('reveals the song after all connected players submit (disconnect first: %s)', async disconnectFirst => {
  const host = await post('/rooms', 'Host');
  const guest = await post(`/rooms/${host.room.code}/join`, 'Guest');
  const departing = await post(`/rooms/${host.room.code}/join`, 'Departing');
  const hostSocket = await open(host);
  const guestSocket = await open(guest);
  const departingSocket = await open(departing);
  const snapshots: { room: {
    phase: string;
    players: { id: string; connected: boolean; ready: boolean }[];
    result?: { roundId: string };
  } }[] = [];
  hostSocket.addEventListener('message', event => {
    snapshots.push(JSON.parse(event.data as string));
  });

  const stub = env.ROOMS.getByName(host.room.code);
  const deadline = Date.now() + 60_000;
  await runInDurableObject(stub, (_instance: Room, state) => {
    const room: RoomState = JSON.parse(state.storage.sql.exec<{ data: string }>('SELECT data FROM lobby').one().data);
    const song = { animeId: 1, anime: 'Anime', name: 'Song', audioUrl: 'https://audio.example/song' };
    room.songs = [{ ...song, roundId: 'first' }, { ...song, roundId: 'second' }];
    room.phase = 'guessing';
    room.roundIndex = 0;
    room.startsAt = Date.now() - 1_000;
    room.deadline = deadline;
    state.storage.sql.exec('UPDATE lobby SET data = ?', JSON.stringify(room));
  });

  const disconnect = async () => {
    departingSocket.close(1000);
    await vi.waitFor(() => expect(snapshots.some(snapshot =>
      snapshot.room.players.some(player => player.id === departing.playerId && !player.connected),
    )).toBe(true));
  };
  const guess = JSON.stringify({ v: 1, type: 'guess', roundId: 'first', actionId: 'answer', animeId: 1 });
  if (disconnectFirst) await disconnect();

  hostSocket.send(guess);
  await vi.waitFor(async () => expect((await saved(host.room.code)).submissions[host.playerId]).toBeDefined());
  expect((await saved(host.room.code)).phase).toBe('guessing');

  guestSocket.send(guess);
  if (!disconnectFirst) {
    await vi.waitFor(async () => expect((await saved(host.room.code)).submissions[guest.playerId]).toBeDefined());
    expect((await saved(host.room.code)).phase).toBe('guessing');
    await disconnect();
  }

  await vi.waitFor(() => expect(snapshots.some(snapshot =>
    snapshot.room.phase === 'countdown' && snapshot.room.result?.roundId === 'first',
  )).toBe(true));
  const countdown = await saved(host.room.code);
  expect(countdown.roundIndex).toBe(1);
  expect(countdown.result?.players).toEqual([
    { id: host.playerId, guess: answerTitles[1], correct: true, points: 3 },
    { id: guest.playerId, guess: answerTitles[1], correct: true, points: 2 },
    { id: departing.playerId, guess: null, correct: false, points: 0 },
  ]);
  expect(await runInDurableObject(stub, (_instance: Room, state) => state.storage.getAlarm())).toBe(countdown.startsAt);

  hostSocket.close(1000);
  guestSocket.close(1000);
});
