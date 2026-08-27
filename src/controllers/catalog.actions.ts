'use server'

import { toActionResult } from '@/lib/action-result'
import { requireStoreMembership } from '@/models/store.model'
import {
  catalogIdSchema,
  createCategory,
  updateCategory,
  deleteCategory,
  createProduct,
  updateProduct,
  deleteProduct,
  createOptionGroup,
  updateOptionGroup,
  deleteOptionGroup,
  createOption,
  updateOption,
  deleteOption,
} from '@/models/catalog.model'
import type { CategoryInput, ProductInput, OptionGroupInput, OptionInput } from '@/models/schemas/catalog.schema'
import type { ActionResult } from '@/models/types'

/**
 * ABM de catálogo (panel de admin de un local).
 *
 * La membresía se verifica UNA sola vez por acción, acá — el borde — con
 * `requireStoreMembership`. Antes `createCategory`/`createProduct` la volvían
 * a chequear adentro del modelo (A-04): dos round-trips a Auth por request
 * para el mismo dato, sin necesidad, porque el modelo nunca se llama sin
 * pasar por acá primero.
 *
 * Todo ID que llega del cliente (storeId, categoryId, productId, groupId,
 * optionId) se valida con `catalogIdSchema` antes de usarse: `number` en la
 * firma de TypeScript no impide que un cliente mande un array o un negativo
 * en runtime (S-18). El resto del payload (`Input`) ya lo valida Zod dentro
 * de `catalog.model.ts`.
 */

export async function createCategoryAction(storeId: number, input: CategoryInput): Promise<ActionResult<number>> {
  return toActionResult(
    async () => {
      const store = catalogIdSchema.parse(storeId)
      await requireStoreMembership(store)
      return createCategory(store, input)
    },
    'catalog.createCategory',
    { storeId },
  )
}

export async function updateCategoryAction(
  storeId: number,
  categoryId: number,
  input: Partial<CategoryInput>,
): Promise<ActionResult> {
  return toActionResult(
    async () => {
      const store = catalogIdSchema.parse(storeId)
      const category = catalogIdSchema.parse(categoryId)
      await requireStoreMembership(store)
      await updateCategory(category, input)
    },
    'catalog.updateCategory',
    { storeId },
  )
}

export async function deleteCategoryAction(storeId: number, categoryId: number): Promise<ActionResult> {
  return toActionResult(
    async () => {
      const store = catalogIdSchema.parse(storeId)
      const category = catalogIdSchema.parse(categoryId)
      await requireStoreMembership(store)
      await deleteCategory(category)
    },
    'catalog.deleteCategory',
    { storeId },
  )
}

// ---------------------------------------------------------------------------
// Productos
// ---------------------------------------------------------------------------

export async function createProductAction(storeId: number, input: ProductInput): Promise<ActionResult<number>> {
  return toActionResult(
    async () => {
      const store = catalogIdSchema.parse(storeId)
      await requireStoreMembership(store)
      return createProduct(store, input)
    },
    'catalog.createProduct',
    { storeId },
  )
}

export async function updateProductAction(
  storeId: number,
  productId: number,
  input: Partial<ProductInput>,
): Promise<ActionResult> {
  return toActionResult(
    async () => {
      const store = catalogIdSchema.parse(storeId)
      const product = catalogIdSchema.parse(productId)
      await requireStoreMembership(store)
      await updateProduct(store, product, input)
    },
    'catalog.updateProduct',
    { storeId },
  )
}

export async function deleteProductAction(storeId: number, productId: number): Promise<ActionResult> {
  return toActionResult(
    async () => {
      const store = catalogIdSchema.parse(storeId)
      const product = catalogIdSchema.parse(productId)
      await requireStoreMembership(store)
      await deleteProduct(product)
    },
    'catalog.deleteProduct',
    { storeId },
  )
}

// ---------------------------------------------------------------------------
// Grupos de opciones
// ---------------------------------------------------------------------------

export async function createOptionGroupAction(
  storeId: number,
  productId: number,
  input: OptionGroupInput,
): Promise<ActionResult<number>> {
  return toActionResult(
    async () => {
      const store = catalogIdSchema.parse(storeId)
      const product = catalogIdSchema.parse(productId)
      await requireStoreMembership(store)
      return createOptionGroup(product, input)
    },
    'catalog.createOptionGroup',
    { storeId },
  )
}

export async function updateOptionGroupAction(
  storeId: number,
  groupId: number,
  input: Partial<OptionGroupInput>,
): Promise<ActionResult> {
  return toActionResult(
    async () => {
      const store = catalogIdSchema.parse(storeId)
      const group = catalogIdSchema.parse(groupId)
      await requireStoreMembership(store)
      await updateOptionGroup(group, input)
    },
    'catalog.updateOptionGroup',
    { storeId },
  )
}

export async function deleteOptionGroupAction(storeId: number, groupId: number): Promise<ActionResult> {
  return toActionResult(
    async () => {
      const store = catalogIdSchema.parse(storeId)
      const group = catalogIdSchema.parse(groupId)
      await requireStoreMembership(store)
      await deleteOptionGroup(group)
    },
    'catalog.deleteOptionGroup',
    { storeId },
  )
}

// ---------------------------------------------------------------------------
// Opciones
// ---------------------------------------------------------------------------

export async function createOptionAction(
  storeId: number,
  groupId: number,
  input: OptionInput,
): Promise<ActionResult<number>> {
  return toActionResult(
    async () => {
      const store = catalogIdSchema.parse(storeId)
      const group = catalogIdSchema.parse(groupId)
      await requireStoreMembership(store)
      return createOption(group, input)
    },
    'catalog.createOption',
    { storeId },
  )
}

export async function updateOptionAction(
  storeId: number,
  optionId: number,
  input: Partial<OptionInput>,
): Promise<ActionResult> {
  return toActionResult(
    async () => {
      const store = catalogIdSchema.parse(storeId)
      const option = catalogIdSchema.parse(optionId)
      await requireStoreMembership(store)
      await updateOption(option, input)
    },
    'catalog.updateOption',
    { storeId },
  )
}

export async function deleteOptionAction(storeId: number, optionId: number): Promise<ActionResult> {
  return toActionResult(
    async () => {
      const store = catalogIdSchema.parse(storeId)
      const option = catalogIdSchema.parse(optionId)
      await requireStoreMembership(store)
      await deleteOption(option)
    },
    'catalog.deleteOption',
    { storeId },
  )
}
