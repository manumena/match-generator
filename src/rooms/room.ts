import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import { nicknameFrom, ROOM_TTL } from './validation';
import { advance, beginCountdown, hydrateRoom, publicSnapshot, setReady, submit, updateSettings, type RoomState } from './game';
import { MatchAvailabilityError, prepareMatch } from './match';

interface Attachment { playerId: string }

/** One SQLite-backed object owns a room. Small mutations are serialized; remote
 * catalog work runs separately, guarded by a persisted preparation attempt ID. */
export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS lobby (id INTEGER PRIMARY KEY, data TEXT NOT NULL)');
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private read(): RoomState | undefined {
    const row = this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM lobby WHERE id = 1').toArray()[0];
    return row ? hydrateRoom(JSON.parse(row.data)) : undefined;
  }

  private sockets(playerId?: string): WebSocket[] {
    return this.ctx.getWebSockets().filter(socket =>
      socket.readyState === WebSocket.OPEN &&
      (!playerId || (socket.deserializeAttachment() as Attachment).playerId === playerId));
  }

  private connected(): string[] {
    return [...new Set(this.sockets().map(socket => (socket.deserializeAttachment() as Attachment).playerId))];
  }

  private liveRoom(): RoomState | undefined {
    const room = this.read();
    if (!room) return;
    const expired = room.completedAt !== undefined
      ? Date.now() >= room.completedAt + ROOM_TTL
      : room.abandonedAt !== null && Date.now() >= room.abandonedAt + ROOM_TTL;
    if (expired) {
      this.sockets().forEach(socket => socket.close(4004, 'Room expired'));
      this.ctx.storage.sql.exec('DELETE FROM lobby');
      return;
    }
    advance(room, Date.now(), this.connected());
    return room;
  }

  /** Persist before publishing. One alarm handles game deadlines and room expiry. */
  private async commit(room: RoomState): Promise<void> {
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO lobby (id, data) VALUES (1, ?)', JSON.stringify(room));
    const deadlines: number[] = [];
    if (room.completedAt !== undefined) deadlines.push(room.completedAt + ROOM_TTL);
    else if (room.abandonedAt !== null) deadlines.push(room.abandonedAt + ROOM_TTL);
    if (room.phase === 'preparing') deadlines.push(room.preparationDeadline!);
    if (room.phase === 'countdown') deadlines.push(room.startsAt!);
    if (room.phase === 'guessing') deadlines.push(room.deadline!);
    if (deadlines.length) await this.ctx.storage.setAlarm(Math.min(...deadlines));
    else await this.ctx.storage.deleteAlarm();
  }

  private broadcast(room: RoomState): void {
    for (const socket of this.sockets()) {
      const { playerId } = socket.deserializeAttachment() as Attachment;
      try {
        socket.send(JSON.stringify({ type: 'snapshot', room: publicSnapshot(room, this.connected(), playerId) }));
      } catch {
        socket.close(1011, 'Reconnect');
      }
    }
  }

  fetch(request: Request): Promise<Response> {
    return this.ctx.blockConcurrencyWhile(() => this.handleRequest(request));
  }

  private async handleRequest(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    let room = this.liveRoom();
    if (path === '/create' || path === '/join') {
      const body = await request.json() as { nickname?: unknown; code: string };
      const nickname = nicknameFrom(body.nickname);
      if (!nickname) return Response.json({ error: 'Use a nickname of 1–24 characters, without control characters.' }, { status: 400 });
      if (path === '/create' && room) return Response.json({ error: 'Code occupied' }, { status: 409 });
      if (path === '/join' && !room) return Response.json({ error: 'Room not found or expired.' }, { status: 404 });
      if (room && room.phase !== 'lobby') return Response.json({ error: 'This match has already started.' }, { status: 409 });
      if (room?.players.some(player => player.nickname.toLowerCase() === nickname.toLowerCase())) {
        return Response.json({ error: 'That nickname is already in use in this room.' }, { status: 409 });
      }
      if (room && room.players.length >= 10) return Response.json({ error: 'This room is full.' }, { status: 409 });
      const player = { id: crypto.randomUUID(), nickname, token: crypto.randomUUID(), ready: false, score: 0 };
      room ??= hydrateRoom({ code: body.code, hostId: player.id, players: [], abandonedAt: Date.now() });
      room.players.push(player);
      await this.commit(room);
      this.broadcast(room);
      return Response.json({ room: publicSnapshot(room, this.connected(), player.id), playerId: player.id, token: player.token }, { status: 201 });
    }

    if (!room) return Response.json({ error: 'Room not found or expired.' }, { status: 404 });
    if (path === '/session') {
      const token = request.headers.get('Authorization')?.replace(/^Bearer /, '');
      const player = room.players.find(member => member.token === token);
      if (!player) return Response.json({ error: 'This saved player no longer belongs to the room.' }, { status: 401 });
      await this.commit(room);
      this.broadcast(room);
      return Response.json({ room: publicSnapshot(room, this.connected(), player.id) });
    }
    if (path === '/connect') return this.connectPlayer(request, room);
    return new Response(null, { status: 404 });
  }

  private async connectPlayer(request: Request, room: RoomState): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response(null, { status: 426 });
    const protocols = request.headers.get('Sec-WebSocket-Protocol')?.split(',').map(value => value.trim()) ?? [];
    const player = room.players.find(member => protocols.includes(`token.${member.token}`));
    if (!protocols.includes('animasters') || !player) return new Response(null, { status: 401 });

    for (const old of this.sockets(player.id)) old.close(4001, 'Connected in another tab');
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ playerId: player.id } satisfies Attachment);
    // Refresh may have lost audio permission. Require an explicit lobby Ready again.
    if (room.phase === 'lobby') player.ready = false;
    room.abandonedAt = null;
    advance(room, Date.now(), this.connected());
    await this.commit(room);
    this.broadcast(room);
    return new Response(null, {
      status: 101, webSocket: pair[0], headers: { 'Sec-WebSocket-Protocol': 'animasters' },
    });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const room = this.liveRoom();
      const { playerId } = socket.deserializeAttachment() as Attachment;
      if (!room || !this.sockets(playerId).includes(socket)) return;
      const player = room.players.find(member => member.id === playerId)!;
      let action;
      try {
        if (typeof message !== 'string' || message.length > 2048) throw new Error();
        action = JSON.parse(message);
        if (!action || action.v !== 1) throw new Error();
      } catch {
        socket.send(JSON.stringify({ type: 'error', error: 'Invalid game message.' }));
        return;
      }
      // Clock probes are read-only. Client timestamps never affect scoring.
      if (action.type === 'clock' && Number.isFinite(action.sentAt)) {
        socket.send(JSON.stringify({ type: 'clock', sentAt: action.sentAt, serverTime: Date.now() }));
        await this.commit(room);
        this.broadcast(room);
        return;
      }
      let error: string | undefined;
      if (action.type === 'ready') {
        error = setReady(room, player, action.roundId, action.catalogVersion, Date.now(), this.connected(), action.settingsRevision);
      } else if (action.type === 'unready') {
        if (room.phase !== 'lobby') error = 'The match has already started.';
        else player.ready = false;
      } else if (action.type === 'settings') {
        error = updateSettings(room, player, action.settings, action.settingsRevision);
      } else if (action.type === 'guess') {
        error = submit(room, player, action, Date.now(), this.connected());
      } else {
        error = 'Unknown game action.';
      }
      this.maybePrepare(room);
      await this.commit(room);
      // A snapshot is the acknowledgement, including only this player's final choice.
      this.broadcast(room);
      if (error) socket.send(JSON.stringify({ type: 'error', error, actionId: action.actionId }));
    });
  }

  private maybePrepare(room: RoomState): void {
    const connected = this.connected();
    if (room.phase !== 'lobby' || !connected.length || !connected.every(id => room.players.find(player => player.id === id)?.ready)) return;
    room.phase = 'preparing';
    room.error = undefined;
    room.generationId = crypto.randomUUID();
    room.preparationDeadline = Date.now() + 30_000;
    // Start in a microtask after the current event persists the preparation marker.
    this.ctx.waitUntil(this.generate(room.generationId, room.settings));
  }

  private async generate(generationId: string, settings: RoomState['settings']): Promise<void> {
    let songs;
    let error: string | undefined;
    try {
      songs = await prepareMatch(this.env, settings);
    } catch (cause) {
      // Availability is safe to show; database/network diagnostics remain private.
      error = cause instanceof MatchAvailabilityError ? cause.message :
        'Could not prepare the match. Check song availability and try Ready again.';
    }
    await this.ctx.blockConcurrencyWhile(async () => {
      const room = this.liveRoom();
      if (!room || room.phase !== 'preparing' || room.generationId !== generationId) return;
      room.generationId = undefined;
      room.preparationDeadline = undefined;
      if (!songs?.length) {
        room.phase = 'lobby';
        room.error = error ?? 'No songs are available.';
        room.players.forEach(player => { player.ready = false; });
      } else {
        room.songs = songs;
        room.roundIndex = 0;
        beginCountdown(room, Date.now(), this.connected());
      }
      await this.commit(room);
      this.broadcast(room);
    });
  }

  async webSocketClose(socket: WebSocket, code: number): Promise<void> {
    // Abnormal-close codes describe a lost connection and cannot be sent back.
    // Still update presence/expiry after a browser or local runtime interruption.
    try {
      if (![1005, 1006, 1015].includes(code)) socket.close(code, 'Disconnected');
    } finally {
      await this.disconnected();
    }
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    socket.close(1011, 'Connection error');
    await this.disconnected();
  }

  private disconnected(): Promise<void> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const room = this.liveRoom();
      if (!room) return;
      if (!this.connected().length && room.abandonedAt === null) room.abandonedAt = Date.now();
      advance(room, Date.now(), this.connected());
      this.maybePrepare(room);
      await this.commit(room);
      this.broadcast(room);
    });
  }

  alarm(): Promise<void> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const room = this.liveRoom();
      if (!room) return;
      await this.commit(room);
      this.broadcast(room);
    });
  }
}
