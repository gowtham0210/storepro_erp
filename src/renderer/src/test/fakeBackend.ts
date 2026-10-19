import type {
  AuthState,
  IpcChannel,
  IpcInput,
  IpcOutput,
  RoleSummary,
  SessionUser,
  SetupOptions,
  StoreProfile,
  StoreProBridge
} from '@shared/ipc/contract'
import { AppError, type IpcResult } from '@shared/ipc/errors'
import { PERMISSION_CODES, type PermissionCode } from '@shared/permissions'
import { MODULES } from '@shared/modules'
import { TEST_STORE } from '@shared/test/stores'

export const ADMIN: SessionUser = {
  userId: 1,
  username: 'owner',
  displayName: 'Ravi Kumar',
  roleCode: 'administrator',
  roleName: 'Administrator',
  mustChangePassword: false,
  permissions: [...PERMISSION_CODES]
}

/** What the seeded roles allow (migration 0003), for tests that sign in as someone else. */
export const ROLE_PERMISSIONS = {
  administrator: [...PERMISSION_CODES],
  manager: PERMISSION_CODES.filter(
    (code) => !['settings.edit', 'backup.restore', 'data.import'].includes(code)
  ),
  cashier: [
    'sale.create',
    'sale.view',
    'discount.apply',
    'customer.view',
    'customer.manage',
    'product.view',
    'inventory.view'
  ],
  inventory_operator: [
    'product.view',
    'product.manage',
    'inventory.view',
    'stock.adjust',
    'purchase.view',
    'purchase.manage',
    'supplier.view',
    'supplier.manage'
  ]
} satisfies Record<SessionUser['roleCode'], PermissionCode[]>

export const ROLES: RoleSummary[] = (
  [
    ['administrator', 'Administrator'],
    ['manager', 'Manager'],
    ['cashier', 'Cashier'],
    ['inventory_operator', 'Inventory operator']
  ] as const
).map(([roleCode, name]) => ({ roleCode, name, permissions: [...ROLE_PERMISSIONS[roleCode]] }))

/** A signed-in user with the given role and that role's permissions. */
export function userWithRole(
  roleCode: SessionUser['roleCode'],
  overrides: Partial<SessionUser> = {}
): SessionUser {
  return {
    ...ADMIN,
    userId: 2,
    username: roleCode.replace('_', '-'),
    displayName: 'Meena Sundar',
    roleCode,
    roleName: ROLES.find((role) => role.roleCode === roleCode)?.name ?? roleCode,
    permissions: [...ROLE_PERMISSIONS[roleCode]],
    ...overrides
  }
}

/** The set-up store every renderer test starts with. */
export const STORE: StoreProfile = {
  ...TEST_STORE,
  currency: { currencyCode: 'INR', name: 'Indian rupee', symbol: '₹', minorUnits: 2 },
  businessTypeName: 'Grocery / retail',
  enabledModules: ['grocery'],
  setUpAt: Date.UTC(2026, 9, 1, 4, 30),
  updatedAt: Date.UTC(2026, 9, 1, 4, 30)
}

export const SETUP_OPTIONS: SetupOptions = {
  currencies: [
    { currencyCode: 'INR', name: 'Indian rupee', symbol: '₹', minorUnits: 2 },
    { currencyCode: 'USD', name: 'US dollar', symbol: '$', minorUnits: 2 },
    { currencyCode: 'AED', name: 'UAE dirham', symbol: 'AED', minorUnits: 2 }
  ],
  businessTypes: [
    { businessTypeCode: 'grocery', name: 'Grocery / retail', available: true },
    { businessTypeCode: 'restaurant', name: 'Restaurant', available: false }
  ]
}

type Handler<C extends IpcChannel> = (input: IpcInput<C>) => IpcOutput<C> | Promise<IpcOutput<C>>
type Handlers = { [C in IpcChannel]?: Handler<C> }

/**
 * A stand-in for the main process in renderer tests. Defaults to a signed-in
 * administrator; tests override channels with `fakeBackend.on(...)`. A
 * handler that throws an AppError produces the same failure envelope the real
 * service host sends.
 */
class FakeBackend {
  authState: AuthState = { status: 'signed-in', user: ADMIN }
  calls: { channel: IpcChannel; input: unknown }[] = []
  private handlers: Handlers = {}

  reset(): void {
    this.authState = { status: 'signed-in', user: ADMIN }
    this.calls = []
    this.handlers = {}
  }

  on<C extends IpcChannel>(channel: C, handler: Handler<C>): void {
    ;(this.handlers as Record<string, unknown>)[channel] = handler
  }

  callsTo(channel: IpcChannel): unknown[] {
    return this.calls.filter((call) => call.channel === channel).map((call) => call.input)
  }

  readonly bridge: StoreProBridge = {
    invoke: (async (channel: IpcChannel, input?: unknown): Promise<IpcResult<unknown>> => {
      this.calls.push({ channel, input })
      try {
        const handler = (
          this.handlers as Record<string, ((input: unknown) => unknown) | undefined>
        )[channel]
        const data = handler ? await handler(input) : this.defaultResponse(channel)
        return { ok: true, data }
      } catch (error) {
        if (error instanceof AppError) return { ok: false, error: error.toPayload() }
        throw error
      }
    }) as StoreProBridge['invoke']
  }

  private defaultResponse(channel: IpcChannel): unknown {
    switch (channel) {
      case 'app:get-info':
        return {
          name: 'StorePro',
          version: '0.1.0-test',
          platform: 'win32',
          arch: 'x64',
          isPackaged: false,
          versions: { electron: '44', chrome: '152', node: '24' }
        }
      case 'app:get-startup-status':
        return { recoveredFromUncleanShutdown: false, previousSessionStartedAt: null }
      case 'auth:get-state':
        return this.authState
      case 'users:list':
        return []
      case 'users:list-roles':
        return ROLES
      case 'store:get-profile':
        return STORE
      case 'setup:get-options':
        return SETUP_OPTIONS
      case 'modules:list':
        return MODULES.map((manifest) => ({
          code: manifest.code,
          name: manifest.name,
          description: manifest.description,
          availability: manifest.availability,
          plannedFor: manifest.plannedFor ?? null,
          enabled: manifest.code === 'grocery',
          enabledAt: manifest.code === 'grocery' ? STORE.setUpAt : null,
          locked:
            manifest.code === 'grocery'
              ? 'Grocery and retail is what this store runs on, so it is always on.'
              : `${manifest.name} isn't in this version of StorePro yet.`
        }))
      case 'audit:list':
        return { entries: [], nextBefore: null }
      case 'audit:filter-options':
        return { actions: [], people: [] }
      default:
        return undefined
    }
  }
}

export const fakeBackend = new FakeBackend()
