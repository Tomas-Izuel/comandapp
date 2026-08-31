import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Ver hmac.test.ts: `server-only` tira salvo que se resuelva la condición
// `react-server`, que Vitest no setea. Se noopea acá, no en la config.
vi.mock('server-only', () => ({}))

/**
 * `src/services/bank-validation/` — el puerto opcional de contraste de
 * titular. La invariante que importa NO es "devuelve el nombre correcto": es
 * que (a) sin proveedor configurado el sistema funciona ENTERO (adapter
 * manual, D0/D7) y (b) cualquier falla del proveedor —timeout, JSON roto,
 * forma inesperada— se traduce a `null`, nunca se propaga. Un adapter que
 * tira rompería la carga del formulario de `/admin/pagos` por un proveedor
 * externo que ni siquiera está contratado.
 */
const originalEnv = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  process.env = { ...originalEnv }
  delete process.env.BANK_VALIDATION_PROVIDER
  delete process.env.CERTISEND_API_URL
  delete process.env.CERTISEND_TOKEN_SUSC
  delete process.env.CERTISEND_TOKEN_API
})

afterEach(() => {
  process.env = { ...originalEnv }
  vi.unstubAllGlobals()
})

describe('manual.adapter — el no-op que queda configurado por defecto', () => {
  it('lookupByCbu y lookupByAlias devuelven null siempre', async () => {
    const { createManualBankAccountValidator } = await import('@/services/bank-validation/manual.adapter')
    const validator = createManualBankAccountValidator()

    expect(await validator.lookupByCbu('0070325120000003733248')).toBeNull()
    expect(await validator.lookupByAlias('la.birra.pagos')).toBeNull()
  })
})

describe('getBankAccountValidator — fábrica por env, default "manual"', () => {
  it('sin BANK_VALIDATION_PROVIDER configurado, devuelve el adapter manual (los dos métodos dan null)', async () => {
    const { getBankAccountValidator } = await import('@/services/bank-validation')
    const validator = getBankAccountValidator()

    expect(await validator.lookupByCbu('0070325120000003733248')).toBeNull()
  })

  it('hasBankAccountValidator() es false sin proveedor configurado — el panel no muestra el botón de contraste', async () => {
    const { hasBankAccountValidator } = await import('@/services/bank-validation')
    expect(hasBankAccountValidator()).toBe(false)
  })

  it('hasBankAccountValidator() sigue false con BANK_VALIDATION_PROVIDER=certisend pero SIN las credenciales', async () => {
    process.env.BANK_VALIDATION_PROVIDER = 'certisend'
    const { hasBankAccountValidator } = await import('@/services/bank-validation')
    expect(hasBankAccountValidator()).toBe(false)
  })

  it('hasBankAccountValidator() es true con el provider Y las tres credenciales presentes', async () => {
    process.env.BANK_VALIDATION_PROVIDER = 'certisend'
    process.env.CERTISEND_API_URL = 'https://example.test/api'
    process.env.CERTISEND_TOKEN_SUSC = 'susc'
    process.env.CERTISEND_TOKEN_API = 'api'
    const { hasBankAccountValidator } = await import('@/services/bank-validation')
    expect(hasBankAccountValidator()).toBe(true)
  })
})

describe('certisend.adapter — nunca tira hacia arriba, cualquiera sea el fallo', () => {
  async function freshAdapter() {
    const { createCertisendBankAccountValidator } = await import('@/services/bank-validation/certisend.adapter')
    return createCertisendBankAccountValidator()
  }

  it('sin credenciales configuradas, devuelve null sin llamar a fetch', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const validator = await freshAdapter()
    expect(await validator.lookupByCbu('0070325120000003733248')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  function withCreds() {
    process.env.CERTISEND_API_URL = 'https://example.test/api'
    process.env.CERTISEND_TOKEN_SUSC = 'susc'
    process.env.CERTISEND_TOKEN_API = 'api'
  }

  it('fetch que rechaza (timeout/red caída) → null, no propaga', async () => {
    withCreds()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('timeout')),
    )

    const validator = await freshAdapter()
    await expect(validator.lookupByCbu('0070325120000003733248')).resolves.toBeNull()
  })

  it('respuesta HTTP no-ok (4xx/5xx) → null', async () => {
    withCreds()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))

    const validator = await freshAdapter()
    await expect(validator.lookupByCbu('0070325120000003733248')).resolves.toBeNull()
  })

  it('JSON inválido (el body no parsea) → null', async () => {
    withCreds()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token')
        },
      }),
    )

    const validator = await freshAdapter()
    await expect(validator.lookupByCbu('0070325120000003733248')).resolves.toBeNull()
  })

  it('forma de respuesta inesperada (no matchea el schema Zod) → null', async () => {
    withCreds()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ titular: { nombre: 42 } }) }),
    )

    const validator = await freshAdapter()
    await expect(validator.lookupByCbu('0070325120000003733248')).resolves.toBeNull()
  })

  it('"ALIAS ENCONTRADO" ausente en respuesta.descripcion → null (no se encontró la cuenta)', async () => {
    withCreds()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ respuesta: { descripcion: 'NO ENCONTRADO' } }),
      }),
    )

    const validator = await freshAdapter()
    await expect(validator.lookupByCbu('0070325120000003733248')).resolves.toBeNull()
  })

  it('respuesta válida con "ALIAS ENCONTRADO" resuelve el lookup, mapeando cbu/holderName/holderTaxId', async () => {
    withCreds()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          titular: { nombre: 'JOHN DOE', cuit: '20111111112' },
          cuenta: { nro_cbu: '0070325120000003733248', estado: 'ACTIVA' },
          respuesta: { descripcion: 'ALIAS ENCONTRADO' },
        }),
      }),
    )

    const validator = await freshAdapter()
    const result = await validator.lookupByCbu('0070325120000003733248')

    expect(result).toEqual({
      cbu: '0070325120000003733248',
      alias: null,
      holderName: 'JOHN DOE',
      holderTaxId: '20111111112',
      bankCode: null,
      accountStatus: 'ACTIVA',
    })
  })
})
