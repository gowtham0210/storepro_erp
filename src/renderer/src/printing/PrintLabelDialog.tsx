import { useQuery } from '@tanstack/react-query'
import { Printer, Tag } from 'lucide-react'
import { useState } from 'react'
import { Alert, Button, Dialog, Field, Spinner, TextInput, useToast } from '../components/ui'
import { invoke } from '../ipc/client'
import { describeError } from '../lib/describeError'

/**
 * M24-03: Shelf & pack price/barcode label preview and print dialog.
 */
export function PrintLabelDialog({
  variantId,
  itemTitle,
  onClose
}: {
  variantId: number
  itemTitle: string
  onClose: () => void
}): React.JSX.Element {
  const toast = useToast()
  const [copiesText, setCopiesText] = useState('1')
  const [packedDate, setPackedDate] = useState('')
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const copies = Math.min(50, Math.max(1, Number.parseInt(copiesText, 10) || 1))
  const cleanPackedDate = packedDate.trim() ? packedDate.trim() : null

  const previewQuery = useQuery({
    queryKey: ['labels:preview', variantId, copies, cleanPackedDate],
    queryFn: () =>
      invoke('labels:preview', {
        variantId,
        copies,
        packedDate: cleanPackedDate
      })
  })

  const preview = previewQuery.data

  const handlePrint = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setError(null)
    setPrinting(true)
    try {
      await invoke('labels:print', {
        variantId,
        copies,
        packedDate: cleanPackedDate
      })
      toast.success(
        `Printed ${copies} ${copies === 1 ? 'label' : 'labels'} for ${preview?.title ?? itemTitle}.`
      )
      onClose()
    } catch (failure) {
      setError(describeError(failure).message)
    } finally {
      setPrinting(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={`Print price label · ${itemTitle}`}
      description="Preview and print shelf or pre-pack price labels with a scannable Code-128 barcode."
    >
      <form noValidate onSubmit={(event) => void handlePrint(event)} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {previewQuery.isError && (
          <Alert tone="danger">{describeError(previewQuery.error).message}</Alert>
        )}

        {previewQuery.isLoading || !preview ? (
          <div className="py-8">
            <Spinner label="Preparing label preview" />
          </div>
        ) : (
          <div
            aria-label="Price label preview"
            className="mx-auto max-w-xs rounded-lg border-2 border-dashed border-border bg-surface p-4 text-center shadow-xs space-y-1.5"
          >
            <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
              {preview.storeName}
            </div>
            <div className="text-base font-bold text-fg">{preview.title}</div>
            <div className="flex items-baseline justify-center gap-2">
              <span className="text-xl font-extrabold text-fg">{preview.priceText}</span>
              {preview.mrpText ? (
                <span className="text-xs text-fg-muted line-through">MRP {preview.mrpText}</span>
              ) : (
                <span className="text-xs text-fg-muted">/ {preview.unitCode}</span>
              )}
            </div>
            {preview.packedDate && (
              <div className="text-xs text-fg-muted">Packed: {preview.packedDate}</div>
            )}
            <div
              className="pt-1"
              dangerouslySetInnerHTML={{ __html: preview.svgBarcode }}
            />
            <div className="font-mono text-xs tracking-widest text-fg">{preview.codeText}</div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Number of copies (1–50)">
            <TextInput
              type="number"
              min={1}
              max={50}
              value={copiesText}
              onChange={(event) => setCopiesText(event.target.value)}
              inputMode="numeric"
            />
          </Field>

          <Field label="Packed on date (optional)" hint="Printed on grocery pre-pack labels">
            <TextInput
              value={packedDate}
              onChange={(event) => setPackedDate(event.target.value)}
              placeholder="e.g. 2026-10-20"
              maxLength={30}
            />
          </Field>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            variant="primary"
            icon={<Printer />}
            loading={printing}
            disabled={!preview}
          >
            <Tag className="h-4 w-4 mr-1 inline" />
            Print {copies > 1 ? `${copies} labels` : 'label'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
