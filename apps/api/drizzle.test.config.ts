import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

config({
  path: '.env.test',
  override: true,
})

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required in .env.test',
  )
}

export default defineConfig({
 schema: [
  './src/db/schema.ts',
  './src/modules/**/*.schema.ts',
],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
})