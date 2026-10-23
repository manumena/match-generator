import { Hono } from 'hono';
import type { Env } from '../env';
import hiHandler from './handlers/hi-handler';
import generateMatchHandler from './handlers/generate-match-handler';

const router = new Hono<{ Bindings: Env }>({
  // The previous router ignored empty path segments, including trailing slashes.
  getPath: request => '/' + new URL(request.url).pathname.split('/').filter(Boolean).join('/'),
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

router.use('*', async (context, next) => {
  // Preserve the original preflight headers on every path, including unknown ones.
  if (context.req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  // Hono normally serves GET routes for HEAD; the existing API returned 404.
  if (context.req.method === 'HEAD') return new Response(null, { status: 404 });
  await next();
  if (context.res.status < 400) {
    for (const [name, value] of Object.entries(corsHeaders)) context.header(name, value);
  }
});

router.get('/', hiHandler);
router.get('/hi', hiHandler);
router.get('/generate-match', generateMatchHandler);
router.notFound(() => new Response(null, { status: 404 }));
router.onError(error => {
  console.error(error.message);
  return new Response('', { status: 500 });
});

export default router;
