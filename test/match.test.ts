import { expect, it } from 'vitest';
import { answerTitles, DEFAULT_SETTINGS } from '../src/rooms/game';
import { selectSongs } from '../src/rooms/match';

it.each([
  { type: 'opening', number: 3, release_count: 1, sequence_count: 1, expected: { songType: 'opening', sequenceNumber: 3 } },
  { type: 'ending', number: 2, release_count: 1, sequence_count: 1, expected: { songType: 'ending', sequenceNumber: 2 } },
  { type: 'opening', number: 17, release_count: 1, sequence_count: 2, expected: { songType: 'opening' } },
  { type: 'opening', number: 2, release_count: 3, sequence_count: 1, expected: { songType: 'opening' } },
  { type: 'ending', number: 0, release_count: 1, sequence_count: 1, expected: { songType: 'ending' } },
  { type: 'opening', number: 1.5, release_count: 1, sequence_count: 1, expected: { songType: 'opening' } },
  { type: 'ending', number: null, release_count: 1, sequence_count: 1, expected: { songType: 'ending' } },
  { type: 'opening', number: 1, release_count: 0, sequence_count: 1, expected: { songType: 'opening' } },
  { type: 'soundtrack', number: 1, release_count: 1, sequence_count: 1, expected: { songType: 'soundtrack' } },
  { type: 'unknown', number: 1, release_count: 1, sequence_count: 1, expected: {} },
])('only includes consistent reveal metadata: $type / $number / $release_count / $sequence_count', ({ expected, ...metadata }) => {
  const [song] = selectSongs([{
    id: 1,
    anime_id: Number(Object.keys(answerTitles)[0]),
    anime: 'Anime',
    name: 'Song',
    path: 'track.mp3',
    ...metadata,
  }], { ...DEFAULT_SETTINGS, amount: 1 });

  expect(song.songType).toBe(expected.songType);
  expect(song.sequenceNumber).toBe('sequenceNumber' in expected ? expected.sequenceNumber : undefined);
});

it.each([null, undefined, ''])('keeps songs without artwork playable (%s)', artworkUrl => {
  const songs = selectSongs([{
    id: 1,
    anime_id: Number(Object.keys(answerTitles)[0]),
    anime: 'Anime without a poster',
    name: 'Song',
    path: 'track.mp3',
    artwork_url: artworkUrl,
  }], { ...DEFAULT_SETTINGS, amount: 1 });

  expect(songs).toHaveLength(1);
  expect(songs[0]).not.toHaveProperty('artworkUrl');
});

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
