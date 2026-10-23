import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDBConnection } from '../src/db';
import { generateMatch } from '../src/logic/generate-match';
import { getRandomElementsFromList } from '../src/logic/random';
import { env, songs } from './fixtures';
import worker from '../src';

vi.mock('../src/db', () => ({ getDBConnection: vi.fn() }));
const query = vi.fn();

beforeEach(() => {
  vi.mocked(getDBConnection).mockReturnValue(query as unknown as ReturnType<typeof getDBConnection>);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });

describe('existing match selection', () => {
  it('uses defaults, caps selection to available anime, and selects one song per anime', async () => {
    query.mockResolvedValueOnce({ rows: [{ anime: 'Anime A' }, { anime: 'Anime B' }] })
      .mockResolvedValueOnce({ rows: [songs[0]] }).mockResolvedValueOnce({ rows: [songs[1]] });
    vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.9).mockReturnValue(0);
    expect(await generateMatch(env, {})).toEqual(songs);
    expect(query.mock.calls[0][0]).toBe("SELECT DISTINCT anime FROM songs WHERE type IN ('opening', 'ending', 'soundtrack');");
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('allows repeated anime, selects unique song IDs, and retains database result order', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] }).mockResolvedValueOnce({ rows: songs });
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.9).mockReturnValueOnce(0);
    expect(await generateMatch(env, { amount: 20, repeatAnimes: true, includeEndings: false, includeSoundtracks: false })).toEqual(songs);
    expect(query.mock.calls[0][0]).toBe("SELECT id FROM songs WHERE type IN ('opening');");
    expect(query.mock.calls[1][0]).toBe('SELECT * FROM songs WHERE id IN (2, 1);');
  });

  it('falls back to all types when every filter is false', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await generateMatch(env, { includeOpenings: false, includeEndings: false, includeSoundtracks: false })).toEqual([]);
    expect(query.mock.calls[0][0]).toBe('SELECT DISTINCT anime FROM songs WHERE 1=1;');
  });

  it('escapes apostrophes in anime names', async () => {
    query.mockResolvedValueOnce({ rows: [{ anime: "JoJo's" }] }).mockResolvedValueOnce({ rows: [songs[0]] });
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(await generateMatch(env, { amount: 1 })).toEqual([songs[0]]);
    expect(query.mock.calls[1][0]).toContain("anime = 'JoJo''s'");
  });

  it('keeps the existing undefined result on database failure', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    query.mockRejectedValueOnce(new Error('database unavailable'));
    expect(await generateMatch(env, {})).toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith('database unavailable');
  });

  it('returns no selection for an empty list, zero, negative, or NaN amount', () => {
    expect(getRandomElementsFromList([], 10)).toEqual([]);
    for (const amount of [0, -2, NaN]) expect(getRandomElementsFromList(songs, amount)).toEqual([]);
  });

  it('runs the HTTP handler through match generation using string defaults from Wrangler', async () => {
    query.mockResolvedValueOnce({ rows: [{ anime: 'Anime A' }] }).mockResolvedValueOnce({ rows: [songs[0]] });
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const response = await worker.fetch(new Request('https://api.example/generate-match'), {
      ...env, DEFAULT_SONGS_AMOUNT: '10', DEFAULT_INCLUDE_SOUNDTRACKS: undefined,
    }, {} as ExecutionContext);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ match: [songs[0]] });
    expect(query.mock.calls[0][0]).toBe("SELECT DISTINCT anime FROM songs WHERE type IN ('opening', 'ending');");
  });

  it('keeps the existing HTTP 200 and empty object when the database fails', async () => {
    query.mockRejectedValueOnce(new Error('database unavailable'));
    const response = await worker.fetch(new Request('https://api.example/generate-match'), env, {} as ExecutionContext);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
  });
});
