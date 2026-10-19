import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import type { StoreProBridge } from '@shared/ipc/contract'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

// jsdom lacks the native <dialog> modal API; emulate the parts we use.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
    const target = this.querySelector<HTMLElement>('[autofocus], [data-autofocus]')
    target?.focus()
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
}

window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false
})) as typeof window.matchMedia

const bridge: StoreProBridge = {
  invoke: vi.fn(async (channel: string) => {
    switch (channel) {
      case 'app:get-info':
        return {
          ok: true,
          data: {
            name: 'StorePro',
            version: '0.1.0-test',
            platform: 'win32',
            arch: 'x64',
            isPackaged: false,
            versions: { electron: '44', chrome: '152', node: '24' }
          }
        }
      case 'app:get-startup-status':
        return {
          ok: true,
          data: { recoveredFromUncleanShutdown: false, previousSessionStartedAt: null }
        }
      default:
        return { ok: true, data: undefined }
    }
  }) as StoreProBridge['invoke']
}
Object.defineProperty(window, 'storepro', { value: bridge, configurable: true })
