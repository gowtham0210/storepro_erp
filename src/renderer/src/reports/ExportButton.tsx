import { Download } from 'lucide-react'
import { useState } from 'react'
import type { ReportExportRequest } from '@shared/ipc/contract'
import { useCan } from '../auth/permissions'
import { Button, useToast } from '../components/ui'
import { invoke } from '../ipc/client'
import { describeError } from '../lib/describeError'

/**
 * Save the report on screen as a CSV file (M22-03). The person picks where it
 * goes. Shown only to people who may export data.
 */
export function ExportButton({
  request,
  disabled = false
}: {
  request: ReportExportRequest
  disabled?: boolean
}): React.JSX.Element | null {
  const canExport = useCan()('data.export')
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  if (!canExport) return null

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await invoke('reports:export', request)
      if (result.status === 'saved') {
        toast.success(
          `Saved ${result.fileName} (${result.rows} ${result.rows === 1 ? 'row' : 'rows'}).`
        )
      }
    } catch (failure) {
      toast.error(describeError(failure).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      size="sm"
      icon={<Download />}
      loading={busy}
      disabled={disabled}
      onClick={() => void save()}
    >
      Export CSV
    </Button>
  )
}
