import type { SessionUser } from '@shared/ipc/contract'
import { Button } from '../components/ui/Button'
import { invoke } from '../ipc/client'
import { AuthLayout } from './AuthLayout'
import { ChangePasswordForm } from './ChangePasswordForm'
import { useRefreshAuth } from './useAuth'

/** After an administrator reset the password: the user must choose their own before going on. */
export function ForcedPasswordChangeScreen({ user }: { user: SessionUser }): React.JSX.Element {
  const refresh = useRefreshAuth()
  return (
    <AuthLayout
      title="Choose a new password"
      description={`${user.displayName}, an administrator reset your password. Choose a new one that only you know.`}
    >
      <ChangePasswordForm
        username={user.username}
        currentLabel="Temporary password"
        onChanged={() => refresh()}
        secondaryAction={
          <Button
            variant="ghost"
            onClick={async () => {
              await invoke('auth:sign-out')
              await refresh({ forgetData: true })
            }}
          >
            Sign out
          </Button>
        }
      />
    </AuthLayout>
  )
}
