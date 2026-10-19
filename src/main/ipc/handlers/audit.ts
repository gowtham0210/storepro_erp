import { z } from 'zod'
import { auditLogFilterSchema } from '@shared/schemas/audit'
import type { AuditLogService } from '../../audit/auditLogService'
import type { HandlerDefinition } from '../serviceHost'

type Channel = 'audit:list' | 'audit:filter-options'

export function createAuditHandlers(audit: AuditLogService): {
  [C in Channel]: HandlerDefinition<C>
} {
  return {
    'audit:list': {
      access: 'audit.view',
      input: auditLogFilterSchema,
      handle: (filter, { actor }) => audit.list(actor, filter)
    },
    'audit:filter-options': {
      access: 'audit.view',
      input: z.void(),
      handle: (_, { actor }) => audit.filterOptions(actor)
    }
  }
}
