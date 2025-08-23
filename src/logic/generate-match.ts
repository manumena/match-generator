import { getDBConnection } from "../db";
import { Env } from "../env";
import { getRandomElementsFromList, getRandomNumbers } from "./random";

interface MatchOptions {
  amount?: number,
  repeatAnimes?: boolean,
  includeOpenings?: boolean,
  includeEndings?: boolean,
  includeSoundtracks?: boolean
}

const QUERY_GET_SONG_IDS = 'SELECT id FROM songs WHERE {};'
const QUERY_GET_SONGS_BY_CONDITION = 'SELECT * FROM songs WHERE {};'
const QUERY_GET_EVERY_ANIME = 'SELECT DISTINCT anime FROM songs;'

export async function generateMatch(env: Env, options: MatchOptions) {
  let { amount, repeatAnimes, includeOpenings, includeEndings, includeSoundtracks } = options
  let response
  
  // Log parameters
  console.log('env', env, 'options', options)

  // Set default options
  amount = amount ?? env.DEFAULT_SONGS_AMOUNT
  includeOpenings = includeOpenings ?? (env.DEFAULT_INCLUDE_OPENINGS === 'true')
  includeEndings = includeEndings ?? (env.DEFAULT_INCLUDE_ENDINGS === 'true')
  includeSoundtracks = includeSoundtracks ?? (env.DEFAULT_INCLUDE_SOUNDTRACKS === 'true')
  repeatAnimes = repeatAnimes ?? (env.DEFAULT_REPEAT_ANIMES === 'true')

  try {
    // Get database connection
    const conn = getDBConnection(env)

    if (repeatAnimes) {
      // Get all song ids that match filters
      const typeCondition = buildTypeCondition(includeOpenings, includeEndings, includeSoundtracks)
      const queryResponse = await conn(QUERY_GET_SONG_IDS.replace("{}", typeCondition))
      const allIds = queryResponse.rows.map((row) => row.id)

      // Get random ids
      const randomIds = getRandomElementsFromList(allIds, amount)

      // Use random ids to get the songs
      const selectedSongsResponse = await conn(buildQuerySongsByIds(randomIds))
      response = selectedSongsResponse
    } else {
      // Get a list of every anime that matches the filters
      const typeCondition = buildTypeCondition(includeOpenings, includeEndings, includeSoundtracks)
      let queryResponse = await conn(QUERY_GET_EVERY_ANIME.replace("{}", typeCondition))
      const allAnimes = queryResponse.rows.map((row) => row.anime)

      // Choose random animes
      const randomAnimes = getRandomElementsFromList(allAnimes, amount)

      // Choose random songs from selected animes, which match the filters
      const randomSongsPromises = randomAnimes.map(async anime => {
        queryResponse = await conn(buildQuerySongsByAnime(anime, typeCondition))
        const allSongs = queryResponse.rows

        return getRandomElementsFromList(allSongs, 1)[0]
      })
      response = await Promise.all(randomSongsPromises)
    }
    return response
  } catch (error: any) {
    console.error(error.message)
  }
}

function buildQuerySongsByIds(ids: number[]) {
  const idList = ids.join(", ")
  return QUERY_GET_SONGS_BY_CONDITION.replace("{}", `id IN (${idList})`)
}

function buildQuerySongsByAnime(anime: string, typeCondition: string) {
  const sanitizedAnime = anime.replaceAll(`'`, `''`)
  return QUERY_GET_SONGS_BY_CONDITION.replace('{}', `anime = '${sanitizedAnime}' AND ${typeCondition}`)
}

function buildTypeCondition(includeOpenings: boolean, includeEndings: boolean, includeSoundtracks: boolean): string {
  const types: string[] = []
  if (includeOpenings) types.push(`'opening'`)
  if (includeEndings) types.push(`'ending'`)
  if (includeSoundtracks) types.push(`'soundtrack'`)

  if (types.length === 0) {
    // fallback to all types if none are selected
    return '1=1'
  }

  return `type IN (${types.join(', ')})`
}