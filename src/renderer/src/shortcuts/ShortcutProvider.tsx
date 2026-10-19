import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode
} from 'react'
import { comboFromEvent, isEditableTarget, normaliseCombo, worksWhileTyping } from './keys'

export interface ShortcutOptions {
  /** Shown in the shortcut help (F1). Shortcuts without one are hidden from it. */
  description?: string | undefined
  /** Fire even for plain keys while focus is in a text field. */
  allowInInputs?: boolean | undefined
  enabled?: boolean | undefined
}

interface Registration {
  id: string
  combo: string
  handler: (event: KeyboardEvent) => void
  options: ShortcutOptions
}

interface Layer {
  id: string
  name: string
  /** An exclusive layer (e.g. a modal dialog) hides every layer below it. */
  exclusive: boolean
  registrations: Map<string, Registration>
}

export interface ActiveShortcut {
  combo: string
  description: string
  layer: string
}

class ShortcutRegistry {
  private layers: Layer[] = []
  private listeners = new Set<() => void>()
  private snapshot: ActiveShortcut[] = []

  pushLayer(id: string, name: string, exclusive: boolean): void {
    this.layers.push({ id, name, exclusive, registrations: new Map() })
    this.changed()
  }

  removeLayer(id: string): void {
    this.layers = this.layers.filter((layer) => layer.id !== id)
    this.changed()
  }

  register(layerId: string, registration: Registration): () => void {
    const layer = this.layers.find((l) => l.id === layerId)
    if (!layer) throw new Error(`Shortcut layer ${layerId} is not mounted`)
    if (import.meta.env.DEV) {
      for (const other of layer.registrations.values()) {
        if (other.combo === registration.combo && other.options.enabled !== false) {
          console.warn(`Shortcut ${registration.combo} is registered twice in "${layer.name}"`)
        }
      }
    }
    layer.registrations.set(registration.id, registration)
    this.changed()
    return () => {
      layer.registrations.delete(registration.id)
      this.changed()
    }
  }

  /** Layers that currently receive keys, top first. */
  private activeLayers(): Layer[] {
    const active: Layer[] = []
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const layer = this.layers[i]
      if (!layer) continue
      active.push(layer)
      if (layer.exclusive) break
    }
    return active
  }

  dispatch(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing) return
    const combo = comboFromEvent(event)
    if (!combo) return
    const typing = isEditableTarget(event.target)
    for (const layer of this.activeLayers()) {
      for (const registration of layer.registrations.values()) {
        if (registration.combo !== combo || registration.options.enabled === false) continue
        if (typing && !registration.options.allowInInputs && !worksWhileTyping(combo)) continue
        event.preventDefault()
        registration.handler(event)
        return
      }
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): ActiveShortcut[] => this.snapshot

  private changed(): void {
    this.snapshot = this.activeLayers().flatMap((layer) =>
      [...layer.registrations.values()]
        .filter((r) => r.options.description && r.options.enabled !== false)
        .map((r) => ({
          combo: r.combo,
          description: r.options.description ?? '',
          layer: layer.name
        }))
    )
    for (const listener of this.listeners) listener()
  }
}

const RegistryContext = createContext<ShortcutRegistry | null>(null)
const LayerContext = createContext<string | null>(null)

function useRegistry(): ShortcutRegistry {
  const registry = useContext(RegistryContext)
  if (!registry) throw new Error('Shortcut hooks must be used inside <ShortcutProvider>')
  return registry
}

/** Owns the single keydown listener and the global layer. */
export function ShortcutProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [registry] = useState(() => {
    const created = new ShortcutRegistry()
    created.pushLayer('global', 'Everywhere', false)
    return created
  })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => registry.dispatch(event)
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [registry])
  return (
    <RegistryContext.Provider value={registry}>
      <LayerContext.Provider value="global">{children}</LayerContext.Provider>
    </RegistryContext.Provider>
  )
}

/**
 * Shortcuts registered by children belong to this layer while it is mounted:
 * use one per screen ("Billing") and an exclusive one per modal dialog.
 */
export function ShortcutScope({
  name,
  exclusive = false,
  children
}: {
  name: string
  exclusive?: boolean
  children: ReactNode
}): React.JSX.Element {
  const registry = useRegistry()
  const id = useId()
  // A layout effect runs before the children's passive effects, so the layer
  // exists by the time their useShortcut calls register.
  useLayoutEffect(() => {
    registry.pushLayer(id, name, exclusive)
    return () => registry.removeLayer(id)
  }, [registry, id, name, exclusive])
  return <LayerContext.Provider value={id}>{children}</LayerContext.Provider>
}

export interface ShortcutDefinition extends ShortcutOptions {
  combo: string
  handler: (event: KeyboardEvent) => void
}

/**
 * Register several shortcuts in the nearest scope. Handlers may change every
 * render; registrations only change when combos or options do.
 */
export function useShortcuts(definitions: readonly ShortcutDefinition[]): void {
  const registry = useRegistry()
  const layerId = useContext(LayerContext)
  const id = useId()
  const latest = useRef(definitions)
  useEffect(() => {
    latest.current = definitions
  })
  const normalised = definitions.map((d) => ({
    combo: normaliseCombo(d.combo),
    description: d.description,
    allowInInputs: d.allowInInputs,
    enabled: d.enabled
  }))
  const signature = JSON.stringify(normalised)

  useEffect(() => {
    if (!layerId) return
    const entries = JSON.parse(signature) as typeof normalised
    const unregister = entries.map((entry, index) =>
      registry.register(layerId, {
        id: `${id}-${index}`,
        combo: entry.combo,
        handler: (event) => latest.current[index]?.handler(event),
        options: {
          description: entry.description,
          allowInInputs: entry.allowInInputs,
          enabled: entry.enabled
        }
      })
    )
    return () => unregister.forEach((fn) => fn())
    // `signature` captures everything that affects registration.
  }, [registry, layerId, id, signature])
}

/**
 * Register one shortcut (or aliases, e.g. ['Ctrl+=', 'Ctrl++']) in the nearest
 * scope. Only the first alias is listed in the help dialog.
 */
export function useShortcut(
  combo: string | readonly string[],
  handler: (event: KeyboardEvent) => void,
  options: ShortcutOptions = {}
): void {
  const combos = typeof combo === 'string' ? [combo] : combo
  useShortcuts(
    combos.map((c, index) => ({
      ...options,
      combo: c,
      handler,
      description: index === 0 ? options.description : undefined
    }))
  )
}

/** Shortcuts that work right now, for the help dialog. */
export function useActiveShortcuts(): ActiveShortcut[] {
  const registry = useRegistry()
  return useSyncExternalStore(registry.subscribe, registry.getSnapshot)
}
