import { KeyRound } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { z } from 'zod'
import { passwordProblem } from '@shared/passwordPolicy'
import { enteredPassword } from '@shared/schemas/users'
import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Field } from '../components/ui/Field'
import { PasswordInput } from '../components/ui/PasswordInput'
import { useForm } from '../forms/useForm'
import { invoke } from '../ipc/client'
import { describeError } from '../lib/describeError'
import { PASSWORD_HINT } from './passwordFields'

interface ChangePasswordFormProps {
  username: string
  currentLabel?: string
  onChanged: () => void | Promise<void>
  /** Extra buttons next to the submit button, e.g. Cancel. */
  secondaryAction?: ReactNode
}

export function ChangePasswordForm({
  username,
  currentLabel = 'Current password',
  onChanged,
  secondaryAction
}: ChangePasswordFormProps): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const schema = z
    .object({
      currentPassword: enteredPassword,
      newPassword: z.string(),
      confirmPassword: z.string()
    })
    .superRefine((value, ctx) => {
      const problem = passwordProblem(value.newPassword, username)
      if (problem) ctx.addIssue({ code: 'custom', path: ['newPassword'], message: problem })
      else if (value.newPassword === value.currentPassword) {
        ctx.addIssue({
          code: 'custom',
          path: ['newPassword'],
          message: 'Choose a password different from your current one'
        })
      } else if (value.confirmPassword !== value.newPassword) {
        ctx.addIssue({
          code: 'custom',
          path: ['confirmPassword'],
          message: "The passwords don't match"
        })
      }
    })
  const form = useForm({
    schema,
    initialValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
    onSubmit: async ({ currentPassword, newPassword }) => {
      setError(null)
      try {
        await invoke('auth:change-password', { currentPassword, newPassword })
        await onChanged()
      } catch (failure) {
        if (!form.applyServerError(failure)) setError(describeError(failure).message)
      }
    }
  })
  return (
    <form noValidate onSubmit={(event) => void form.handleSubmit(event)} className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label={currentLabel} required error={form.errors['currentPassword']}>
        <PasswordInput {...form.field('currentPassword')} autoFocus />
      </Field>
      <Field label="New password" required hint={PASSWORD_HINT} error={form.errors['newPassword']}>
        <PasswordInput {...form.field('newPassword')} autoComplete="new-password" />
      </Field>
      <Field label="Confirm new password" required error={form.errors['confirmPassword']}>
        <PasswordInput {...form.field('confirmPassword')} autoComplete="new-password" />
      </Field>
      <div className="flex justify-end gap-3">
        {secondaryAction}
        <Button type="submit" variant="primary" icon={<KeyRound />} loading={form.submitting}>
          Change password
        </Button>
      </div>
    </form>
  )
}
