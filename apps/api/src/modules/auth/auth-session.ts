import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import {
  ADMIN_JWT_AUDIENCE,
  JWT_ISSUER,
} from './auth.constants.js'

export const sessionTokenPayloadSchema = Type.Object({
  sub: Type.String({ minLength: 1 }),
  username: Type.String({ minLength: 1 }),
  roles: Type.Array(Type.String({ minLength: 1 })),
  portal: Type.Union([
    Type.Literal('admin'),
    Type.Literal('user'),
  ]),
  mustChangePassword: Type.Boolean(),
  aud: Type.String({ minLength: 1 }),
  iss: Type.String({ minLength: 1 }),
})

export type SessionTokenPayload =
  Static<typeof sessionTokenPayloadSchema>

export const adminSessionSchema = Type.Object({
  sub: Type.String({ minLength: 1 }),
  username: Type.String({ minLength: 1 }),
  mustChangePassword: Type.Boolean(),
  roles: Type.Array(Type.String({ minLength: 1 })),
  portal: Type.Literal('admin'),
  aud: Type.Literal(ADMIN_JWT_AUDIENCE),
  iss: Type.Literal(JWT_ISSUER),
  iat: Type.Integer({ minimum: 0 }),
  exp: Type.Integer({ minimum: 0 }),
})

export type AdminSession = Static<typeof adminSessionSchema>

export function isAdminSession(
  value: unknown,
): value is AdminSession {
  return Value.Check(adminSessionSchema, value)
}