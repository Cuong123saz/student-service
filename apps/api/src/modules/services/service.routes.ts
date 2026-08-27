import type { FastifyPluginAsync } from 'fastify'
import { Type, type Static } from '@sinclair/typebox'
import {  findServiceById,findServices,} from './service.repository.js'
const serviceParamsSchema = Type.Object({
  id: Type.String({
    pattern: '^[0-9]+$',
  }),
})
const serviceQuerySchema = Type.Object({
  status: Type.Optional(
    Type.Union([
      Type.Literal('ACTIVE'),
      Type.Literal('INACTIVE'),
    ]),
  ),
})
const serviceSchema = Type.Object({
  id: Type.Number(),
  code: Type.String(),
  name: Type.String(),
  description: Type.String(),
  processingDays: Type.Number(),
  status: Type.Union([
    Type.Literal('ACTIVE'),
    Type.Literal('INACTIVE'),
  ]),
})

const serviceListSchema = Type.Array(serviceSchema)

type ServiceParams = Static<typeof serviceParamsSchema>
type ServiceQuery = Static<typeof serviceQuerySchema>
export const serviceRoutes: FastifyPluginAsync = async (app) => {
app.get<{
  Querystring: ServiceQuery
}>(
  '/services',
  {
    schema: {
      querystring: serviceQuerySchema,

      response: {
        200: serviceListSchema,
      },
    },
  },
 async (request) => {
  return findServices(request.query.status)
}
)
app.get<{
  Params: ServiceParams
}>(
  '/services/:id',
  {
    schema: {
      params: serviceParamsSchema,

      response: {
        200: serviceSchema,

        404: Type.Object({
          message: Type.String(),
        }),
      },
    },
  },

  async (request, reply) => {
    const id = Number(request.params.id)
    const service = await findServiceById(id)

    if (!service) {
      return reply.code(404).send({
        message: 'Service not found',
      })
    }

    return service
  }
)}