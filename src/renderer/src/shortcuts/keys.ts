/**
 * Shortcut combos are strings such as "F12", "Ctrl+1", "Ctrl+Shift+K",
 * "Escape". Modifiers are always ordered Ctrl, Alt, Shift.
 */

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift'] as const
const MODIFIER_KEYS = new Set([
  'Control',
  'Alt',
  'Shift',
  'Meta',
  'AltGraph',
  'CapsLock',
  'NumLock'
])
const KEY_ALIASES: Record<string, string> = {
  esc: 'Escape',
  escape: 'Escape',
  enter: 'Enter',
  return: 'Enter',
  space: 'Space',
  ' ': 'Space',
  del: 'Delete',
  delete: 'Delete',
  plus: '+',
  minus: '-',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight'
}

function normaliseKeyName(key: string): string {
  const alias = KEY_ALIASES[key.toLowerCase()]
  if (alias) return alias
  if (key.length === 1) return key.toUpperCase()
  if (/^f\d{1,2}$/i.test(key)) return key.toUpperCase()
  return key.charAt(0).toUpperCase() + key.slice(1)
}

/** Canonical form of a combo written by hand: "ctrl+shift+k" -> "Ctrl+Shift+K". */
export function normaliseCombo(combo: string): string {
  const parts = combo.split(/\+(?!$)/).map((part) => part.trim())
  const key = parts.pop()
  if (!key) throw new Error(`Invalid shortcut: "${combo}"`)
  const modifiers = new Set(
    parts.map((part) => {
      const lower = part.toLowerCase()
      if (lower === 'ctrl' || lower === 'control') return 'Ctrl'
      if (lower === 'alt') return 'Alt'
      if (lower === 'shift') return 'Shift'
      throw new Error(`Unknown modifier "${part}" in shortcut "${combo}"`)
    })
  )
  return [...MODIFIER_ORDER.filter((m) => modifiers.has(m)), normaliseKeyName(key)].join('+')
}

/**
 * The combo a keyboard event represents, or null for lone modifier presses.
 * Letters and digits use the physical key so Shift+1 is "Shift+1", not "Shift+!".
 */
export function comboFromEvent(
  event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>
): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null
  let key: string
  const letter = /^Key([A-Z])$/.exec(event.code)
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(event.code)
  if (letter?.[1]) key = letter[1]
  else if (digit?.[1] && (event.ctrlKey || event.altKey || event.shiftKey)) key = digit[1]
  else key = normaliseKeyName(event.key)

  const modifiers: string[] = []
  if (event.ctrlKey || event.metaKey) modifiers.push('Ctrl')
  if (event.altKey) modifiers.push('Alt')
  // Shift is part of the character for symbols like "?" and "+"; keep it only where it changes meaning.
  if (event.shiftKey && (key.length > 1 || /[A-Z0-9]/.test(key))) modifiers.push('Shift')
  return [...modifiers, key].join('+')
}

/** True when the event target accepts typing. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  if (target instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file'].includes(
      target.type
    )
  }
  return false
}

/**
 * While the user is typing, only combos that cannot be text input are
 * shortcuts: function keys, Escape, and anything with Ctrl or Alt. That lets a
 * cashier press F12 to pay without leaving the barcode field.
 */
export function worksWhileTyping(combo: string): boolean {
  return (
    /^F\d{1,2}$/.test(combo.split('+').at(-1) ?? '') ||
    combo === 'Escape' ||
    /^(Ctrl|Alt)\+/.test(combo)
  )
}

/** Display form for hints: "Ctrl+Shift+K" stays, "ArrowUp" becomes "↑". */
export function formatCombo(combo: string): string {
  return combo
    .replace('ArrowUp', '↑')
    .replace('ArrowDown', '↓')
    .replace('ArrowLeft', '←')
    .replace('ArrowRight', '→')
    .replace('Escape', 'Esc')
}
