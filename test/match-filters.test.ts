import { expect, it, vi } from 'vitest';
import { getDBConnection } from '../src/db';
import { DEFAULT_SETTINGS, answerTitles } from '../src/rooms/game';
import { prepareMatch } from '../src/rooms/match';
import { env } from './fixtures';

vi.mock('../src/db', () => ({ getDBConnection: vi.fn() }));

it.each([
  [true, false, false, ['opening']],
  [false, true, true, ['ending', 'soundtrack']],
  [false, false, false, ['opening', 'ending', 'soundtrack']],
])('passes the selected song types to generation (%s, %s, %s)', async (includeOpenings, includeEndings, includeSoundtracks, types) => {
  const query = vi.fn().mockResolvedValue({ rows: [{
    id: 1, anime_id: Number(Object.keys(answerTitles)[0]), anime: 'Anime', name: 'Song', path: 'track.mp3',
  }] });
  vi.mocked(getDBConnection).mockReturnValue(query as unknown as ReturnType<typeof getDBConnection>);
  const result = await prepareMatch(env, { ...DEFAULT_SETTINGS, amount: 1, includeOpenings, includeEndings, includeSoundtracks });
  expect(query).toHaveBeenCalledWith(expect.stringContaining('s.type::text'), [types]);
  expect(result).toHaveLength(1);
});
