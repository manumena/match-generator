import { Hono } from 'hono';
import type { Env } from '../env';
import { newRoomCode, nicknameFrom, ROOM_CODE } from './validation';

export const rooms = new Hono<{ Bindings: Env }>();

// Room errors must be readable cross-origin too. Legacy routes keep their contract.
rooms.use('*', async (context, next) => {
  await next();
  context.header('Access-Control-Allow-Origin', '*');
  context.header('Cache-Control', 'no-store');
});

rooms.post('/', async context => {
  const nickname = await readNickname(context.req.raw);
  if (!nickname) return context.json({ error: 'Use a nickname of 1–24 characters, without control characters.' }, 400);
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = newRoomCode();
    const response = await context.env.ROOMS.getByName(code).fetch('https://room/create', {
      method: 'POST', body: JSON.stringify({ code, nickname }),
    });
    if (response.status !== 409) return response;
  }
  return context.json({ error: 'Could not allocate a room code. Please try again.' }, 503);
});

rooms.post('/:code/join', async context => {
  const code = context.req.param('code').toUpperCase();
  if (!ROOM_CODE.test(code)) return context.json({ error: 'Room codes contain exactly four letters or numbers.' }, 400);
  const nickname = await readNickname(context.req.raw);
  if (!nickname) return context.json({ error: 'Use a nickname of 1–24 characters, without control characters.' }, 400);
  return context.env.ROOMS.getByName(code).fetch('https://room/join', {
    method: 'POST', body: JSON.stringify({ nickname }),
  });
});

rooms.get('/:code/session', async context => {
  const code = context.req.param('code').toUpperCase();
  if (!ROOM_CODE.test(code)) return context.json({ error: 'Invalid room code.' }, 400);
  return context.env.ROOMS.getByName(code).fetch(new Request('https://room/session', context.req.raw));
});

rooms.get('/:code/connect', async context => {
  const code = context.req.param('code').toUpperCase();
  if (!ROOM_CODE.test(code)) return context.json({ error: 'Invalid room code.' }, 400);
  const origin = context.req.header('Origin');
  const allowed = (context.env.ROOM_ORIGINS ?? 'https://animasters.pages.dev').split(',');
  if (!origin || !allowed.includes(origin)) return context.json({ error: 'Origin not allowed.' }, 403);
  return context.env.ROOMS.getByName(code).fetch(new Request('https://room/connect', context.req.raw));
});

rooms.onError(error => {
  console.error('Room request failed:', error.message);
  return Response.json({ error: 'Unable to reach the room. Please try again.' }, {
    status: 500, headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
  });
});

async function readNickname(request: Request): Promise<string | null> {
  // Bound the actual stream, rather than trusting a user-provided Content-Length.
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1024) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body = JSON.parse(new TextDecoder().decode(bytes)) as { nickname?: unknown } | null;
    return nicknameFrom(body?.nickname);
  } catch { return null; }
}
