import { describe, expect, it } from 'vitest'
import type { AuditLogEntry } from '@shared/ipc/contract'
import { describeAuditEntry } from '../audit/describeAuditEntry'

function entry(action: string, details: Record<string, unknown>): AuditLogEntry {
  return {
    id: 1,
    occurredAt: Date.UTC(2026, 9, 19, 4, 30),
    action,
    actor: { userId: 1, displayName: 'Ravi Kumar', username: 'owner' },
    approvedBy: null,
    entity: null,
    details
  }
}

describe('audit descriptions for purchases, expenses, customers and returns (M15 to M18)', () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ['supplier.created', { name: 'Anand Wholesale' }, 'Anand Wholesale'],
    [
      'supplier.updated',
      {
        name: 'Anand Wholesale',
        changes: { phone: { from: null, to: '044 2345 6789' } }
      },
      'Anand Wholesale: phone from nothing to 044 2345 6789'
    ],
    [
      'purchase_order.created',
      {
        orderNumber: 'PO000001',
        supplier: 'Anand Wholesale',
        items: [{}, {}],
        total: '₹3,208.67'
      },
      'PO000001 · Anand Wholesale · 2 items · ₹3,208.67'
    ],
    [
      'purchase_order.updated',
      { orderNumber: 'PO000001', changes: {}, items: [{}] },
      'PO000001: items changed (1 item)'
    ],
    [
      'purchase_order.cancelled',
      { orderNumber: 'PO000001', supplier: 'Anand Wholesale', reason: 'Out of stock' },
      'PO000001 · Anand Wholesale — Out of stock'
    ],
    [
      'goods_receipt.posted',
      {
        receiptNumber: 'GRN000004',
        supplier: 'Anand Wholesale',
        order: 'PO000001',
        supplierBill: 'AW-1042',
        items: [{}, {}, {}],
        total: '₹1,920.00',
        orderClosed: true,
        costPricesUpdated: [{ item: 'Neem Soap', from: '₹30.00', to: '₹33.50' }]
      },
      'GRN000004 · Anand Wholesale · against PO000001 · bill AW-1042 · 3 items · ₹1,920.00 — order fully received — cost prices updated: Neem Soap ₹30.00 → ₹33.50'
    ],
    [
      'goods_receipt.deleted',
      { receiptNumber: 'GRN000005', supplier: 'Balaji Traders' },
      'GRN000005 · Balaji Traders'
    ],
  ]

  it.each(cases)('describes %s', (action, details, sentence) => {
    expect(describeAuditEntry(entry(action, details))).toBe(sentence)
  })
})
