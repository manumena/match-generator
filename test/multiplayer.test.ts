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

it('starts once when every connected player is ready, restores guessing, and completes authoritatively', async () => {
  const animeId = Number(Object.keys(answerTitles)[0]);
  vi.mocked(prepareMatch).mockResolvedValue([
    { roundId: 'first', animeId, anime: 'Hidden anime', name: 'Hidden title', audioUrl: 'https://audio.example/one' },
  ]);
  const host = await post('/rooms', 'Host');
  const guest = await post(`/rooms/${host.room.code}/join`, 'Guest');
  const hostSocket = await open(host);
  const guestSocket = await open(guest);
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
  expect(countdown.startsAt! - Date.now()).toBeGreaterThan(9000);
  expect(JSON.stringify(snapshots)).not.toContain('Hidden anime');
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
  guestSocket.send(JSON.stringify({ v: 1, type: 'guess', roundId: 'first', actionId: 'two', animeId: null }));
  await vi.waitFor(async () => expect((await saved(host.room.code)).phase).toBe('completed'));
  expect((await saved(host.room.code)).players.map(player => player.score)).toEqual([2, 0]);
  hostSocket.close(1000);
  guestSocket.close(1000);
});
