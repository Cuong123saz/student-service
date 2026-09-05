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
  | 'WEB_BASE_URL'
  | 'SMTP_HOST'
  | 'SMTP_PORT'
  | 'SMTP_SECURE'
  | 'MAIL_FROM'

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
  name: 'API_PORT' | 'SMTP_PORT',
  value: string,
): number {
  const port = Number(value)

  if (
    !Number.isInteger(port)
    || port < 1
    || port > 65_535
  ) {
    throw new Error(
      `${name} must be a valid port number, received: ${value}`,
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
function readBoolean(
  name: 'SMTP_SECURE',
  value: string,
): boolean {
  if (value === 'true') {
    return true
  }

  if (value === 'false') {
    return false
  }

  throw new Error(
    `${name} must be true or false, received: ${value}`,
  )
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
webBaseUrl:
  readRequiredEnvironmentVariable(
    'WEB_BASE_URL',
  ),

smtpHost:
  readRequiredEnvironmentVariable(
    'SMTP_HOST',
  ),

smtpPort: readPort(
  'SMTP_PORT',
  readRequiredEnvironmentVariable(
    'SMTP_PORT',
  ),
),

smtpSecure: readBoolean(
  'SMTP_SECURE',
  readRequiredEnvironmentVariable(
    'SMTP_SECURE',
  ),
),

mailFrom:
  readRequiredEnvironmentVariable(
    'MAIL_FROM',
  ),
  apiHost:
    readRequiredEnvironmentVariable(
      'API_HOST',
    ),

  apiPort: readPort(
  'API_PORT',
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