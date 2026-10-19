import { LockOpen } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'
import type { SessionUser } from '@shared/ipc/contract'
import { enteredPassword } from '@shared/schemas/users'
import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Field } from '../components/ui/Field'
import { PasswordInput } from '../components/ui/PasswordInput'
import { useForm } from '../forms/useForm'
import { invoke } from '../ipc/client'
import { describeError, retryAfterFrom } from '../lib/describeError'
import { ShortcutScope } from '../shortcuts/ShortcutProvider'
import { AuthLayout } from './AuthLayout'
import { useRefreshAuth } from './useAuth'
import { formatWait, useCountdown } from './useCountdown'

const unlockSchema = z.object({ password: enteredPassword })

/**
 * Covers the app while it is locked. The app stays mounted underneath (inert),
 * so an unfinished bill is still there after unlocking.
 */
export function LockScreen({ user }: { user: SessionUser }): React.JSX.Element {
  const refresh = useRefreshAuth()
  const [error, setError] = useState<string | null>(null)
  const [wait, startWait] = useCountdown()
  const form = useForm({
    schema: unlockSchema,
    initialValues: { password: '' },
    onSubmit: async ({ password }) => {
      setError(null)
      try {
        await invoke('auth:unlock', { password })
        await refresh()
      } catch (failure) {
        startWait(retryAfterFrom(failure))
        setError(describeError(failure).message)
        form.setValue('password', '')
      }
    }
  })
  return (
    // Exclusive: no shortcut of the app underneath works while locked.
    <ShortcutScope name="Locked" exclusive>
      <div className="fixed inset-0 z-40 overflow-y-auto">
        <AuthLayout
          title="StorePro is locked"
          description={`Signed in as ${user.displayName} (${user.roleName}).`}
          footer={
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await invoke('auth:sign-out')
                await refresh({ forgetData: true })
              }}
            >
              Sign in as someone else
            </Button>
          }
        >
          <form
            noValidate
            onSubmit={(event) => void form.handleSubmit(event)}
            className="space-y-4"
          >
            {error && (
              <Alert tone="danger">
                {error}
                {wait > 0 && ` You can try again in ${formatWait(wait)}.`}
              </Alert>
            )}
            <Field label="Password" error={form.errors['password']}>
              <PasswordInput {...form.field('password')} autoFocus />
            </Field>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              icon={<LockOpen />}
              loading={form.submitting}
              disabled={wait > 0}
            >
              {wait > 0 ? `Try again in ${formatWait(wait)}` : 'Unlock'}
            </Button>
          </form>
        </AuthLayout>
      </div>
    </ShortcutScope>
  )
}
