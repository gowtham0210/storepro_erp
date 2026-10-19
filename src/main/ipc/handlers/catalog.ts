import { z } from 'zod'
import {
  categoryName,
  idSchemas,
  newProductSchema,
  newVariantSchema,
  productListFilterSchema,
  productSearchSchema,
  productUpdateSchema,
  unitCode,
  unitName,
  variantUpdateSchema
} from '@shared/schemas/catalog'
import type { CatalogService } from '../../catalog/catalogService'
import type { ProductService } from '../../catalog/productService'
import type { HandlerDefinition } from '../serviceHost'

type Channel =
  | 'catalog:list-categories'
  | 'catalog:create-category'
  | 'catalog:rename-category'
  | 'catalog:set-category-active'
  | 'catalog:list-units'
  | 'catalog:create-unit'
  | 'catalog:rename-unit'
  | 'tax:list-classes'
  | 'products:list'
  | 'products:get'
  | 'products:create'
  | 'products:update'
  | 'products:add-variant'
  | 'products:update-variant'
  | 'products:set-active'
  | 'products:set-variant-active'
  | 'products:find-by-barcode'
  | 'products:search'

export function createCatalogHandlers(
  catalog: CatalogService,
  products: ProductService
): { [C in Channel]: HandlerDefinition<C> } {
  return {
    'catalog:list-categories': {
      access: 'product.view',
      input: z.void(),
      handle: (_, { actor }) => catalog.listCategories(actor)
    },
    'catalog:create-category': {
      access: 'product.manage',
      input: z.object({ name: categoryName }),
      handle: (input, { actor }) => catalog.createCategory(actor, input)
    },
    'catalog:rename-category': {
      access: 'product.manage',
      input: idSchemas.category,
      handle: (input, { actor }) => catalog.renameCategory(actor, input)
    },
    'catalog:set-category-active': {
      access: 'product.manage',
      input: idSchemas.categoryActive,
      handle: (input, { actor }) => catalog.setCategoryActive(actor, input)
    },
    'catalog:list-units': {
      access: 'product.view',
      input: z.void(),
      handle: (_, { actor }) => catalog.listUnits(actor)
    },
    'catalog:create-unit': {
      access: 'product.manage',
      input: z.object({ unitCode, name: unitName, allowsFraction: z.boolean() }),
      handle: (input, { actor }) => catalog.createUnit(actor, input)
    },
    'catalog:rename-unit': {
      access: 'product.manage',
      input: z.object({ unitCode: z.string().min(1).max(12), name: unitName }),
      handle: (input, { actor }) => catalog.renameUnit(actor, input)
    },
    // The product form offers the tax rates, so viewing products is enough.
    'tax:list-classes': {
      access: 'product.view',
      input: z.void(),
      handle: (_, { actor }) => catalog.listTaxClasses(actor)
    },
    'products:list': {
      access: 'product.view',
      input: productListFilterSchema,
      handle: (input, { actor }) => products.list(actor, input)
    },
    'products:get': {
      access: 'product.view',
      input: idSchemas.product,
      handle: (input, { actor }) => products.get(actor, input)
    },
    'products:create': {
      access: 'product.manage',
      input: newProductSchema,
      handle: (input, { actor }) => products.create(actor, input)
    },
    'products:update': {
      access: 'product.manage',
      input: productUpdateSchema,
      handle: (input, { actor }) => products.update(actor, input)
    },
    'products:add-variant': {
      access: 'product.manage',
      input: newVariantSchema,
      handle: (input, { actor }) => products.addVariant(actor, input)
    },
    'products:update-variant': {
      access: 'product.manage',
      input: variantUpdateSchema,
      handle: (input, { actor }) => products.updateVariant(actor, input)
    },
    'products:set-active': {
      access: 'product.manage',
      input: idSchemas.productActive,
      handle: (input, { actor }) => products.setActive(actor, input)
    },
    'products:set-variant-active': {
      access: 'product.manage',
      input: idSchemas.variantActive,
      handle: (input, { actor }) => products.setVariantActive(actor, input)
    },
    // Billing looks items up with these (M11), so cashiers can use them.
    'products:find-by-barcode': {
      access: 'product.view',
      input: z.object({ barcode: z.string().max(200) }),
      handle: (input, { actor }) => products.findByBarcode(actor, input)
    },
    'products:search': {
      access: 'product.view',
      input: productSearchSchema,
      handle: (input, { actor }) => products.search(actor, input)
    }
  }
}
