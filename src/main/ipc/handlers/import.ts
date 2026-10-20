import { z } from 'zod'
import { productImportInputSchema } from '@shared/schemas/import'
import type { ProductImportService } from '../../catalog/productImportService'
import type { HandlerDefinition } from '../serviceHost'

type Channel =
  | 'import:products-template'
  | 'import:products-preview'
  | 'import:products-commit'

export function createImportHandlers(
  imports: ProductImportService
): { [C in Channel]: HandlerDefinition<C> } {
  return {
    'import:products-template': {
      access: 'data.import',
      input: z.void(),
      handle: (_, { actor }) => imports.getTemplate(actor)
    },
    'import:products-preview': {
      access: 'data.import',
      input: productImportInputSchema,
      handle: (input, { actor }) => imports.preview(actor, input)
    },
    'import:products-commit': {
      access: 'data.import',
      input: productImportInputSchema,
      handle: (input, { actor }) => imports.commit(actor, input)
    }
  }
}
