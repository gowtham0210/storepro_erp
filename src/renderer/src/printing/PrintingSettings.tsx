import { useQueryClient } from '@tanstack/react-query'
import { Printer, Save, Scale } from 'lucide-react'
import { useState } from 'react'
import type { PrinterConfig, PrinterDeviceInfo, WeighBarcodeSettings } from '@shared/ipc/contract'
import { printerConfigSchema, weighBarcodeSettingsSchema } from '@shared/schemas/printing'
import { Alert, Button, Card, Field, Select, Spinner, TextInput, useToast } from '../components/ui'
import { invoke } from '../ipc/client'
import { useIpcQuery } from '../ipc/hooks'
import { describeError } from '../lib/describeError'
import { useStore } from '../store/storeContext'

/**
 * M21-03, M21-04: Receipt printer selection, thermal paper width (58 mm / 80 mm),
 * Windows driver vs. ESC/POS mode, auto-print toggle, cash drawer kick, and test print.
 */
export function ReceiptPrinterSection({ canEdit }: { canEdit: boolean }): React.JSX.Element {
  const printers = useIpcQuery('printers:list')
  const config = useIpcQuery('printers:get-config')

  return (
    <Card title="Receipt printer">
      {config.error ? (
        <Alert tone="danger">{describeError(config.error).message}</Alert>
      ) : !config.data ? (
        <Spinner label="Loading printer settings" />
      ) : (
        <ReceiptPrinterForm
          key={JSON.stringify(config.data)}
          current={config.data}
          devices={printers.data ?? []}
          canEdit={canEdit}
        />
      )}
    </Card>
  )
}

function ReceiptPrinterForm({
  current,
  devices,
  canEdit
}: {
  current: PrinterConfig
  devices: readonly PrinterDeviceInfo[]
  canEdit: boolean
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [draft, setDraft] = useState<PrinterConfig>(current)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const changed = JSON.stringify(draft) !== JSON.stringify(current)

  const printerOptions = [
    { value: '', label: 'System default printer' },
    ...devices.map((d) => ({
      value: d.name,
      label: d.isDefault ? `${d.displayName} (Default)` : d.displayName
    }))
  ]

  const handleSave = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setError(null)
    const parsed = printerConfigSchema.safeParse(draft)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid printer settings')
      return
    }
    setSaving(true)
    try {
      const saved = await invoke('printers:set-config', parsed.data)
      queryClient.setQueryData(['printers:get-config'], saved)
      toast.success('Receipt printer settings saved.')
    } catch (failure) {
      setError(describeError(failure).message)
    } finally {
      setSaving(false)
    }
  }

  const handleTestPrint = async (): Promise<void> => {
    setError(null)
    setTesting(true)
    try {
      const result = await invoke('printers:test-print')
      toast.success(
        `Test receipt sent (${result.paperWidthMm} mm · ${
          result.printMode === 'escpos' ? 'ESC/POS' : 'Windows driver'
        }).`
      )
    } catch (failure) {
      setError(describeError(failure).message)
    } finally {
      setTesting(false)
    }
  }

  return (
    <form noValidate onSubmit={(event) => void handleSave(event)} className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}

      <fieldset disabled={!canEdit} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Printer">
          <Select
            value={draft.printerName ?? ''}
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                printerName: event.target.value ? event.target.value : null
              }))
            }
            options={printerOptions}
          />
        </Field>

        <Field label="Thermal paper width" hint="58 mm (32 cols) or 80 mm (48 cols)">
          <Select
            value={String(draft.paperWidthMm)}
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                paperWidthMm: Number(event.target.value) === 58 ? 58 : 80
              }))
            }
            options={[
              { value: '80', label: '80 mm (48 columns)' },
              { value: '58', label: '58 mm (32 columns)' }
            ]}
          />
        </Field>

        <Field label="Print mode" hint="Windows driver or raw ESC/POS commands">
          <Select
            value={draft.printMode}
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                printMode: event.target.value === 'escpos' ? 'escpos' : 'driver'
              }))
            }
            options={[
              { value: 'driver', label: 'Windows printer driver' },
              { value: 'escpos', label: 'ESC/POS raw commands' }
            ]}
          />
        </Field>
      </fieldset>

      <fieldset disabled={!canEdit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex items-start gap-2.5 rounded-md border border-border p-3 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-border"
            checked={draft.autoPrintReceipt}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, autoPrintReceipt: event.target.checked }))
            }
          />
          <span>
            <span className="font-medium text-fg block">
              Automatically print receipt after checkout
            </span>
            <span className="text-fg-muted">
              Sends the receipt to the printer as soon as payment is completed.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2.5 rounded-md border border-border p-3 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-border"
            checked={draft.openCashDrawer}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, openCashDrawer: event.target.checked }))
            }
          />
          <span>
            <span className="font-medium text-fg block">
              Open cash drawer on cash sales (ESC/POS)
            </span>
            <span className="text-fg-muted">
              Sends an ESC/POS drawer kick pulse when a cash sale is printed in ESC/POS mode.
            </span>
          </span>
        </label>
      </fieldset>

      {canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <Button
            icon={<Printer />}
            loading={testing}
            onClick={() => void handleTestPrint()}
          >
            Test print
          </Button>
          <div className="flex items-center gap-3">
            {changed && <span className="text-sm text-fg-muted">Unsaved changes</span>}
            <Button
              type="submit"
              variant="primary"
              icon={<Save />}
              loading={saving}
              disabled={!changed}
            >
              Save printer settings
            </Button>
          </div>
        </div>
      )}
    </form>
  )
}

/**
 * M24-02: Variable-weight and embedded-price EAN-13 barcode prefix settings
 * for grocery weighing scales.
 */
export function WeighBarcodeSection({ canEdit }: { canEdit: boolean }): React.JSX.Element | null {
  const store = useStore()
  const groceryEnabled = store.enabledModules.includes('grocery')
  const config = useIpcQuery('grocery:get-weigh-barcode')

  if (!groceryEnabled) return null

  return (
    <Card title="Scale barcodes (Grocery)">
      {config.error ? (
        <Alert tone="danger">{describeError(config.error).message}</Alert>
      ) : !config.data ? (
        <Spinner label="Loading scale barcode settings" />
      ) : (
        <WeighBarcodeForm
          key={JSON.stringify(config.data)}
          current={config.data}
          canEdit={canEdit}
        />
      )}
    </Card>
  )
}

function WeighBarcodeForm({
  current,
  canEdit
}: {
  current: WeighBarcodeSettings
  canEdit: boolean
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [draft, setDraft] = useState<WeighBarcodeSettings>(current)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const changed = JSON.stringify(draft) !== JSON.stringify(current)

  const handleSave = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setError(null)
    const parsed = weighBarcodeSettingsSchema.safeParse(draft)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid scale barcode settings')
      return
    }
    setSaving(true)
    try {
      const saved = await invoke('grocery:set-weigh-barcode', parsed.data)
      queryClient.setQueryData(['grocery:get-weigh-barcode'], saved)
      toast.success('Scale barcode settings saved.')
    } catch (failure) {
      setError(describeError(failure).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form noValidate onSubmit={(event) => void handleSave(event)} className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}

      <fieldset disabled={!canEdit} className="space-y-4">
        <label className="flex items-start gap-2.5 rounded-md border border-border p-3 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-border"
            checked={draft.enabled}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, enabled: event.target.checked }))
            }
          />
          <span>
            <span className="font-medium text-fg block">
              Enable variable-weight scale barcodes
            </span>
            <span className="text-fg-muted">
              Parses 13-digit EAN-13 scale barcodes (`PP IIIII VVVVV C`) into item code and weight
              in grams or total price.
            </span>
          </span>
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Weight barcode prefix (2 digits)"
            hint="Default 20 — 5-digit value is weight in grams (e.g. 00750 = 0.75 kg)"
          >
            <TextInput
              value={draft.weightPrefix}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, weightPrefix: event.target.value }))
              }
              maxLength={2}
              inputMode="numeric"
            />
          </Field>

          <Field
            label="Price barcode prefix (2 digits)"
            hint="Default 21 — 5-digit value is total price in minor units / paise"
          >
            <TextInput
              value={draft.pricePrefix}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, pricePrefix: event.target.value }))
              }
              maxLength={2}
              inputMode="numeric"
            />
          </Field>
        </div>
      </fieldset>

      {canEdit && (
        <div className="flex items-center justify-end gap-3 pt-1">
          {changed && <span className="text-sm text-fg-muted">Unsaved changes</span>}
          <Button
            type="submit"
            variant="primary"
            icon={<Scale />}
            loading={saving}
            disabled={!changed}
          >
            Save scale barcode settings
          </Button>
        </div>
      )}
    </form>
  )
}
