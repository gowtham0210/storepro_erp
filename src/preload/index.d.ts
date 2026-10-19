import type { StoreProBridge } from '@shared/ipc/contract'

declare global {
  interface Window {
    readonly storepro: StoreProBridge
  }
}
