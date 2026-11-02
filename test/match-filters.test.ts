import { expect, it, vi } from 'vitest';
import { getDBConnection } from '../src/db';
import type { Env } from '../src/env';
import { DEFAULT_SETTINGS, answerTitles } from '../src/rooms/game';
import { prepareMatch } from '../src/rooms/match';

vi.mock('../src/db', () => ({ getDBConnection: vi.fn() }));

// The database factory is mocked; these tests do not need Worker bindings.
const env = {} as Env;

it.each([
  [true, false, false, ['opening']],
  [false, true, true, ['ending', 'soundtrack']],
  [false, false, false, ['opening', 'ending', 'soundtrack']],
])('passes the selected song types to generation (%s, %s, %s)', async (includeOpenings, includeEndings, includeSoundtracks, types) => {
  const query = vi.fn().mockResolvedValue({ rows: [{
    id: 1, anime_id: Number(Object.keys(answerTitles)[0]), anime: 'Anime', name: 'Song', path: 'track.mp3',
    artwork_url: 'https://images.example/poster.jpg',
    artist_credit: 'Band feat. Singer',
    type: 'opening', number: 3, release_count: 1, sequence_count: 1,
  }] });
  vi.mocked(getDBConnection).mockReturnValue(query as unknown as ReturnType<typeof getDBConnection>);
  const result = await prepareMatch(env, { ...DEFAULT_SETTINGS, amount: 1, includeOpenings, includeEndings, includeSoundtracks });
  expect(query).toHaveBeenCalledWith(expect.stringContaining('s.type::text'), [types]);
  expect(query).toHaveBeenCalledWith(expect.stringContaining('LEFT JOIN catalog.artwork_assets'), [types]);
  expect(result).toHaveLength(1);
  expect(result[0].artworkUrl).toBe('https://images.example/poster.jpg');
  expect(result[0]).toMatchObject({ songType: 'opening', sequenceNumber: 3 });
  expect(result[0].artistCredit).toBe('Band feat. Singer');
  expect(query).toHaveBeenCalledWith(expect.stringContaining('s.artist_credit'), [types]);
});
