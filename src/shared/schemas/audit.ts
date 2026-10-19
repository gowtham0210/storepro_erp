/** Validation for the audit log viewer's requests. */
import { z } from 'zod'

const id = z.number().int().positive()
const epochMs = z.number().int().min(0).max(8.64e15)

export const auditLogFilterSchema = z
  .object({
    person: z.union([id, z.literal('system')]).optional(),
    action: z
      .string()
      .max(64)
      .regex(/^[a-z_]+\.[a-z_]+$/)
      .optional(),
    from: epochMs.optional(),
    to: epochMs.optional(),
    entity: z
      .object({
        type: z
          .string()
          .max(32)
          .regex(/^[a-z_]+$/),
        id
      })
      .optional(),
    before: id.optional(),
    limit: z.number().int().min(1).max(200).optional()
  })
  .refine((f) => f.from === undefined || f.to === undefined || f.from < f.to, {
    message: 'The start date must be before the end date',
    path: ['to']
  })
