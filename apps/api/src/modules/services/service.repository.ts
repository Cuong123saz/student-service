import { eq } from 'drizzle-orm'

import { db } from '../../db/client.js'
import { services } from '../../db/schema.js'

export type ServiceStatus = 'ACTIVE' | 'INACTIVE'

export async function findServices(status?: ServiceStatus) {
  if (status) {
    return db.select().from(services).where(eq(services.status, status))
  }

  return db.select().from(services)
}

export async function findServiceById(id: number) {
  const result = await db.select().from(services).where(eq(services.id, id)).limit(1)

  return result[0]
}
