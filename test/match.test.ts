import { expect, it } from 'vitest';
import { answerTitles, DEFAULT_SETTINGS } from '../src/rooms/game';
import { selectSongs } from '../src/rooms/match';

it('selects distinct canonical answers and requires enough playable titles', () => {
  const ids = Object.keys(answerTitles).slice(0, 4).map(Number);
  const rows = ids.flatMap((anime_id, i) => [0, 1].map(j => ({
    id: i * 2 + j, anime_id, anime: `Season ${i}-${j}`, name: 'Song', path: 'Some%20path.mp3',
  })));
  const songs = selectSongs(rows, { ...DEFAULT_SETTINGS, amount: 4 });
  expect(new Set(songs.map(song => song.animeId)).size).toBe(4);
  expect(songs.every(song => song.audioUrl.endsWith('Some%20path.mp3'))).toBe(true);
  expect(() => selectSongs(rows, { ...DEFAULT_SETTINGS, amount: 5 })).toThrow('Only 4');
});
