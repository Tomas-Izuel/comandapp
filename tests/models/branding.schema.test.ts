import { describe, expect, it } from 'vitest'
import { DEFAULT_BRANDING, brandingSchema } from '@/models/schemas/branding.schema'

/**
 * `brandingSchema` es una superficie de inyección de CSS: estos valores
 * terminan literal dentro de un `<style>`. Cada test acá es, en los hechos,
 * un intento de romper la página de un local.
 */
describe('brandingSchema — hex estricto para colores', () => {
  it('un hex de 6 dígitos válido pasa', () => {
    expect(brandingSchema.safeParse({ color_primary: '#f97316' }).success).toBe(true)
  })

  it('un nombre de color CSS ("red") no es un hex y se rechaza', () => {
    expect(brandingSchema.safeParse({ color_primary: 'red' }).success).toBe(false)
  })

  it('el hex corto de 3 dígitos ("#fff") se rechaza: el schema exige 6', () => {
    expect(brandingSchema.safeParse({ color_primary: '#fff' }).success).toBe(false)
  })

  it('dígitos hex inválidos ("#GGGGGG") se rechazan', () => {
    expect(brandingSchema.safeParse({ color_primary: '#GGGGGG' }).success).toBe(false)
  })

  it('un intento de inyección de CSS disfrazado de color se rechaza entero', () => {
    const payload = '#fff;}body{display:none'
    expect(brandingSchema.safeParse({ color_primary: payload }).success).toBe(false)
  })

  it('sin sufijo "px"/"rem" ni unidades: un valor con texto extra pegado al hex falla', () => {
    expect(brandingSchema.safeParse({ color_background: '#ffffff !important' }).success).toBe(false)
  })
})

describe('brandingSchema — enum cerrado de tipografías', () => {
  it('una fuente del catálogo pasa', () => {
    expect(brandingSchema.safeParse({ font_heading: 'bebas-neue', font_body: 'inter' }).success).toBe(true)
  })

  it('una fuente fuera del catálogo se rechaza: nada de texto libre para font-family', () => {
    expect(brandingSchema.safeParse({ font_body: 'Comic Sans MS' }).success).toBe(false)
  })

  it('font_body no admite las fuentes de heading exclusivas (bebas-neue no es de párrafo)', () => {
    expect(brandingSchema.safeParse({ font_body: 'bebas-neue' }).success).toBe(false)
  })
})

describe('brandingSchema — radius_rem acotado', () => {
  it('un radio dentro de 0..2 pasa', () => {
    expect(brandingSchema.safeParse({ radius_rem: 1.25 }).success).toBe(true)
  })

  it('un radio negativo falla', () => {
    expect(brandingSchema.safeParse({ radius_rem: -0.1 }).success).toBe(false)
  })

  it('un radio absurdamente grande falla', () => {
    expect(brandingSchema.safeParse({ radius_rem: 999 }).success).toBe(false)
  })
})

describe('brandingSchema — URLs de assets: nunca javascript: ni data:', () => {
  it('una URL https válida de Supabase Storage pasa', () => {
    const result = brandingSchema.safeParse({ logo_url: 'https://proyecto.supabase.co/storage/v1/object/public/logo.png' })
    expect(result.success).toBe(true)
  })

  it('http://127.0.0.1 pasa: es el storage local de desarrollo', () => {
    expect(brandingSchema.safeParse({ logo_url: 'http://127.0.0.1:54321/storage/v1/object/public/logo.png' }).success).toBe(true)
  })

  it('javascript: se rechaza: no es https', () => {
    expect(brandingSchema.safeParse({ logo_url: 'javascript:alert(1)' }).success).toBe(false)
  })

  it('data: se rechaza: no es https', () => {
    expect(brandingSchema.safeParse({ hero_image_url: 'data:image/png;base64,aGVsbG8=' }).success).toBe(false)
  })

  it('un http:// que no sea localhost también se rechaza', () => {
    expect(brandingSchema.safeParse({ favicon_url: 'http://evil.example.com/x.ico' }).success).toBe(false)
  })

  it('null es válido: una tienda sin logo todavía', () => {
    expect(brandingSchema.safeParse({ logo_url: null }).success).toBe(true)
  })
})

describe('DEFAULT_BRANDING', () => {
  it('los defaults del schema son, en sí mismos, un branding válido', () => {
    expect(brandingSchema.safeParse(DEFAULT_BRANDING).success).toBe(true)
  })
})
