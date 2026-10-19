import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { resetConnectivity } from '../layout/useConnectivity'
import { fakeBackend } from './fakeBackend'

afterEach(() => {
  cleanup()
  localStorage.clear()
  fakeBackend.reset()
  resetConnectivity()
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

Object.defineProperty(window, 'storepro', { value: fakeBackend.bridge, configurable: true })
