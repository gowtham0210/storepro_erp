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
    [
      'expense.recorded',
      {
        category: 'Rent',
        amount: '₹12,000.00',
        date: '2026-10-05',
        paymentMethod: 'UPI',
        description: 'October shop rent'
      },
      'Rent · ₹12,000.00 · 2026-10-05 · paid by UPI · “October shop rent”'
    ],
    [
      'expense.updated',
      {
        category: 'Electricity',
        date: '2026-10-10',
        changes: { amount: { from: '₹4,000.00', to: '₹4,500.00' } }
      },
      'Electricity on 2026-10-10: amount from ₹4,000.00 to ₹4,500.00'
    ],
    [
      'customer.created',
      { name: 'Meena Sundar', phone: '+919840012345' },
      'Meena Sundar · +919840012345'
    ],
    [
      'customer.updated',
      {
        name: 'Meena Sundar',
        changes: { taxRegistrationNumber: { from: null, to: '33AAAAA0000A1Z5' } }
      },
      'Meena Sundar: tax number from nothing to 33AAAAA0000A1Z5'
    ],
    [
      'return.created',
      {
        returnNumber: 'CN000001',
        invoiceNumber: 'INV000001',
        items: [{}, {}],
        refundDue: '₹320.00',
        refunds: [
          { method: 'Cash', amount: '₹200.00' },
          { method: 'UPI', amount: '₹120.00' }
        ],
        reason: 'Torn bag'
      },
      'CN000001 · invoice INV000001 · 2 items · refunded Cash ₹200.00, UPI ₹120.00 — Torn bag'
    ],
    [
      'return.reprinted',
      { returnNumber: 'CN000001', invoiceNumber: 'INV000001' },
      'CN000001 · invoice INV000001'
    ],
    [
      'expense_category.updated',
      { changes: { name: { from: 'Packaging', to: 'Packing material' } } },
      'name from Packaging to Packing material'
    ]
  ]

  it.each(cases)('describes %s', (action, details, sentence) => {
    expect(describeAuditEntry(entry(action, details))).toBe(sentence)
  })
})
