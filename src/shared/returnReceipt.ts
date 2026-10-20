/**
 * The return receipt, or credit note, for 58 mm and 80 mm thermal paper
 * (M16-05). It reuses the receipt engine's document, layout helpers and HTML
 * and ESC/POS output (`src/shared/receipt.ts`, `escpos.ts`); only the content
 * differs: what came back, the tax credited, and how the refund was paid.
 *
 * Pure and dependency-free, like the sale receipt.
 */
import type { ReceiptPaperWidthMm, ReturnDetail, StoreProfile } from './ipc/contract'
import { formatMoney } from './money'
import { UPI_RECORDED_NOTICE } from './payments'
import { formatQuantity } from './quantity'
import {
  centerText,
  leftRight,
  RECEIPT_WIDTH_COLS,
  wrapText,
  type ReceiptDocument
} from './receipt'
import { formatStoreTime } from './storeTime'

export const RETURN_RECEIPT_TITLE = '*** RETURN / CREDIT NOTE ***'

export interface ReturnReceiptOptions {
  paperWidthMm: ReceiptPaperWidthMm
  /** Marks the receipt with a prominent Duplicate/Reprint banner. */
  isReprint?: boolean
}

function ratePercent(rateBp: number): string {
  return `${(rateBp / 100).toFixed(rateBp % 100 === 0 ? 0 : 2)}%`
}

export function buildReturnReceiptDocument(
  store: StoreProfile,
  ret: ReturnDetail,
  options: ReturnReceiptOptions
): ReceiptDocument {
  const columns = RECEIPT_WIDTH_COLS[options.paperWidthMm]
  const isReprint = options.isReprint === true
  const currency = store.currency
  const money = (minor: number): string => formatMoney(minor, currency)
  const ruleDash = '-'.repeat(columns)
  const ruleDouble = '='.repeat(columns)
  const lines: string[] = []

  lines.push(...centerText(store.name.toUpperCase(), columns))
  const addressParts = [store.addressLine1, store.addressLine2].filter((part): part is string =>
    Boolean(part && part.trim() !== '')
  )
  const cityLine = [store.city, store.regionCode, store.postalCode]
    .filter((part): part is string => Boolean(part && part.trim() !== ''))
    .join(' ')
  const storeAddressLines = [...addressParts, cityLine].filter((s) => s !== '')
  for (const address of storeAddressLines) lines.push(...centerText(address, columns))
  lines.push(...centerText(`Ph: ${store.phone}`, columns))
  if (store.email) lines.push(...centerText(store.email, columns))
  if (store.taxRegistrationNumber) {
    const label = store.countryCode === 'IN' ? 'GSTIN' : 'Tax ID'
    lines.push(...centerText(`${label}: ${store.taxRegistrationNumber}`, columns))
  }
  if (store.receiptHeader && store.receiptHeader.trim() !== '') {
    lines.push(...centerText(store.receiptHeader.trim(), columns))
  }

  if (isReprint) {
    lines.push(ruleDouble)
    lines.push(...centerText('*** DUPLICATE / REPRINT ***', columns))
    lines.push(ruleDouble)
  }
  lines.push(ruleDash)
  lines.push(...centerText(RETURN_RECEIPT_TITLE, columns))
  lines.push(ruleDash)

  const returnedAtText = formatStoreTime(ret.returnedAt, store.timeZone)
  lines.push(...leftRight(`Return: ${ret.returnNumber}`, returnedAtText, columns))
  lines.push(...leftRight(`Invoice: ${ret.invoiceNumber}`, '', columns))
  lines.push(...leftRight(`Handled by: ${ret.processedByName}`, '', columns))
  if (ret.customerName) lines.push(...leftRight(`Customer: ${ret.customerName}`, '', columns))
  lines.push(ruleDash)

  lines.push(...leftRight('Item (Qty x Rate)', 'Credit', columns))
  lines.push(ruleDash)
  for (const line of ret.lines) {
    lines.push(...wrapText(line.description, columns))
    lines.push(
      ...leftRight(
        `  ${formatQuantity(line.quantityMilli)} ${line.unitCode} x ${money(line.unitPriceMinor)}`,
        money(line.creditMinor),
        columns
      )
    )
  }
  lines.push(ruleDash)

  lines.push(
    ...leftRight(
      ret.pricesIncludeTax ? 'Goods value (incl. tax)' : 'Goods value',
      money(ret.creditMinor),
      columns
    )
  )
  for (const tax of ret.taxSummary) {
    const inclTag = ret.pricesIncludeTax ? ' (incl.)' : ''
    lines.push(
      ...leftRight(
        `${tax.code} ${ratePercent(tax.rateBp)}${inclTag}`,
        money(tax.amountMinor),
        columns
      )
    )
  }

  lines.push(ruleDouble)
  lines.push(...leftRight('TOTAL REFUND', money(ret.refundDueMinor), columns))
  lines.push(ruleDouble)

  for (const refund of ret.refunds) {
    const reference = refund.reference ? ` (${refund.reference})` : ''
    lines.push(
      ...leftRight(`Refunded: ${refund.methodName}${reference}`, money(refund.amountMinor), columns)
    )
    if (refund.kind === 'upi') lines.push(...wrapText(`  * ${UPI_RECORDED_NOTICE}`, columns))
  }
  if (ret.reason) {
    lines.push(ruleDash)
    lines.push(...wrapText(`Reason: ${ret.reason}`, columns))
  }
  if (store.receiptFooter && store.receiptFooter.trim() !== '') {
    lines.push(ruleDash)
    lines.push(...centerText(store.receiptFooter.trim(), columns))
  }

  return {
    paperWidthMm: options.paperWidthMm,
    columns,
    isReprint,
    isVoided: false,
    storeName: store.name,
    storeAddressLines,
    storePhone: store.phone,
    storeEmail: store.email,
    taxRegistrationNumber: store.taxRegistrationNumber,
    receiptHeader: store.receiptHeader,
    receiptFooter: store.receiptFooter,
    invoiceNumber: ret.returnNumber,
    completedAtText: returnedAtText,
    cashierName: ret.processedByName,
    customerName: ret.customerName,
    lines
  }
}
