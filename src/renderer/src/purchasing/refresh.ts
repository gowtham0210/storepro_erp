import type { useQueryClient } from '@tanstack/react-query'

/** Everything a purchase can change: the purchase lists, stock levels and item costs. */
export async function refreshPurchases(
  queryClient: ReturnType<typeof useQueryClient>
): Promise<void> {
  await Promise.all(
    [
      'purchases:list-orders',
      'purchases:get-order',
      'purchases:list-receipts',
      'purchases:get-receipt',
      'purchases:cost-history',
      'suppliers:list',
      'inventory:list',
      'inventory:movements',
      'products:list',
      'products:get'
    ].map((key) => queryClient.invalidateQueries({ queryKey: [key] }))
  )
}
