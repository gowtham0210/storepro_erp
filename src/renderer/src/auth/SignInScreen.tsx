import { LogIn } from 'lucide-react'
import { useState } from 'react'
import { credentialsSchema } from '@shared/schemas/users'
import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Field } from '../components/ui/Field'
import { PasswordInput } from '../components/ui/PasswordInput'
import { TextInput } from '../components/ui/TextInput'
import { useForm } from '../forms/useForm'
import { invoke } from '../ipc/client'
import { describeError, retryAfterFrom } from '../lib/describeError'
import { AuthLayout } from './AuthLayout'
import { useRefreshAuth } from './useAuth'
import { formatWait, useCountdown } from './useCountdown'

export function SignInScreen(): React.JSX.Element {
  const refresh = useRefreshAuth()
  const [error, setError] = useState<string | null>(null)
  const [wait, startWait] = useCountdown()

  const form = useForm({
    schema: credentialsSchema,
    initialValues: { username: '', password: '' },
    onSubmit: async (credentials) => {
      setError(null)
      try {
        await invoke('auth:sign-in', credentials)
        await refresh({ forgetData: true })
      } catch (failure) {
        startWait(retryAfterFrom(failure))
        setError(describeError(failure).message)
        form.setValue('password', '')
      }
    }
  })

  return (
    <AuthLayout title="Sign in" footer="Forgotten your password? Ask an administrator to reset it.">
      <form noValidate onSubmit={(event) => void form.handleSubmit(event)} className="space-y-4">
        {error && (
          <Alert tone="danger">
            {error}
            {wait > 0 && ` You can try again in ${formatWait(wait)}.`}
          </Alert>
        )}
        <Field label="Username" error={form.errors['username']}>
          <TextInput
            {...form.field('username')}
            autoComplete="username"
            autoFocus
            spellCheck={false}
          />
        </Field>
        <Field label="Password" error={form.errors['password']}>
          <PasswordInput {...form.field('password')} />
        </Field>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          icon={<LogIn />}
          loading={form.submitting}
          disabled={wait > 0}
        >
          {wait > 0 ? `Try again in ${formatWait(wait)}` : 'Sign in'}
        </Button>
      </form>
    </AuthLayout>
  )
}
