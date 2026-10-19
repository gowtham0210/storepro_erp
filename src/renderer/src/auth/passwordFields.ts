import { z } from 'zod'
import { passwordProblem } from '@shared/passwordPolicy'

export const PASSWORD_HINT =
  'At least 8 characters. A short phrase is easy to remember and hard to guess.'

/** A new password typed twice, checked against the policy and the username. */
export function withConfirmedPassword<T extends z.ZodRawShape>(shape: T) {
  return z
    .object({ ...shape, password: z.string(), confirmPassword: z.string() })
    .superRefine((raw, ctx) => {
      const value = raw as { password: string; confirmPassword: string; username?: unknown }
      const name = typeof value.username === 'string' ? value.username : ''
      const problem = passwordProblem(value.password, name)
      if (problem) ctx.addIssue({ code: 'custom', path: ['password'], message: problem })
      else if (value.confirmPassword !== value.password) {
        ctx.addIssue({
          code: 'custom',
          path: ['confirmPassword'],
          message: "The passwords don't match"
        })
      }
    })
}
