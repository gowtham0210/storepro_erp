import { ShieldCheck } from 'lucide-react'
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { AppError } from '@shared/ipc/errors'
import {
  permissionDenialFrom,
  permissionDescription,
  type PermissionCode
} from '@shared/permissions'
import { credentialsSchema } from '@shared/schemas/users'
import { Alert } from '../components/ui/Alert'
import { Button } from '../components/ui/Button'
import { Dialog } from '../components/ui/Dialog'
import { Field } from '../components/ui/Field'
import { PasswordInput } from '../components/ui/PasswordInput'
import { TextInput } from '../components/ui/TextInput'
import { useToast } from '../components/ui/Toast'
import { useForm } from '../forms/useForm'
import { invoke } from '../ipc/client'
import { describeError, retryAfterFrom } from '../lib/describeError'
import { formatWait, useCountdown } from './useCountdown'

/** Asks for another user's approval; resolves with the approval id, or null if cancelled. */
type RequestApproval = (permission: PermissionCode) => Promise<string | null>

const ApprovalContext = createContext<RequestApproval | null>(null)

/**
 * Run a restricted action, asking a manager to approve it when the user's
 * role doesn't allow it (M06-05).
 *
 * `run` is called without an approval first. If the main process refuses it
 * with an overridable FORBIDDEN, a manager types their own username and
 * password, and `run` is called again with the single-use approval id, which
 * it must send as `overrideId`. Resolves with the result, or null if the
 * approval was cancelled. Other errors are thrown as usual.
 *
 * ```ts
 * const withApproval = useManagerApproval()
 * const voided = await withApproval((overrideId) => invoke('sales:void', { saleId, overrideId }))
 * ```
 */
export function useManagerApproval(): <T>(
  run: (overrideId?: string) => Promise<T>
) => Promise<T | null> {
  const requestApproval = useContext(ApprovalContext)
  if (!requestApproval) {
    throw new Error('useManagerApproval must be used inside <ManagerApprovalProvider>')
  }
  return useCallback(
    async <T,>(run: (overrideId?: string) => Promise<T>): Promise<T | null> => {
      let overrideId: string | undefined
      for (;;) {
        try {
          return await run(overrideId)
        } catch (error) {
          // An expired or already-used approval comes back the same way: ask again.
          const denial =
            error instanceof AppError && error.code === 'FORBIDDEN'
              ? permissionDenialFrom(error.details)
              : null
          if (!denial?.overridable) throw error
          const approval = await requestApproval(denial.permission)
          if (approval === null) return null
          overrideId = approval
        }
      }
    },
    [requestApproval]
  )
}

export function ManagerApprovalProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [request, setRequest] = useState<{
    id: number
    permission: PermissionCode
    resolve: (overrideId: string | null) => void
  } | null>(null)
  const nextId = useRef(0)

  const requestApproval = useCallback<RequestApproval>(
    (permission) =>
      new Promise((resolve) => setRequest({ id: ++nextId.current, permission, resolve })),
    []
  )
  const settle = (overrideId: string | null): void => {
    request?.resolve(overrideId)
    setRequest(null)
  }

  return (
    <ApprovalContext.Provider value={requestApproval}>
      {children}
      {request && (
        <ApprovalDialog
          // A fresh form for every request.
          key={request.id}
          permission={request.permission}
          onApproved={settle}
          onCancel={() => settle(null)}
        />
      )}
    </ApprovalContext.Provider>
  )
}

function ApprovalDialog({
  permission,
  onApproved,
  onCancel
}: {
  permission: PermissionCode
  onApproved: (overrideId: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)
  const [wait, startWait] = useCountdown()
  const form = useForm({
    schema: credentialsSchema,
    initialValues: { username: '', password: '' },
    onSubmit: async (credentials) => {
      setError(null)
      try {
        const approval = await invoke('auth:approve-override', { ...credentials, permission })
        toast.info(`Approved by ${approval.approvedBy}.`)
        onApproved(approval.overrideId)
      } catch (failure) {
        startWait(retryAfterFrom(failure))
        setError(describeError(failure).message)
        form.setValue('password', '')
      }
    }
  })
  return (
    <Dialog
      open
      onClose={onCancel}
      size="sm"
      title="Manager approval needed"
      description={`“${permissionDescription(permission)}” needs approval from someone allowed to do it. They enter their own username and password; it's recorded in the audit log.`}
      closeOnBackdrop={false}
    >
      <form noValidate onSubmit={(event) => void form.handleSubmit(event)} className="space-y-4">
        {error && (
          <Alert tone="danger">
            {error}
            {wait > 0 && ` You can try again in ${formatWait(wait)}.`}
          </Alert>
        )}
        <Field label="Approver's username" error={form.errors['username']}>
          <TextInput {...form.field('username')} autoComplete="off" autoFocus spellCheck={false} />
        </Field>
        <Field label="Approver's password" error={form.errors['password']}>
          <PasswordInput {...form.field('password')} autoComplete="off" />
        </Field>
        <div className="flex justify-end gap-3 pt-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            type="submit"
            variant="primary"
            icon={<ShieldCheck />}
            loading={form.submitting}
            disabled={wait > 0}
          >
            {wait > 0 ? `Try again in ${formatWait(wait)}` : 'Approve'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
