import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Download, FileSpreadsheet, Upload, XCircle } from 'lucide-react'
import { useState } from 'react'
import { escapeCsvCell } from '@shared/csv'
import type {
  ProductCsvColumnMapping,
  ProductImportPreview,
  ProductImportRowPreview
} from '@shared/ipc/contract'
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  Field,
  Money,
  Select,
  TextArea,
  useToast,
  type Column
} from '../components/ui'
import { invoke } from '../ipc/client'
import { describeError } from '../lib/describeError'

type FilterKind = 'all' | 'errors' | 'valid'

function triggerCsvDownload(filename: string, csvText: string): void {
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function buildErrorReportCsv(rows: readonly ProductImportRowPreview[]): string {
  const header = ['row_number', 'product_name', 'variant_name', 'sku', 'status', 'errors'].join(',')
  const lines = rows
    .filter((r) => !r.valid)
    .map((r) =>
      [
        r.rowNumber,
        r.productName,
        r.variantName ?? '',
        r.sku ?? '',
        'error',
        r.issues.map((i) => `${i.field}: ${i.message}`).join('; ')
      ]
        .map(escapeCsvCell)
        .join(',')
    )
  return `${header}\n${lines.join('\n')}\n`
}

const previewColumns: Column<ProductImportRowPreview>[] = [
  {
    id: 'row',
    header: 'Row',
    cell: (row) => <span className="tabular text-fg-muted">#{row.rowNumber}</span>
  },
  {
    id: 'status',
    header: 'Status',
    cell: (row) =>
      row.valid ? (
        <Badge tone="success">Ready</Badge>
      ) : (
        <Badge tone="danger">{`${row.issues.length} error(s)`}</Badge>
      )
  },
  {
    id: 'item',
    header: 'Product & pack size',
    cell: (row) => (
      <div>
        <span className="font-medium">{row.productName || '(Missing name)'}</span>
        {row.variantName && <span className="text-fg-muted"> · {row.variantName}</span>}
        <div className="text-xs text-fg-muted">
          {row.sku ? `SKU: ${row.sku}` : 'SKU: Auto'}
          {row.barcodes.length > 0 ? ` · Barcode: ${row.barcodes.join(', ')}` : ''}
        </div>
      </div>
    )
  },
  {
    id: 'category',
    header: 'Category',
    cell: (row) =>
      row.categoryName ? (
        <span>
          {row.categoryName}{' '}
          {row.willCreateCategory && <Badge tone="info">New</Badge>}
        </span>
      ) : (
        <span className="text-fg-muted">None</span>
      )
  },
  {
    id: 'price',
    header: 'Price / Unit',
    align: 'right',
    cell: (row) =>
      row.sellingPriceMinor === null ? (
        <span className="text-danger">Invalid</span>
      ) : (
        <span>
          <Money minor={row.sellingPriceMinor} /> / {row.unitCode || '?'}
        </span>
      )
  },
  {
    id: 'issues',
    header: 'Validation details',
    cell: (row) =>
      row.valid ? (
        <span className="inline-flex items-center gap-1 text-xs text-success">
          <CheckCircle2 className="h-3.5 w-3.5" /> Valid
        </span>
      ) : (
        <ul className="space-y-0.5 text-xs text-danger">
          {row.issues.map((issue, idx) => (
            <li key={idx}>
              <strong className="font-medium">{issue.field}:</strong> {issue.message}
            </li>
          ))}
        </ul>
      )
  }
]

/**
 * M22-01 & M22-02 (FR-026): CSV product import dialog with template download,
 * file upload / paste CSV, optional column mapping, row-by-row validation
 * preview, downloadable error report CSV, and atomic batch commit.
 */
export function ProductImportDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const queryClient = useQueryClient()
  const toast = useToast()

  const [csvText, setCsvText] = useState('')
  const [mapping, setMapping] = useState<ProductCsvColumnMapping>({})
  const [preview, setPreview] = useState<ProductImportPreview | null>(null)
  const [filter, setFilter] = useState<FilterKind>('all')
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDownloadTemplate = async (): Promise<void> => {
    try {
      const tpl = await invoke('import:products-template')
      triggerCsvDownload(tpl.filename, tpl.csvText)
    } catch (failure) {
      toast.error(describeError(failure).message)
    }
  }

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      setCsvText(text)
      await runPreview(text, mapping)
    } catch (failure) {
      setError(describeError(failure).message)
    }
  }

  const runPreview = async (
    textToPreview: string,
    mappingOverride: ProductCsvColumnMapping
  ): Promise<void> => {
    if (!textToPreview.trim()) {
      setError('Upload a CSV file or paste CSV rows first.')
      return
    }
    setError(null)
    setLoadingPreview(true)
    try {
      const hasOverrides = Object.values(mappingOverride).some(Boolean)
      const result = await invoke('import:products-preview', {
        csvText: textToPreview,
        ...(hasOverrides ? { mapping: mappingOverride } : {})
      })
      setPreview(result)
    } catch (failure) {
      setError(describeError(failure).message)
      setPreview(null)
    } finally {
      setLoadingPreview(false)
    }
  }

  const handleCommit = async (): Promise<void> => {
    if (!preview || preview.errorRowCount > 0 || preview.validRowCount === 0) return
    setError(null)
    setCommitting(true)
    try {
      const hasOverrides = Object.values(mapping).some(Boolean)
      const result = await invoke('import:products-commit', {
        csvText,
        ...(hasOverrides ? { mapping } : {})
      })
      await queryClient.invalidateQueries({ queryKey: ['products:list'] })
      await queryClient.invalidateQueries({ queryKey: ['catalog:list-categories'] })
      toast.success(
        `Imported ${result.createdProductCount} product(s) (${result.createdVariantCount} pack sizes).`
      )
      onClose()
    } catch (failure) {
      setError(describeError(failure).message)
    } finally {
      setCommitting(false)
    }
  }

  const filteredRows = (preview?.rows ?? []).filter((r) => {
    if (filter === 'errors') return !r.valid
    if (filter === 'valid') return r.valid
    return true
  })

  const canCommit =
    preview !== null && preview.totalRows > 0 && preview.errorRowCount === 0 && !loadingPreview

  return (
    <Dialog
      open
      title="Import products from CSV"
      description="Upload a CSV file to preview and validate every row before adding products to your catalogue."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button onClick={onClose} disabled={committing}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={<Upload />}
            loading={committing}
            disabled={!canCommit}
            onClick={() => void handleCommit()}
          >
            {preview && preview.validRowCount > 0
              ? `Import ${preview.productCountToCreate} product(s)`
              : 'Import products'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-bg-subtle p-3 text-sm">
          <span className="text-fg-muted">
            Download the CSV template with sample rows and column descriptions.
          </span>
          <Button
            size="sm"
            icon={<Download />}
            onClick={() => void handleDownloadTemplate()}
          >
            Download CSV template
          </Button>
        </div>

        {error && <Alert tone="danger">{error}</Alert>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
          <Field label="Choose CSV file (.csv)">
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label="Choose CSV file"
              onChange={(event) => void handleFileSelected(event)}
              className="block w-full text-sm text-fg file:mr-3 file:rounded-md file:border file:border-border file:bg-bg-subtle file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-fg"
            />
          </Field>
          <div className="flex items-end">
            <Button
              icon={<FileSpreadsheet />}
              loading={loadingPreview}
              disabled={!csvText.trim()}
              onClick={() => void runPreview(csvText, mapping)}
            >
              Validate & preview
            </Button>
          </div>
        </div>

        <Field
          label="CSV content"
          hint="You can also paste or edit CSV rows directly here and click Validate & preview."
        >
          <TextArea
            rows={4}
            value={csvText}
            placeholder="product_name,variant_name,sku,barcode,category,unit_code,selling_price,mrp..."
            onChange={(event) => {
              setCsvText(event.target.value)
              setPreview(null)
            }}
          />
        </Field>

        {/* Optional column mapping override when headers are detected */}
        {preview && preview.detectedHeaders.length > 0 && (
          <details className="rounded-md border border-divider p-3 text-sm">
            <summary className="cursor-pointer font-medium text-fg">
              Column mapping ({preview.detectedHeaders.length} columns detected)
            </summary>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {(
                [
                  ['productName', 'Product name'],
                  ['variantName', 'Pack size / variant'],
                  ['unitCode', 'Unit code'],
                  ['sellingPrice', 'Selling price'],
                  ['mrp', 'MRP'],
                  ['category', 'Category'],
                  ['sku', 'SKU'],
                  ['barcode', 'Barcode'],
                  ['taxClass', 'Tax rate']
                ] as const
              ).map(([fieldKey, label]) => (
                <Field key={fieldKey} label={label}>
                  <Select
                    value={mapping[fieldKey] ?? preview.resolvedMapping[fieldKey] ?? ''}
                    onChange={(event) => {
                      const next = { ...mapping, [fieldKey]: event.target.value }
                      setMapping(next)
                      void runPreview(csvText, next)
                    }}
                    options={[
                      { value: '', label: '(Unmapped)' },
                      ...preview.detectedHeaders.map((h) => ({ value: h, label: h }))
                    ]}
                  />
                </Field>
              ))}
            </div>
          </details>
        )}

        {/* Validation summary & row-by-row preview */}
        {preview && (
          <div className="space-y-3">
            {preview.errorRowCount > 0 ? (
              <Alert tone="danger" title="Fix errors before importing">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {preview.errorRowCount} of {preview.totalRows} row(s) have validation errors.
                    No products are imported until all rows are valid.
                  </span>
                  <Button
                    size="sm"
                    icon={<XCircle />}
                    onClick={() =>
                      triggerCsvDownload(
                        'storepro-import-errors.csv',
                        buildErrorReportCsv(preview.rows)
                      )
                    }
                  >
                    Download error report
                  </Button>
                </div>
              </Alert>
            ) : preview.totalRows > 0 ? (
              <Alert tone="success" title="All rows validated">
                Ready to create {preview.productCountToCreate} product(s) with{' '}
                {preview.variantCountToCreate} pack size(s)
                {preview.categoriesToCreate.length > 0
                  ? ` and ${preview.categoriesToCreate.length} new category (${preview.categoriesToCreate.join(', ')})`
                  : ''}
                .
              </Alert>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={filter === 'all' ? 'primary' : 'secondary'}
                  onClick={() => setFilter('all')}
                >
                  All rows ({preview.totalRows})
                </Button>
                <Button
                  size="sm"
                  variant={filter === 'errors' ? 'primary' : 'secondary'}
                  onClick={() => setFilter('errors')}
                >
                  Errors ({preview.errorRowCount})
                </Button>
                <Button
                  size="sm"
                  variant={filter === 'valid' ? 'primary' : 'secondary'}
                  onClick={() => setFilter('valid')}
                >
                  Valid ({preview.validRowCount})
                </Button>
              </div>
            </div>

            <DataTable
              caption="CSV import preview"
              columns={previewColumns}
              rows={filteredRows}
              getRowId={(r) => r.rowNumber}
            />
          </div>
        )}
      </div>
    </Dialog>
  )
}
