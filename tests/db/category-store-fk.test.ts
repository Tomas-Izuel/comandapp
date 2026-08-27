import { describe, expect, it } from 'vitest'
import { dbAvailable, expectSqlToFail, inTransaction, uniqueSlug } from './helpers'

/**
 * S-05 — FK compuesta categoría/tienda.
 *
 * La policy de staff solo validaba `is_store_member(store_id)` del PRODUCTO,
 * nunca que la categoría fuera de la MISMA tienda: `update products set
 * category_id = <categoría de otra tienda>` pasaba (verificado: 1 fila). El
 * menú público arma la vitrina agrupando por `category_id`, así que el
 * producto aparecía en el local ajeno con su foto y su precio — defacement,
 * no una falla de cobro (`priceCart` lo rechazaba igual al comprar).
 *
 * `products_category_same_store_fkey` es una FK compuesta contra
 * `(store_id, id)` de `categories`, así que una categoría de otra tienda
 * rebota directo en la base.
 */
describe.skipIf(!dbAvailable)('products_category_same_store_fkey', () => {
  function twoStoresWithProduct() {
    return [
      `insert into public.stores (slug, name, status) values ('${uniqueSlug('s05-a')}', 'Tienda A', 'active') returning id \\gset store_a_`,
      `insert into public.stores (slug, name, status) values ('${uniqueSlug('s05-b')}', 'Tienda B', 'active') returning id \\gset store_b_`,
      `insert into public.categories (store_id, name) values (:store_b_id, 'Categoría de B') returning id \\gset cat_b_`,
      `insert into public.products (store_id, name, price_cents) values (:store_a_id, 'Producto de A', 1000) returning id \\gset product_a_`,
    ]
  }

  it('un producto no puede apuntar a una categoría de otra tienda', () => {
    expectSqlToFail(
      [
        ...twoStoresWithProduct(),
        `update public.products set category_id = :cat_b_id where id = :product_a_id;`,
      ].join('\n'),
      /products_category_same_store_fkey/,
    )
  })

  it('borrar una categoría propia anula category_id de sus productos y NO borra los productos', () => {
    const out = inTransaction(
      `insert into public.stores (slug, name, status) values ('${uniqueSlug('s05-c')}', 'Tienda C', 'active') returning id \\gset store_`,
      `insert into public.categories (store_id, name) values (:store_id, 'Hamburguesas') returning id \\gset cat_`,
      `insert into public.products (store_id, category_id, name, price_cents) values (:store_id, :cat_id, 'Clásica', 1500) returning id \\gset product_`,
      `delete from public.categories where id = :cat_id;`,
      `select category_id is null, name from public.products where id = :product_id;`,
    )
    // "t" (category_id quedó null) y el nombre del producto, que sobrevivió al delete.
    expect(out).toBe('t|Clásica')
  })
})
