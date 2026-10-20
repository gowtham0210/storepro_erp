import type { GoodsReceiptStatus, PurchaseOrderStatus } from '@shared/ipc/contract'
import type { Tone } from '../components/ui'

export const ORDER_STATUS: Record<PurchaseOrderStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  confirmed: { label: 'Confirmed', tone: 'info' },
  closed: { label: 'Closed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'danger' }
}

export const RECEIPT_STATUS: Record<GoodsReceiptStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  posted: { label: 'In stock', tone: 'success' }
}
