import { useQueryClient } from '@tanstack/react-query'
import { KeyRound, Pencil, UserCheck, UserPlus, UserX } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'
import type { RoleCode, UserSummary } from '@shared/ipc/contract'
import { displayName, roleCode, username } from '@shared/schemas/users'
import { withConfirmedPassword, PASSWORD_HINT } from '../auth/SetupAdminScreen'
import { useCurrentUser, useRefreshAuth } from '../auth/useAuth'
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  PageHeader,
  PasswordInput,
  Select,
  TextInput,
  useConfirm,
  useToast,
  type Column
} from '../components/ui'
import { useForm } from '../forms/useForm'
import { invoke } from '../ipc/client'
import { useIpcQuery } from '../ipc/hooks'
import { describeError } from '../lib/describeError'

const dateTime = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' })

type DialogState =
  | { kind: 'create' }
  | { kind: 'edit'; user: UserSummary }
  | { kind: 'reset'; user: UserSummary }
  | null

/** M05-05: who can sign in on this computer, and with which role. Administrators only. */
export default function UsersPage(): React.JSX.Element {
  const me = useCurrentUser()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const toast = useToast()
  const users = useIpcQuery('users:list')
  const [dialog, setDialog] = useState<DialogState>(null)

  const reload = () => queryClient.invalidateQueries({ queryKey: ['users:list'] })

  const toggleActive = async (user: UserSummary): Promise<void> => {
    if (user.active) {
      const ok = await confirm({
        title: `Deactivate ${user.displayName}?`,
        description: `${user.displayName} won't be able to sign in. Their past sales and actions stay in the records, and you can reactivate them later.`,
        confirmLabel: 'Deactivate',
        tone: 'danger'
      })
      if (!ok) return
    }
    try {
      await invoke('users:set-active', { userId: user.userId, active: !user.active })
      toast.success(`${user.displayName} was ${user.active ? 'deactivated' : 'reactivated'}.`)
      await reload()
    } catch (error) {
      toast.error(describeError(error).message)
    }
  }

  const columns: Column<UserSummary>[] = [
    {
      id: 'name',
      header: 'Name',
      cell: (user) => (
        <div>
          <span className="font-medium">{user.displayName}</span>
          {user.userId === me.userId && <span className="text-fg-muted"> (you)</span>}
          <div className="text-sm text-fg-muted">{user.username}</div>
        </div>
      )
    },
    { id: 'role', header: 'Role', cell: (user) => user.roleName },
    {
      id: 'status',
      header: 'Status',
      cell: (user) => (
        <span className="flex flex-wrap gap-1">
          {user.active ? <Badge tone="success">Active</Badge> : <Badge>Deactivated</Badge>}
          {user.mustChangePassword && user.active && (
            <Badge tone="warning">New password needed</Badge>
          )}
        </span>
      )
    },
    {
      id: 'lastSignIn',
      header: 'Last signed in',
      cell: (user) =>
        user.lastSignInAt ? (
          dateTime.format(user.lastSignInAt)
        ) : (
          <span className="text-fg-muted">Never</span>
        )
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      cell: (user) => (
        <span className="inline-flex gap-1" onClick={(event) => event.stopPropagation()}>
          <Button
            size="sm"
            variant="ghost"
            icon={<Pencil />}
            onClick={() => setDialog({ kind: 'edit', user })}
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<KeyRound />}
            onClick={() => setDialog({ kind: 'reset', user })}
          >
            Reset password
          </Button>
          {user.userId !== me.userId && (
            <Button
              size="sm"
              variant="ghost"
              icon={user.active ? <UserX /> : <UserCheck />}
              onClick={() => void toggleActive(user)}
            >
              {user.active ? 'Deactivate' : 'Reactivate'}
            </Button>
          )}
        </span>
      )
    }
  ]

  return (
    <>
      <PageHeader
        title="Users"
        description="People who can sign in to StorePro on this computer, and what they can do."
        actions={
          <Button
            variant="primary"
            icon={<UserPlus />}
            onClick={() => setDialog({ kind: 'create' })}
          >
            Add user
          </Button>
        }
      />
      {users.error ? (
        <Alert tone="danger" title={describeError(users.error).title}>
          {describeError(users.error).message}
        </Alert>
      ) : (
        <DataTable
          caption="Users"
          columns={columns}
          rows={users.data ?? []}
          getRowId={(user) => user.userId}
          loading={users.isPending}
          onRowActivate={(user) => setDialog({ kind: 'edit', user })}
          empty={<EmptyState title="No users yet" />}
        />
      )}
      {dialog?.kind === 'create' && (
        <CreateUserDialog onClose={() => setDialog(null)} onSaved={reload} />
      )}
      {dialog?.kind === 'edit' && (
        <EditUserDialog
          user={dialog.user}
          isMe={dialog.user.userId === me.userId}
          onClose={() => setDialog(null)}
          onSaved={reload}
        />
      )}
      {dialog?.kind === 'reset' && (
        <ResetPasswordDialog user={dialog.user} onClose={() => setDialog(null)} onSaved={reload} />
      )}
    </>
  )
}

function useRoleOptions() {
  const roles = useIpcQuery('users:list-roles')
  return (roles.data ?? []).map((role) => ({ value: role.roleCode, label: role.name }))
}

interface DialogProps {
  onClose: () => void
  onSaved: () => Promise<void>
}

const createSchema = withConfirmedPassword({ displayName, username, roleCode })

function CreateUserDialog({ onClose, onSaved }: DialogProps): React.JSX.Element {
  const toast = useToast()
  const roleOptions = useRoleOptions()
  const [error, setError] = useState<string | null>(null)
  const form = useForm({
    schema: createSchema,
    initialValues: {
      displayName: '',
      username: '',
      roleCode: 'cashier',
      password: '',
      confirmPassword: ''
    },
    onSubmit: async ({ confirmPassword: _confirm, ...user }) => {
      setError(null)
      try {
        const created = await invoke('users:create', {
          ...user,
          roleCode: user.roleCode as RoleCode
        })
        toast.success(`${created.displayName} can now sign in as ${created.username}.`)
        await onSaved()
        onClose()
      } catch (failure) {
        if (!form.applyServerError(failure)) setError(describeError(failure).message)
      }
    }
  })
  return (
    <Dialog open onClose={onClose} title="Add user" closeOnBackdrop={false}>
      <form noValidate onSubmit={(event) => void form.handleSubmit(event)} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field
          label="Name"
          required
          hint="As it should appear on screen and in reports."
          error={form.errors['displayName']}
        >
          <TextInput {...form.field('displayName')} autoFocus />
        </Field>
        <Field
          label="Username"
          required
          hint="What they type to sign in."
          error={form.errors['username']}
        >
          <TextInput {...form.field('username')} spellCheck={false} />
        </Field>
        <Field label="Role" required error={form.errors['roleCode']}>
          <Select {...form.field('roleCode')} options={roleOptions} />
        </Field>
        <Field label="Password" required hint={PASSWORD_HINT} error={form.errors['password']}>
          <PasswordInput {...form.field('password')} autoComplete="new-password" />
        </Field>
        <Field label="Confirm password" required error={form.errors['confirmPassword']}>
          <PasswordInput {...form.field('confirmPassword')} autoComplete="new-password" />
        </Field>
        <div className="flex justify-end gap-3 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" icon={<UserPlus />} loading={form.submitting}>
            Add user
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

const editSchema = z.object({ displayName, roleCode })

function EditUserDialog({
  user,
  isMe,
  onClose,
  onSaved
}: DialogProps & { user: UserSummary; isMe: boolean }): React.JSX.Element {
  const toast = useToast()
  const confirm = useConfirm()
  const refreshAuth = useRefreshAuth()
  const roleOptions = useRoleOptions()
  const [error, setError] = useState<string | null>(null)
  const form = useForm({
    schema: editSchema,
    initialValues: { displayName: user.displayName, roleCode: user.roleCode },
    onSubmit: async (changes) => {
      setError(null)
      if (isMe && user.roleCode === 'administrator' && changes.roleCode !== 'administrator') {
        const ok = await confirm({
          title: 'Remove your own administrator role?',
          description:
            "You'll lose access to user management straight away. Another administrator will have to give it back.",
          confirmLabel: 'Change my role',
          tone: 'danger'
        })
        if (!ok) return
      }
      try {
        await invoke('users:update', { userId: user.userId, ...changes })
        toast.success(`${changes.displayName} was updated.`)
        await onSaved()
        if (isMe) await refreshAuth()
        onClose()
      } catch (failure) {
        if (!form.applyServerError(failure)) setError(describeError(failure).message)
      }
    }
  })
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Edit ${user.displayName}`}
      description={`Username: ${user.username}`}
      closeOnBackdrop={false}
    >
      <form noValidate onSubmit={(event) => void form.handleSubmit(event)} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Name" required error={form.errors['displayName']}>
          <TextInput {...form.field('displayName')} autoFocus />
        </Field>
        <Field label="Role" required error={form.errors['roleCode']}>
          <Select {...form.field('roleCode')} options={roleOptions} />
        </Field>
        <div className="flex justify-end gap-3 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={form.submitting}>
            Save changes
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

function ResetPasswordDialog({
  user,
  onClose,
  onSaved
}: DialogProps & { user: UserSummary }): React.JSX.Element {
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)
  const schema = withConfirmedPassword({ username: z.literal(user.username) })
  const form = useForm({
    schema,
    initialValues: { username: user.username, password: '', confirmPassword: '' },
    onSubmit: async ({ password }) => {
      setError(null)
      try {
        await invoke('users:reset-password', { userId: user.userId, newPassword: password })
        toast.success(
          `${user.displayName}'s password was reset. They'll choose a new one when they next sign in.`
        )
        await onSaved()
        onClose()
      } catch (failure) {
        if (!form.applyServerError(failure)) setError(describeError(failure).message)
      }
    }
  })
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Reset ${user.displayName}'s password`}
      description="Give them this temporary password. They must change it when they next sign in. Any sign-in block on their account is lifted."
      closeOnBackdrop={false}
    >
      <form noValidate onSubmit={(event) => void form.handleSubmit(event)} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field
          label="Temporary password"
          required
          hint={PASSWORD_HINT}
          error={form.errors['password']}
        >
          <PasswordInput {...form.field('password')} autoComplete="new-password" autoFocus />
        </Field>
        <Field label="Confirm temporary password" required error={form.errors['confirmPassword']}>
          <PasswordInput {...form.field('confirmPassword')} autoComplete="new-password" />
        </Field>
        <div className="flex justify-end gap-3 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" icon={<KeyRound />} loading={form.submitting}>
            Reset password
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
