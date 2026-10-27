import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import { nicknameFrom, ROOM_TTL } from './validation';

interface Player {
  id: string;
  nickname: string;
  token: string;
}
interface Lobby {
  code: string;
  hostId: string;
  players: Player[];
  abandonedAt: number | null;
}
interface Attachment { playerId: string }

/** One SQLite-backed object owns each code, making code reservation atomic. */
export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS lobby (id INTEGER PRIMARY KEY, data TEXT NOT NULL)');
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private read(): Lobby | undefined {
    const row = this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM lobby WHERE id = 1').toArray()[0];
    return row ? JSON.parse(row.data) as Lobby : undefined;
  }

  private liveRoom(): Lobby | undefined {
    const room = this.read();
    if (room && room.abandonedAt !== null && Date.now() >= room.abandonedAt + ROOM_TTL) {
      this.ctx.storage.sql.exec('DELETE FROM lobby');
      return undefined;
    }
    return room;
  }

  private save(room: Lobby): void {
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO lobby (id, data) VALUES (1, ?)', JSON.stringify(room));
  }

  private sockets(playerId?: string): WebSocket[] {
    return this.ctx.getWebSockets().filter(socket =>
      socket.readyState === WebSocket.OPEN &&
      (!playerId || (socket.deserializeAttachment() as Attachment).playerId === playerId));
  }

  private snapshot(room: Lobby) {
    return {
      code: room.code,
      hostId: room.hostId,
      phase: 'lobby',
      players: room.players.map(({ id, nickname }) => ({
        id, nickname, connected: this.sockets(id).length > 0,
      })),
    };
  }

  private broadcast(room: Lobby): void {
    const message = JSON.stringify({ type: 'snapshot', room: this.snapshot(room) });
    for (const socket of this.sockets()) {
      try { socket.send(message); } catch { socket.close(1011, 'Reconnect'); }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    let room = this.liveRoom();


    // No await separates reading/reserving a code or checking/inserting a player.
    // Parsing the body happens first, followed by a fresh read to avoid races.
    if (path === '/create' || path === '/join') {
      const body = await request.json() as { nickname?: unknown; code: string };
      const nickname = nicknameFrom(body.nickname);
      if (!nickname) return Response.json({ error: 'Use a nickname of 1–24 characters, without control characters.' }, { status: 400 });
      room = this.liveRoom();
      if (path === '/create' && room) return Response.json({ error: 'Code occupied' }, { status: 409 });
      if (path === '/join' && !room) return Response.json({ error: 'Room not found or expired.' }, { status: 404 });
      if (room?.players.some(player => player.nickname.toLowerCase() === nickname.toLowerCase())) {
        return Response.json({ error: 'That nickname is already in use in this room.' }, { status: 409 });
      }
      if (room && room.players.length >= 10) return Response.json({ error: 'This room is full.' }, { status: 409 });

      const player: Player = { id: crypto.randomUUID(), nickname, token: crypto.randomUUID() };
      room ??= { code: body.code, hostId: player.id, players: [], abandonedAt: Date.now() };
      room.players.push(player);
      this.save(room);
      if (room.abandonedAt !== null) await this.ctx.storage.setAlarm(room.abandonedAt + ROOM_TTL);
      this.broadcast(room);
      return Response.json({ room: this.snapshot(room), playerId: player.id, token: player.token }, { status: 201 });
    }

    if (!room) return Response.json({ error: 'Room not found or expired.' }, { status: 404 });
    if (path === '/session') {
      const token = request.headers.get('Authorization')?.replace(/^Bearer /, '');
      if (!room.players.some(player => player.token === token)) return Response.json({ error: 'This saved player no longer belongs to the room.' }, { status: 401 });
      return Response.json({ room: this.snapshot(room) });
    }
    if (path === '/connect') return this.connectPlayer(request, room);
    return new Response(null, { status: 404 });
  }

  private async connectPlayer(request: Request, room: Lobby): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response(null, { status: 426 });
    // Browser WebSockets cannot set Authorization. The credential is sent in the
    // protocol header, never in a URL, share link, snapshot or selected protocol.
    const protocols = request.headers.get('Sec-WebSocket-Protocol')?.split(',').map(value => value.trim()) ?? [];
    const player = room.players.find(member => protocols.includes(`token.${member.token}`));
    if (!protocols.includes('animasters') || !player) return new Response(null, { status: 401 });

    for (const old of this.sockets(player.id)) old.close(4001, 'Connected in another tab');
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ playerId: player.id } satisfies Attachment);
    room.abandonedAt = null;
    this.save(room);
    await this.ctx.storage.deleteAlarm();
    this.broadcast(room);
    return new Response(null, {
      status: 101, webSocket: pair[0], headers: { 'Sec-WebSocket-Protocol': 'animasters' },
    });
  }

  // Gameplay messages will be introduced with a versioned game protocol.
  webSocketMessage(socket: WebSocket): void {
    socket.close(1008, 'Unsupported message');
  }

  async webSocketClose(socket: WebSocket, code: number): Promise<void> {
    socket.close(code, 'Disconnected');
    await this.disconnected();
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    socket.close(1011, 'Connection error');
    await this.disconnected();
  }

  private async disconnected(): Promise<void> {
    const room = this.read();
    if (!room) return;
    if (!this.sockets().length && room.abandonedAt === null) {
      room.abandonedAt = Date.now();
      this.save(room);
      await this.ctx.storage.setAlarm(room.abandonedAt + ROOM_TTL);
    }
    this.broadcast(room);
  }

  async alarm(): Promise<void> {
    const room = this.read();
    if (!room || room.abandonedAt === null || this.sockets().length) return;
    const expiresAt = room.abandonedAt + ROOM_TTL;
    if (Date.now() < expiresAt) {
      await this.ctx.storage.setAlarm(expiresAt);
      return;
    }
    this.ctx.storage.sql.exec('DELETE FROM lobby');
  }
}
