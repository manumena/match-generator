export interface Env {
  ROOMS: DurableObjectNamespace
  ROOM_ORIGINS?: string
  DATABASE: string
  DB_USERNAME: string
  DB_HOST: string
  DB_PASSWORD: string
  DEFAULT_SONGS_AMOUNT: number | string
  DEFAULT_REPEAT_ANIMES: string 
  DEFAULT_INCLUDE_OPENINGS: string
  DEFAULT_INCLUDE_ENDINGS: string
  DEFAULT_INCLUDE_SOUNDTRACKS?: string
}
