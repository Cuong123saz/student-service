import 'dotenv/config'

type AppEnvironment =
  | 'development'
  | 'test'
  | 'production'

type RequiredEnvironmentVariable =
  | 'DATABASE_URL'
  | 'CORS_ORIGIN'
  | 'API_HOST'
  | 'API_PORT'
  | 'APP_ENV'
  | 'JWT_SECRET'

function readRequiredEnvironmentVariable(
  name: RequiredEnvironmentVariable,
): string {
  const value =
    process.env[name]?.trim()

  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}`,
    )
  }

  return value
}

function readPort(
  value: string,
): number {
  const port = Number(value)

  if (
    !Number.isInteger(port)
    || port < 1
    || port > 65_535
  ) {
    throw new Error(
      `API_PORT must be a valid port number, received: ${value}`,
    )
  }

  return port
}

function readAppEnvironment(
  value: string,
): AppEnvironment {
  if (
    value !== 'development'
    && value !== 'test'
    && value !== 'production'
  ) {
    throw new Error(
      `APP_ENV must be development, test or production; received: ${value}`,
    )
  }

  return value
}

function readJwtSecret(
  value: string,
): string {
  if (value.length < 32) {
    throw new Error(
      'JWT_SECRET must contain at least 32 characters',
    )
  }

  return value
}

const appEnvironment =
  readAppEnvironment(
    readRequiredEnvironmentVariable(
      'APP_ENV',
    ),
  )

export const env = Object.freeze({
  databaseUrl:
    readRequiredEnvironmentVariable(
      'DATABASE_URL',
    ),

  corsOrigin:
    readRequiredEnvironmentVariable(
      'CORS_ORIGIN',
    ),

  apiHost:
    readRequiredEnvironmentVariable(
      'API_HOST',
    ),

  apiPort: readPort(
    readRequiredEnvironmentVariable(
      'API_PORT',
    ),
  ),

  appEnvironment,

  jwtSecret: readJwtSecret(
    readRequiredEnvironmentVariable(
      'JWT_SECRET',
    ),
  ),

  isProduction:
    appEnvironment === 'production',
})