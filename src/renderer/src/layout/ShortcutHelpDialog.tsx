import { Dialog } from '../components/ui/Dialog'
import { Kbd } from '../components/ui/Kbd'
import { formatCombo } from '../shortcuts/keys'
import type { ActiveShortcut } from '../shortcuts/ShortcutProvider'

interface ShortcutHelpDialogProps {
  open: boolean
  onClose: () => void
  /** Captured when the dialog opened, so it lists the screen's shortcuts rather than the dialog's own. */
  shortcuts: readonly ActiveShortcut[]
}

/** F1: every shortcut that works on the current screen. */
export function ShortcutHelpDialog({
  open,
  onClose,
  shortcuts
}: ShortcutHelpDialogProps): React.JSX.Element {
  const groups = new Map<string, ActiveShortcut[]>()
  for (const shortcut of shortcuts)
    groups.set(shortcut.layer, [...(groups.get(shortcut.layer) ?? []), shortcut])
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      description="Shortcuts that work on this screen."
    >
      <div className="space-y-6">
        {[...groups].map(([layer, items]) => (
          <section key={layer} aria-label={layer}>
            <h3 className="mb-2 text-sm font-semibold tracking-wide text-fg-subtle uppercase">
              {layer}
            </h3>
            <dl className="divide-y divide-divider">
              {items.map((shortcut) => (
                <div key={shortcut.combo} className="flex items-center justify-between gap-4 py-2">
                  <dt>{shortcut.description}</dt>
                  <dd>
                    <Kbd>{formatCombo(shortcut.combo)}</Kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  )
}
