import { z } from 'zod'
import {
  pricingPolicySchema,
  taxClassInputSchema,
  taxClassUpdateSchema
} from '@shared/schemas/pricing'
import type { PricingService } from '../../pricing/pricingService'
import type { HandlerDefinition } from '../serviceHost'

type Channel =
  | 'tax:create-class'
  | 'tax:update-class'
  | 'tax:set-class-active'
  | 'pricing:get-settings'
  | 'pricing:update-policy'

export function createPricingHandlers(pricing: PricingService): {
  [C in Channel]: HandlerDefinition<C>
} {
  return {
    'tax:create-class': {
      access: 'settings.edit',
      input: taxClassInputSchema,
      handle: (input, { actor }) => pricing.createTaxClass(actor, input)
    },
    'tax:update-class': {
      access: 'settings.edit',
      input: taxClassUpdateSchema,
      handle: (input, { actor }) => pricing.updateTaxClass(actor, input)
    },
    'tax:set-class-active': {
      access: 'settings.edit',
      input: z.object({ taxClassId: z.number().int().positive(), active: z.boolean() }),
      handle: (input, { actor }) => pricing.setTaxClassActive(actor, input)
    },
    // Billing prices bills with these, so everyone signed in may read them.
    'pricing:get-settings': {
      access: 'signed-in',
      input: z.void(),
      handle: () => pricing.getSettings()
    },
    'pricing:update-policy': {
      access: 'settings.edit',
      input: pricingPolicySchema,
      handle: (input, { actor }) => pricing.updatePolicy(actor, input)
    }
  }
}
