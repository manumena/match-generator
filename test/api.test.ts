import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src';
import { generateMatch } from '../src/logic/generate-match';
import { env, songs } from './fixtures';

vi.mock('../src/logic/generate-match', () => ({ generateMatch: vi.fn() }));

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': '*',
  'access-control-allow-headers': '*',
  'access-control-max-age': '86400',
};
function request(path: string, method = 'GET') {
  return worker.fetch(new Request(`https://api.example${path}`, { method }), env, {} as ExecutionContext);
}

beforeEach(() => { vi.mocked(generateMatch).mockResolvedValue(songs); });
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('existing HTTP contract', () => {
  it.each(['/', '/hi', '/hi/', '//hi//'])('serves the greeting at %s', async path => {
    const response = await request(path);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Hi');
    expect(Object.fromEntries(response.headers)).toEqual({ ...corsHeaders, 'content-type': 'text/plain;charset=UTF-8' });
  });

  it('returns the complete song records inside match', async () => {
    const response = await request('/generate-match');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ match: songs });
    expect(Object.fromEntries(response.headers)).toEqual({ ...corsHeaders, 'content-type': 'application/json' });
    expect(generateMatch).toHaveBeenCalledWith(env, {});
  });

  it('preserves parsing, explicit false values, and last duplicate query values', async () => {
    await request('/generate-match/?amount=9&amount=2songs&repeatAnimes=true&includeOpenings=false&includeEndings=true&includeSoundtracks=TRUE&ignored=x');
    expect(generateMatch).toHaveBeenCalledWith(env, {
      amount: 2, repeatAnimes: true, includeOpenings: false, includeEndings: true, includeSoundtracks: false,
    });
  });

  it.each(['', 'abc', '-2', '0', '2.5', '0x10'])('preserves legacy amount parsing for %s', async amount => {
    expect((await request(`/generate-match?amount=${amount}`)).status).toBe(200);
    expect(generateMatch).toHaveBeenCalledWith(env, { amount: parseInt(amount) });
  });

  it.each(['/', '/hi', '/generate-match', '/missing'])('responds to OPTIONS at %s', async path => {
    const response = await request(path, 'OPTIONS');
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(Object.fromEntries(response.headers)).toEqual(corsHeaders);
    expect(generateMatch).not.toHaveBeenCalled();
  });

  it.each([['/missing', 'GET'], ['/hi', 'POST'], ['/hi', 'HEAD'], ['/generate-match', 'HEAD']])('keeps an empty 404 for %s %s', async (path, method) => {
    const response = await request(path, method);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
    expect(Object.fromEntries(response.headers)).toEqual({});
    expect(generateMatch).not.toHaveBeenCalled();
  });

  it('keeps the existing empty-object response when generation returns undefined', async () => {
    vi.mocked(generateMatch).mockResolvedValue(undefined);
    const response = await request('/generate-match');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
  });

  it('keeps an empty 500 for an unhandled error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(generateMatch).mockRejectedValue(new Error('test failure'));
    const response = await request('/generate-match');
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('');
    expect(Object.fromEntries(response.headers)).toEqual({ 'content-type': 'text/plain;charset=UTF-8' });
  });
});
