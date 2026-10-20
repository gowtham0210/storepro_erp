import type { useQueryClient } from '@tanstack/react-query'

/** What a return changes: the returns lists, the invoice's refunds, stock and customer history. */
export async function refreshReturns(
  queryClient: ReturnType<typeof useQueryClient>
): Promise<void> {
  await Promise.all(
    [
      'returns:list',
      'returns:get',
      'returns:find-sale',
      'sales:list',
      'sales:get',
      'receipts:preview',
      'inventory:list',
      'inventory:movements',
      'customers:purchases'
    ].map((key) => queryClient.invalidateQueries({ queryKey: [key] }))
  )
}
