import { describe, expect, it, vi } from 'vitest';
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import worker, { Room } from '../src';
import { env } from './fixtures';
import { newRoomCode } from '../src/rooms/validation';

interface Session {
  token: string;
  playerId: string;
  room: { code: string; hostId: string; players: { id: string; nickname: string; connected: boolean }[] };
}
function request(path: string, init?: RequestInit) {
  return worker.fetch(new Request(`https://api.example${path}`, init), env, {} as ExecutionContext);
}
function post(path: string, nickname: unknown) {
  return request(path, { method: 'POST', body: JSON.stringify({ nickname }) });
}
async function create(): Promise<Session> {
  const response = await post('/rooms', 'Host');
  expect(response.status).toBe(201);
  return response.json();
}
async function connect(session: Session, token = session.token) {
  return request(`/rooms/${session.room.code}/connect`, { headers: {
    Upgrade: 'websocket', Origin: 'https://animasters.pages.dev',
    'Sec-WebSocket-Protocol': `animasters, token.${token}`,
  } });
}
function nextSnapshot(socket: WebSocket): Promise<{ room: Session['room'] }> {
  return new Promise(resolve => socket.addEventListener('message', event => resolve(JSON.parse(event.data as string)), { once: true }));
}

describe('room lifecycle', () => {
  it('creates uppercase alphanumeric codes and keeps the credential out of snapshots', async () => {
    const session = await create();
    expect(session.room.code).toMatch(/^[A-Z0-9]{4}$/);
    expect(session.room.hostId).toBe(session.playerId);
    expect(session.room.players).toEqual([{ id: session.playerId, nickname: 'Host', connected: false }]);
    expect(JSON.stringify(session.room)).not.toContain(session.token);
  });

  it('joins by lowercase code and rejects duplicate nicknames and full rooms', async () => {
    const session = await create();
    const path = `/rooms/${session.room.code.toLowerCase()}/join`;
    expect((await post(path, ' host ')).status).toBe(409);
    for (let i = 1; i < 10; i++) expect((await post(path, `Player ${i}`)).status).toBe(201);
    const full = await post(path, 'Overflow');
    expect(full.status).toBe(409);
    expect(full.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('reserves a code only once under concurrent requests', async () => {
    const stub = env.ROOMS.getByName(`test-${crypto.randomUUID()}`);
    const reserve = () => stub.fetch('https://room/create', {
      method: 'POST', body: JSON.stringify({ code: 'A1B2', nickname: 'Host' }),
    });
    const responses = await Promise.all([reserve(), reserve()]);
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
  });

  it('retries a generated code collision without replacing its existing room', async () => {
    const stub = { fetch: vi.fn()
      .mockResolvedValueOnce(Response.json({ error: 'Code occupied' }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ success: true }, { status: 201 })) };
    const bindings = { ...env, ROOMS: { getByName: () => stub } as unknown as DurableObjectNamespace };
    const response = await worker.fetch(new Request('https://api.example/rooms', {
      method: 'POST', body: JSON.stringify({ nickname: 'Host' }),
    }), bindings, {} as ExecutionContext);
    expect(response.status).toBe(201);
    expect(stub.fetch).toHaveBeenCalledTimes(2);
  });

  it('authenticates sockets, broadcasts new players, and replaces an old tab', async () => {
    const session = await create();
    expect((await connect(session, crypto.randomUUID())).status).toBe(401);
    const response = await connect(session);
    expect(response.status).toBe(101);
    const socket = response.webSocket!;
    socket.accept();
    const initial = await nextSnapshot(socket);
    expect(initial.room.players[0].connected).toBe(true);
    const update = nextSnapshot(socket);
    expect((await post(`/rooms/${session.room.code}/join`, 'Guest')).status).toBe(201);
    expect((await update).room.players).toHaveLength(2);
    const closed = new Promise<number>(resolve => socket.addEventListener('close', event => resolve(event.code), { once: true }));
    const replacement = (await connect(session)).webSocket!;
    replacement.accept();
    expect(await closed).toBe(4001);
    const restored = await nextSnapshot(replacement);
    expect(restored.room.hostId).toBe(session.playerId);
    expect(restored.room.players).toHaveLength(2);
    replacement.close(1000);
  });

  it('expires abandoned rooms and refuses stale credentials after code reuse', async () => {
    const session = await create();
    const stub = env.ROOMS.getByName(session.room.code);
    await runInDurableObject(stub, async (_instance: Room, state) => {
      const row = state.storage.sql.exec<{ data: string }>('SELECT data FROM lobby').one();
      const room = JSON.parse(row.data);
      room.abandonedAt = Date.now() - 31 * 60 * 1000;
      state.storage.sql.exec('UPDATE lobby SET data = ?', JSON.stringify(room));
    });
    expect((await post(`/rooms/${session.room.code}/join`, 'Late')).status).toBe(404);
    expect((await stub.fetch('https://room/create', {
      method: 'POST', body: JSON.stringify({ code: session.room.code, nickname: 'New host' }),
    })).status).toBe(201);
    expect((await connect(session)).status).toBe(401);
  });

  it('retains players and sockets across hibernation, and keeps tokens private', async () => {
    const session = await create();
    const stub = env.ROOMS.getByName(session.room.code);
    const socket = (await connect(session)).webSocket!;
    socket.accept();
    await nextSnapshot(socket);
    await evictDurableObject(stub);
    const update = nextSnapshot(socket);
    await post(`/rooms/${session.room.code}/join`, 'After wake');
    const snapshot = await update;
    expect(snapshot.room.players[0].connected).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain(session.token);
    expect((await request(`/rooms/${session.room.code}/session`)).status).toBe(401);
    const authenticated = await request(`/rooms/${session.room.code}/session`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    expect(authenticated.status).toBe(200);
    socket.close(1000);
  });

  it('reschedules an early alarm and deletes the lobby once abandonment expires', async () => {
    const session = await create();
    const stub = env.ROOMS.getByName(session.room.code);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    await runInDurableObject(stub, async (_instance: Room, state) => {
      expect(await state.storage.getAlarm()).toBeGreaterThan(Date.now());
      const row = state.storage.sql.exec<{ data: string }>('SELECT data FROM lobby').one();
      const room = JSON.parse(row.data);
      room.abandonedAt = Date.now() - 31 * 60 * 1000;
      state.storage.sql.exec('UPDATE lobby SET data = ?', JSON.stringify(room));
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await post(`/rooms/${session.room.code}/join`, 'Too late')).status).toBe(404);
  });

  it.each(['', ' '.repeat(3), 'x'.repeat(25), 'bad\nname', null])('rejects invalid nickname %j', async nickname => {
    expect((await post('/rooms', nickname)).status).toBe(400);
  });

  it('rejects malformed bodies, invalid codes and oversized input', async () => {
    expect((await request('/rooms', { method: 'POST', body: '{' })).status).toBe(400);
    expect((await post('/rooms', 'x'.repeat(2000))).status).toBe(400);
    expect((await post('/rooms/A!B2/join', 'Guest')).status).toBe(400);
    const session = await create();
    expect((await request(`/rooms/${session.room.code}/connect`, { headers: {
      Upgrade: 'websocket', Origin: 'https://untrusted.example',
    } })).status).toBe(403);
  });

  it('generates codes using the full allowed character set', () => {
    for (let i = 0; i < 100; i++) expect(newRoomCode()).toMatch(/^[A-Z0-9]{4}$/);
  });
});
