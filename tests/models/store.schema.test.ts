import { describe, expect, it } from 'vitest'
import { storeSettingsInputSchema } from '@/models/schemas/store.schema'

/**
 * S-01: reactivar/suspender una tienda y cambiar su slug es una decisión de
 * PLATAFORMA, no del local. `storeSettingsInputSchema` es la mitad de esa
 * regla del lado de Zod — la otra mitad son los GRANT revocados en Postgres.
 */
describe('storeSettingsInputSchema — el local no maneja su propio status ni su slug', () => {
  function valid() {
    return {
      name: 'La Birra',
      description: null,
      phoneE164: null,
      whatsappPhoneE164: null,
      address: null,
      timezone: 'America/Argentina/Buenos_Aires',
      currency: 'ARS',
      acceptingOrders: true,
      inStorePaymentEnabled: false,
      minOrderCents: 0,
      demandThresholdOrders: 5,
      demandMultiplier: 1.5,
    }
  }

  it('un input legítimo del panel "Mi local" pasa', () => {
    expect(storeSettingsInputSchema.safeParse(valid()).success).toBe(true)
  })

  it('S-01: si el staff manda status igual, el schema no lo deja pasar al objeto tipado', () => {
    const result = storeSettingsInputSchema.safeParse({ ...valid(), status: 'active' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).not.toHaveProperty('status')
    }
  })

  it('S-01: si el staff manda slug igual, el schema no lo deja pasar al objeto tipado', () => {
    const result = storeSettingsInputSchema.safeParse({ ...valid(), slug: 'secuestro-de-ruta' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).not.toHaveProperty('slug')
    }
  })

  it('demandMultiplier está acotado a 1..10: no hay multiplicador absurdo por error de tipeo', () => {
    expect(storeSettingsInputSchema.safeParse({ ...valid(), demandMultiplier: 0.5 }).success).toBe(false)
    expect(storeSettingsInputSchema.safeParse({ ...valid(), demandMultiplier: 11 }).success).toBe(false)
  })

  it('demandThresholdOrders tiene que ser al menos 1: umbral 0 dispararía el multiplicador siempre', () => {
    expect(storeSettingsInputSchema.safeParse({ ...valid(), demandThresholdOrders: 0 }).success).toBe(false)
  })

  it('minOrderCents no admite negativos', () => {
    expect(storeSettingsInputSchema.safeParse({ ...valid(), minOrderCents: -100 }).success).toBe(false)
  })

  it('un teléfono que no es E.164 falla', () => {
    expect(storeSettingsInputSchema.safeParse({ ...valid(), phoneE164: '011 5555-4444' }).success).toBe(false)
  })

  it('currency tiene que ser un código de 3 letras', () => {
    expect(storeSettingsInputSchema.safeParse({ ...valid(), currency: 'PESOS' }).success).toBe(false)
  })
})
