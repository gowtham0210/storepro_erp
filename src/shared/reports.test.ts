import { describe, expect, it } from 'vitest'
import { averageBill, REPORT_METRICS } from './reports'

describe('report definitions (M19-02)', () => {
  it('keeps gross sales, discounts, tax, refunds, net sales and collections apart', () => {
    for (const key of [
      'grossSales',
      'discounts',
      'tax',
      'refunds',
      'netSales',
      'collections'
    ] as const) {
      expect(REPORT_METRICS[key].label.length).toBeGreaterThan(0)
      expect(REPORT_METRICS[key].definition.length).toBeGreaterThan(20)
    }
    const labels = Object.values(REPORT_METRICS).map((m) => m.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('averages a bill to the minor unit, half up, and is zero with no bills', () => {
    expect(averageBill(10_000, 4)).toBe(2500)
    expect(averageBill(10_001, 2)).toBe(5001) // 5000.5 rounds up
    expect(averageBill(10_000, 3)).toBe(3333)
    expect(averageBill(0, 0)).toBe(0)
    expect(averageBill(500, 0)).toBe(0)
  })
})
