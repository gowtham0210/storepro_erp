import { ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'
import { passwordProblem } from '@shared/passwordPolicy'
import { displayName, username } from '@shared/schemas/users'
import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Field } from '../components/ui/Field'
import { PasswordInput } from '../components/ui/PasswordInput'
import { TextInput } from '../components/ui/TextInput'
import { useForm } from '../forms/useForm'
import { invoke } from '../ipc/client'
import { describeError } from '../lib/describeError'
import { AuthLayout } from './AuthLayout'
import { useRefreshAuth } from './useAuth'

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

const setupSchema = withConfirmedPassword({ displayName, username })

/** First run (M05-04): create the administrator account. */
export function SetupAdminScreen(): React.JSX.Element {
  const refresh = useRefreshAuth()
  const [error, setError] = useState<string | null>(null)
  const form = useForm({
    schema: setupSchema,
    initialValues: { displayName: '', username: '', password: '', confirmPassword: '' },
    onSubmit: async ({ confirmPassword: _confirm, ...admin }) => {
      setError(null)
      try {
        await invoke('auth:create-initial-admin', admin)
        await refresh({ forgetData: true })
      } catch (failure) {
        if (!form.applyServerError(failure)) setError(describeError(failure).message)
      }
    }
  })
  return (
    <AuthLayout
      title="Set up StorePro"
      description="Create the administrator account. You'll use it to add staff, change settings and approve sensitive actions."
    >
      <form noValidate onSubmit={(event) => void form.handleSubmit(event)} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field
          label="Your name"
          required
          hint="Shown on screen and in the activity log."
          error={form.errors['displayName']}
        >
          <TextInput {...form.field('displayName')} autoComplete="name" autoFocus />
        </Field>
        <Field
          label="Username"
          required
          hint="Letters, numbers, dots, dashes and underscores."
          error={form.errors['username']}
        >
          <TextInput {...form.field('username')} autoComplete="username" spellCheck={false} />
        </Field>
        <Field label="Password" required hint={PASSWORD_HINT} error={form.errors['password']}>
          <PasswordInput {...form.field('password')} autoComplete="new-password" />
        </Field>
        <Field label="Confirm password" required error={form.errors['confirmPassword']}>
          <PasswordInput {...form.field('confirmPassword')} autoComplete="new-password" />
        </Field>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          icon={<ShieldCheck />}
          loading={form.submitting}
        >
          Create account and continue
        </Button>
      </form>
    </AuthLayout>
  )
}
