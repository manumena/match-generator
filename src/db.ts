import type { Env } from './env'
import { neon } from '@neondatabase/serverless'

function getDBConnection(env: Env) {
  return neon(
    `postgresql://${env.DB_USERNAME}:${env.DB_PASSWORD}@${env.DB_HOST}/${env.DATABASE}?sslmode=require`,
    { fullResults: true }
  )
}

export { getDBConnection }
