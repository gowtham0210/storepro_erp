/**
 * Validation for sign-in and user management, shared by the forms and the
 * main-process handlers.
 */
import { z } from 'zod'
import type { RoleCode } from '../ipc/contract'
import { PASSWORD_MAX_LENGTH, passwordProblem } from '../passwordPolicy'
import { PERMISSION_CODES, type PermissionCode } from '../permissions'
import { requiredText } from '../validation'

export const ROLE_CODES = [
  'administrator',
  'manager',
  'cashier',
  'inventory_operator'
] as const satisfies readonly RoleCode[]

export const username = z
  .string()
  .trim()
  .min(3, 'Usernames have at least 3 characters')
  .max(64, 'Usernames have at most 64 characters')
  .regex(/^[A-Za-z0-9._-]+$/, 'Use letters, numbers, dots, dashes and underscores only')

export const displayName = requiredText('the name people will see', 80)

export const roleCode = z.enum(ROLE_CODES, { message: 'Choose a role' })

/** A password typed at sign-in: only presence and a sane maximum are checked. */
export const enteredPassword = z
  .string()
  .min(1, 'Enter your password')
  .max(PASSWORD_MAX_LENGTH * 4, 'That password is too long')

/** A new password, checked against the policy (and the username, when known). */
export const newPassword = z.string().superRefine((value, ctx) => {
  const problem = passwordProblem(value)
  if (problem) ctx.addIssue({ code: 'custom', message: problem })
})

function withPasswordNotContainingUsername<T extends { username: string; password: string }>(
  schema: z.ZodType<T>
) {
  return schema.superRefine((value, ctx) => {
    const problem = passwordProblem(value.password, value.username)
    if (problem) ctx.addIssue({ code: 'custom', path: ['password'], message: problem })
  })
}

export const credentialsSchema = z.object({
  username: z.string().trim().min(1, 'Enter your username').max(64),
  password: enteredPassword
})

export const newAdministratorSchema = withPasswordNotContainingUsername(
  z.object({ username, displayName, password: z.string() })
)

export const newUserSchema = withPasswordNotContainingUsername(
  z.object({ username, displayName, roleCode, password: z.string() })
)

export const userUpdateSchema = z.object({
  userId: z.number().int().positive(),
  displayName,
  roleCode
})

export const passwordChangeSchema = z.object({
  currentPassword: enteredPassword,
  newPassword
})

export const passwordResetSchema = z.object({
  userId: z.number().int().positive(),
  newPassword
})

export const setActiveSchema = z.object({
  userId: z.number().int().positive(),
  active: z.boolean()
})

export const permissionCode = z.enum(PERMISSION_CODES as [PermissionCode, ...PermissionCode[]])

/** The approving user's credentials, as typed into the manager approval prompt. */
export const overrideRequestSchema = credentialsSchema.extend({ permission: permissionCode })

/** Added to the input of a request that a manager approval can unlock. */
export const overrideId = z.uuid().optional()
