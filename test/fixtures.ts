import { env as bindings } from 'cloudflare:workers';
import type { Env } from '../src/env';

export const env: Env = {
  ROOMS: (bindings as unknown as Env).ROOMS,
  DATABASE: 'test', DB_USERNAME: 'test', DB_PASSWORD: 'test-secret', DB_HOST: 'database.invalid',
  DEFAULT_SONGS_AMOUNT: 10, DEFAULT_REPEAT_ANIMES: 'false',
  DEFAULT_INCLUDE_OPENINGS: 'true', DEFAULT_INCLUDE_ENDINGS: 'true', DEFAULT_INCLUDE_SOUNDTRACKS: 'true',
};

export const songs = [
  { id: 1, anime: 'Anime A', name: 'Opening A', type: 'opening', number: 1, path: 'a.mp3' },
  { id: 2, anime: 'Anime B', name: 'Ending B', type: 'ending', number: 1, path: 'b.mp3' },
];
