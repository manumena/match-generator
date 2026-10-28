import { getDBConnection } from '../db';
import type { Env } from '../env';
import { getRandomElementsFromList } from '../logic/random';
import { answerTitles, type Settings, type Song } from './game';

interface SongRow {
  id: number;
  anime_id: number;
  anime: string;
  name: string;
  path: string;
}
const AUDIO_BASE = 'https://dszqiegiplfnrnovpqvn.supabase.co/storage/v1/object/public/animasters/';

export class MatchAvailabilityError extends Error {}

/** One bounded catalog query per match; no database call runs on the guess path. */
export async function prepareMatch(env: Env, settings: Settings): Promise<Song[]> {
  const selectedTypes = [
    settings.includeOpenings && 'opening',
    settings.includeEndings && 'ending',
    settings.includeSoundtracks && 'soundtrack',
  ].filter(Boolean);
  // Match the manual settings screen: no checked types means all types.
  const types = selectedTypes.length ? selectedTypes : ['opening', 'ending', 'soundtrack'];
  const db = getDBConnection(env);
  const result = await db(`
    SELECT s.id, s.anime, s.name, s.path, a.anime_id
    FROM public.songs s
    JOIN catalog.song_answers a ON a.song_id = s.id
    WHERE s.type::text = ANY($1::text[])
    ORDER BY s.id`, [types]);
  return selectSongs(result.rows as SongRow[], settings);
}

export function selectSongs(rows: SongRow[], settings: Settings): Song[] {
  const eligible = rows.filter(row => answerTitles[row.anime_id]);
  const groups = new Map<number, SongRow[]>();
  for (const row of eligible) {
    const group = groups.get(row.anime_id) ?? [];
    group.push(row);
    groups.set(row.anime_id, group);
  }
  const candidates = settings.repeatAnimes ? eligible : [...groups.values()].map(group => getRandomElementsFromList(group, 1)[0]);
  if (candidates.length < settings.amount) {
    if (!candidates.length) throw new MatchAvailabilityError('No songs are available for these settings. Include more song types.');
    throw new MatchAvailabilityError(`Only ${candidates.length} eligible anime are available for these settings. Choose ${candidates.length} songs or fewer, or include more song types.`);
  }
  return getRandomElementsFromList(candidates, settings.amount).map(row => ({
    roundId: crypto.randomUUID(), animeId: row.anime_id,
    anime: row.anime, name: row.name,
    // Existing paths are already URL encoded. Do not encode '%' a second time.
    audioUrl: AUDIO_BASE + row.path,
  }));
}
