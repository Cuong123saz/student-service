import { env } from '../config/env.js'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

export const databaseClient = postgres(env.databaseUrl)

export const db = drizzle(databaseClient)
