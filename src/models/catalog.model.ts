import 'server-only'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireStoreMembership } from '@/models/store.model'
import { DomainError } from '@/lib/errors'
import { serverEnv } from '@/lib/env.server'
import { log } from '@/lib/log'
import { PRODUCT_IMAGES_BUCKET } from '@/lib/storage'
import {
  categoryInputSchema,
  optionGroupInputSchema,
  optionGroupPartialInputSchema,
  optionInputSchema,
  productInputSchema,
  type CategoryInput,
  type OptionGroupInput,
  type OptionInput,
  type ProductInput,
} from '@/models/schemas/catalog.schema'
import type { MenuCategory, MenuOption, MenuOptionGroup, MenuProduct } from '@/models/types'
import type { Database } from '@/lib/supabase/database.types'

const CTX = 'catalog.model'

type CategoryRow = Database['public']['Tables']['categories']['Row']
type ProductRow = Database['public']['Tables']['products']['Row']
type OptionGroupRow = Database['public']['Tables']['option_groups']['Row']
type OptionRow = Database['public']['Tables']['options']['Row']

type OptionGroupTree = OptionGroupRow & { options: OptionRow[] }
type ProductTree = ProductRow & { option_groups: OptionGroupTree[] }
type CategoryTree = CategoryRow & { products: ProductTree[] }

/**
 * Entero positivo: la validación que un `number` de TypeScript no da en
 * runtime. Sin esto, un cliente que manda `categoryId: [1,2]` o `-1` pasa el
 * chequeo de tipos y llega tal cual a la query (S-18). Se exporta para que
 * `catalog.actions.ts` valide los IDs en el borde antes de llamar acá.
 */
export const catalogIdSchema = z.coerce.number().int().positive()

/**
 * Columnas de un producto con sus grupos de opciones y opciones, en un solo
 * lugar. Estaba repetida literal entre el árbol del catálogo y la ficha de
 * producto (A-13): una columna nueva había que agregarla en dos sitios y
 * confiar en que no se desincronizaran.
 */
const PRODUCT_TREE_SELECT = `
  id, category_id, name, description, image_path, price_cents, prep_minutes, is_available, position,
  option_groups (
    id, product_id, name, min_select, max_select, position,
    options ( id, group_id, name, price_delta_cents, is_available, position )
  )
`

const CATALOG_TREE_SELECT = `
  id, store_id, name, position, is_active,
  products (${PRODUCT_TREE_SELECT})
`

function toOption(row: OptionRow): MenuOption {
  return {
    id: row.id,
    name: row.name,
    priceDeltaCents: row.price_delta_cents,
    isAvailable: row.is_available,
    position: row.position,
  }
}

function toOptionGroup(row: OptionGroupTree): MenuOptionGroup {
  return {
    id: row.id,
    name: row.name,
    minSelect: row.min_select,
    maxSelect: row.max_select,
    position: row.position,
    options: row.options.map(toOption),
  }
}

function toProduct(row: ProductTree): MenuProduct {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    description: row.description,
    imagePath: row.image_path,
    imageUrl: productImageUrl(row.image_path),
    priceCents: row.price_cents,
    prepMinutes: row.prep_minutes,
    isAvailable: row.is_available,
    position: row.position,
    optionGroups: row.option_groups.map(toOptionGroup),
  }
}

function toCategory(row: CategoryTree): MenuCategory {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    isActive: row.is_active,
    products: row.products.map(toProduct),
  }
}

/**
 * Trae categorías → productos → grupos de opciones → opciones en UNA query.
 * No filtra `is_active`/`is_available`: eso lo deciden `getMenu` (recorta) y
 * `getAdminCatalog` (no recorta) para no depender de qué combinación de
 * policies de RLS aplique según quién esté logueado.
 */
async function fetchCatalogTree(storeId: number): Promise<CategoryTree[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('categories')
    .select(CATALOG_TREE_SELECT)
    .eq('store_id', storeId)
    // Filtra los productos EMBEBIDOS por su propio store_id, no solo por la
    // categoría a la que dicen pertenecer. Sin esto, un staff que pone el
    // category_id de un producto propio apuntando a una categoría de otra
    // tienda lo hace aparecer en el menú ajeno (S-05): la FK compuesta de
    // Postgres exige que la categoría sea de la MISMA tienda que el producto
    // en el insert/update (ver `assertCategoryBelongsToStore` más abajo), pero
    // esta query es la que decide qué se MUESTRA, y es un embed aparte. Sigue
    // siendo LEFT JOIN (sin `!inner`): una categoría sin productos propios no
    // desaparece, solo queda con el array vacío.
    .eq('products.store_id', storeId)
    .order('position', { ascending: true })
    .order('position', { ascending: true, referencedTable: 'products' })
    .order('position', { ascending: true, referencedTable: 'products.option_groups' })
    .order('position', { ascending: true, referencedTable: 'products.option_groups.options' })

  if (error) throw new Error(`No se pudo leer el catálogo: ${error.message}`)
  return (data ?? []) as unknown as CategoryTree[]
}

/**
 * Productos con `category_id = null`, mismas columnas que el árbol. Existen
 * porque `ON DELETE SET NULL` es lo que le pasa a un producto cuando se borra
 * su categoría (ver `getAdminCatalog`).
 */
async function fetchUncategorizedProducts(storeId: number): Promise<ProductTree[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_TREE_SELECT)
    .eq('store_id', storeId)
    .is('category_id', null)
    .order('position', { ascending: true })
    .order('position', { ascending: true, referencedTable: 'option_groups' })
    .order('position', { ascending: true, referencedTable: 'option_groups.options' })

  if (error) throw new Error(`No se pudieron leer los productos sin categoría: ${error.message}`)
  return (data ?? []) as unknown as ProductTree[]
}

/**
 * ID de la categoría virtual "Sin categoría" que arma `getAdminCatalog`. No es
 * una fila real: 0 nunca lo pisa una categoría de verdad porque `categories.id`
 * es `bigint identity` y arranca en 1.
 */
export const UNCATEGORIZED_CATEGORY_ID = 0

/** Menú público: solo lo que un cliente puede ver y comprar. */
export async function getMenu(storeId: number): Promise<MenuCategory[]> {
  const tree = await fetchCatalogTree(storeId)

  // Un producto AGOTADO se queda en la carta, marcado; una OPCIÓN no
  // disponible se filtra. No es incoherencia, son dos cosas distintas para el
  // que está mirando: que la doble cheddar se acabó es información que quiere
  // ("hoy no, vuelvo mañana"), y una carta que se achica sola cuando se acaba
  // algo se ve pobre y esconde lo que el local realmente vende. En cambio un
  // ingrediente que no está es ruido dentro de una lista que está eligiendo
  // ahora mismo.
  //
  // Antes se filtraban los dos, así que `isAvailable: false` no llegaba nunca
  // a la vista y el estado "Agotado" era código inalcanzable. Agotar desde el
  // panel hacía DESAPARECER el producto, que para el dueño se lee como que lo
  // borró.
  //
  // Pedir un producto agotado igual está frenado del lado del servidor:
  // `priceCart` tira `DomainError` si el producto no está disponible.
  return tree
    .filter((category) => category.is_active)
    .map((category) => ({
      ...category,
      products: category.products.map((product) => ({
        ...product,
        option_groups: product.option_groups.map((group) => ({
          ...group,
          options: group.options.filter((option) => option.is_available),
        })),
      })),
    }))
    .filter((category) => category.products.length > 0)
    .map(toCategory)
}

/**
 * Catálogo completo para el panel de admin: incluye inactivos/no disponibles,
 * y agrega los productos huérfanos (`category_id = null`) en una categoría
 * virtual "Sin categoría" al final.
 *
 * Antes de esto, borrar una categoría dejaba sus productos con
 * `category_id = null` (`ON DELETE SET NULL`) y el árbol se armaba DESDE
 * categorías: el producto no aparecía ni en el menú público ni en el panel de
 * admin. La UI del ABM de categorías promete "quedan sin categoría, no se
 * borran" — sin esto, para el dueño el producto se evaporaba (A-05).
 */
export async function getAdminCatalog(storeId: number): Promise<MenuCategory[]> {
  await requireStoreMembership(storeId)
  const [tree, uncategorized] = await Promise.all([fetchCatalogTree(storeId), fetchUncategorizedProducts(storeId)])

  const categories = tree.map(toCategory)
  if (uncategorized.length === 0) return categories

  return [
    ...categories,
    {
      id: UNCATEGORIZED_CATEGORY_ID,
      name: 'Sin categoría',
      // Al final siempre, sea cual sea el orden de las categorías reales.
      position: Number.MAX_SAFE_INTEGER,
      isActive: true,
      products: uncategorized.map(toProduct),
    },
  ]
}

export async function getProductForStore(storeId: number, productId: number): Promise<MenuProduct | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_TREE_SELECT)
    // Nunca confiar en que el product_id pedido pertenece a esta tienda.
    .eq('store_id', storeId)
    .eq('id', productId)
    .order('position', { referencedTable: 'option_groups', ascending: true })
    .order('position', { referencedTable: 'option_groups.options', ascending: true })
    .maybeSingle()

  if (error) throw new Error(`No se pudo leer el producto: ${error.message}`)
  if (!data) return null
  return toProduct(data as unknown as ProductTree)
}

export function productImageUrl(imagePath: string | null): string | null {
  if (!imagePath) return null
  const { NEXT_PUBLIC_SUPABASE_URL } = serverEnv()
  return `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-images/${imagePath}`
}

// ---------------------------------------------------------------------------
// ABM — todo pasa por RLS (staff de la tienda dueña). La membresía se verifica
// UNA sola vez, en `catalog.actions.ts` (el borde): repetirla acá era A-04.
// Acá solo se valida forma y se traducen errores de Postgres a mensajes
// claros en español.
// ---------------------------------------------------------------------------

type WritableCatalogTable = 'categories' | 'products' | 'option_groups' | 'options'

// El union de 4 tablas hace que TS arme un tipo de Insert/Update combinado
// (RejectExcessProperties de la unión) que ningún Record<string, unknown>
// concreto satisface. El helper es interno y cada caller ya construyó el
// payload a mano con las columnas correctas, así que el `any` acá es seguro.
async function insertReturningId(
  table: WritableCatalogTable,
  payload: Record<string, unknown>,
  errorContext: string,
): Promise<number> {
  const supabase = await createClient()
  // El nombre de tabla es dinámico y los tipos generados no pueden expresar eso.
  // El payload ya es Record<string, unknown>, así que un tipo más estrecho no
  // agregaría seguridad real, solo ruido.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from(table) as any).insert(payload).select('id').single()
  if (error) throw new Error(`${errorContext}: ${error.message}`)
  return (data as { id: number }).id
}

async function updateById(
  table: WritableCatalogTable,
  id: number,
  payload: Record<string, unknown>,
  errorContext: string,
): Promise<void> {
  const supabase = await createClient()
  // Mismo motivo que en insertReturningId.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from(table) as any).update(payload).eq('id', id).select('id')
  if (error) throw new Error(`${errorContext}: ${error.message}`)
  if (!data || (data as unknown[]).length === 0) {
    throw new Error(`${errorContext}: no se encontró o no tenés permiso para modificarlo`)
  }
}

async function deleteById(
  table: WritableCatalogTable,
  id: number,
  errorContext: string,
): Promise<void> {
  const supabase = await createClient()
  const { data, error } = await supabase.from(table).delete().eq('id', id).select('id')
  if (error) throw new Error(`${errorContext}: ${error.message}`)
  if (!data || data.length === 0) {
    throw new Error(`${errorContext}: no se encontró o no tenés permiso para borrarlo`)
  }
}

/**
 * La FK compuesta `products.category_id → categories(store_id, id)` ya
 * rechaza en Postgres una categoría de otra tienda (S-05), pero el error que
 * llega es un `23503` de constraint genérico. Esto adelanta el chequeo con un
 * mensaje que el dueño del local puede entender, antes de tocar la base.
 */
async function assertCategoryBelongsToStore(storeId: number, categoryId: number): Promise<void> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('categories')
    .select('id')
    .eq('id', categoryId)
    .eq('store_id', storeId)
    .maybeSingle()

  if (error) throw new Error(`No se pudo verificar la categoría: ${error.message}`)
  if (!data) {
    throw new DomainError('Esa categoría no existe o no pertenece a esta tienda', { field: 'categoryId' })
  }
}

export async function createCategory(storeId: number, input: CategoryInput): Promise<number> {
  const parsed = categoryInputSchema.parse(input)
  return insertReturningId(
    'categories',
    { store_id: storeId, name: parsed.name, position: parsed.position, is_active: parsed.isActive },
    'No se pudo crear la categoría',
  )
}

export async function updateCategory(categoryId: number, input: Partial<CategoryInput>): Promise<void> {
  const parsed = categoryInputSchema.partial().parse(input)
  const payload: Record<string, unknown> = {}
  if (parsed.name !== undefined) payload.name = parsed.name
  if (parsed.position !== undefined) payload.position = parsed.position
  if (parsed.isActive !== undefined) payload.is_active = parsed.isActive
  await updateById('categories', categoryId, payload, 'No se pudo actualizar la categoría')
}

export async function deleteCategory(categoryId: number): Promise<void> {
  await deleteById('categories', categoryId, 'No se pudo borrar la categoría')
}

export async function createProduct(storeId: number, input: ProductInput): Promise<number> {
  const parsed = productInputSchema.parse(input)
  if (parsed.categoryId !== null) await assertCategoryBelongsToStore(storeId, parsed.categoryId)
  return insertReturningId(
    'products',
    {
      store_id: storeId,
      category_id: parsed.categoryId,
      name: parsed.name,
      description: parsed.description,
      image_path: parsed.imagePath,
      price_cents: parsed.priceCents,
      prep_minutes: parsed.prepMinutes,
      is_available: parsed.isAvailable,
      position: parsed.position,
    },
    'No se pudo crear el producto',
  )
}

/**
 * Recibe `storeId` (no lo necesitaba antes del fix de S-05) para poder
 * verificar que un `categoryId` nuevo siga siendo de esta tienda.
 */
/**
 * Solo el nombre de una categoría de la tienda.
 *
 * La ficha de producto cargaba el MENÚ COMPLETO —categorías, productos, grupos
 * de opciones y opciones— para sacar de ahí una sola cadena de texto. Con un
 * catálogo real eso es un árbol entero por cada vista de producto.
 */
export async function getCategoryName(storeId: number, categoryId: number): Promise<string | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('categories')
    .select('name')
    .eq('store_id', storeId)
    .eq('id', categoryId)
    .maybeSingle()

  if (error) throw new Error(`No se pudo leer la categoría: ${error.message}`)
  return data?.name ?? null
}

export async function updateProduct(storeId: number, productId: number, input: Partial<ProductInput>): Promise<void> {
  const parsed = productInputSchema.partial().parse(input)
  if (parsed.categoryId !== undefined && parsed.categoryId !== null) {
    await assertCategoryBelongsToStore(storeId, parsed.categoryId)
  }
  const payload: Record<string, unknown> = {}
  if (parsed.categoryId !== undefined) payload.category_id = parsed.categoryId
  if (parsed.name !== undefined) payload.name = parsed.name
  if (parsed.description !== undefined) payload.description = parsed.description
  if (parsed.imagePath !== undefined) payload.image_path = parsed.imagePath
  if (parsed.priceCents !== undefined) payload.price_cents = parsed.priceCents
  if (parsed.prepMinutes !== undefined) payload.prep_minutes = parsed.prepMinutes
  if (parsed.isAvailable !== undefined) payload.is_available = parsed.isAvailable
  if (parsed.position !== undefined) payload.position = parsed.position

  // La foto anterior se borra DESPUÉS de que el update confirmó, y solo si de
  // verdad cambió. Antes el campo de imagen la borraba en el momento de
  // elegir la nueva: cancelar el drawer dejaba la fila apuntando a un archivo
  // que ya no existía y la carta mostraba un 404.
  const previousPath =
    parsed.imagePath !== undefined ? await readProductImagePath(storeId, productId) : null

  await updateById('products', productId, payload, 'No se pudo actualizar el producto')

  if (previousPath && previousPath !== parsed.imagePath) {
    await removeProductImage(previousPath)
  }
}

async function readProductImagePath(storeId: number, productId: number): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('products')
    .select('image_path')
    .eq('store_id', storeId)
    .eq('id', productId)
    .maybeSingle()
  return data?.image_path ?? null
}

/**
 * Borra un archivo del bucket de fotos.
 *
 * No propaga el error: una foto huérfana cuesta unos KB, mientras que fallar
 * acá revertiría un cambio de catálogo que el dueño ya vio confirmado.
 */
async function removeProductImage(path: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.storage.from(PRODUCT_IMAGES_BUCKET).remove([path])
  if (error) {
    log.warn(CTX, 'no se pudo borrar la foto reemplazada del producto', { path, error: error.message })
  }
}

export async function deleteProduct(productId: number): Promise<void> {
  await deleteById('products', productId, 'No se pudo borrar el producto')
}

export async function createOptionGroup(productId: number, input: OptionGroupInput): Promise<number> {
  const parsed = optionGroupInputSchema.parse(input)
  return insertReturningId(
    'option_groups',
    {
      product_id: productId,
      name: parsed.name,
      min_select: parsed.minSelect,
      max_select: parsed.maxSelect,
      position: parsed.position,
    },
    'No se pudo crear el grupo de opciones',
  )
}

export async function updateOptionGroup(groupId: number, input: Partial<OptionGroupInput>): Promise<void> {
  const parsed = optionGroupPartialInputSchema.parse(input)
  const payload: Record<string, unknown> = {}
  if (parsed.name !== undefined) payload.name = parsed.name
  if (parsed.minSelect !== undefined) payload.min_select = parsed.minSelect
  if (parsed.maxSelect !== undefined) payload.max_select = parsed.maxSelect
  if (parsed.position !== undefined) payload.position = parsed.position
  await updateById('option_groups', groupId, payload, 'No se pudo actualizar el grupo de opciones')
}

export async function deleteOptionGroup(groupId: number): Promise<void> {
  await deleteById('option_groups', groupId, 'No se pudo borrar el grupo de opciones')
}

export async function createOption(groupId: number, input: OptionInput): Promise<number> {
  const parsed = optionInputSchema.parse(input)
  return insertReturningId(
    'options',
    {
      group_id: groupId,
      name: parsed.name,
      price_delta_cents: parsed.priceDeltaCents,
      is_available: parsed.isAvailable,
      position: parsed.position,
    },
    'No se pudo crear la opción',
  )
}

export async function updateOption(optionId: number, input: Partial<OptionInput>): Promise<void> {
  const parsed = optionInputSchema.partial().parse(input)
  const payload: Record<string, unknown> = {}
  if (parsed.name !== undefined) payload.name = parsed.name
  if (parsed.priceDeltaCents !== undefined) payload.price_delta_cents = parsed.priceDeltaCents
  if (parsed.isAvailable !== undefined) payload.is_available = parsed.isAvailable
  if (parsed.position !== undefined) payload.position = parsed.position
  await updateById('options', optionId, payload, 'No se pudo actualizar la opción')
}

export async function deleteOption(optionId: number): Promise<void> {
  await deleteById('options', optionId, 'No se pudo borrar la opción')
}
