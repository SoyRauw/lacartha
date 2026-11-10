import { describe, expect, it } from 'vitest'
import { buildOrderMessage } from './whatsapp'

const base = {
  orderNumber: 'C-123',
  customer: {
    name: 'Ana',
    phone: '0414-0000000',
    fulfillment: 'delivery',
    address: 'Calle 5, casa 3',
  },
  items: [
    {
      product_name: 'Mixta',
      quantity: 1,
      line_total_usd: 3.5,
      options: [{ option_name: 'Dorito' }],
    },
  ],
  totalUsd: 3.5,
  totalBs: 3500,
  rateSource: 'bcv_eur',
  rateValue: 1000,
  notes: 'Sin cebolla',
}

describe('mensaje de pedido', () => {
  it('incluye dirección y delivery por cotizar cuando es delivery', () => {
    const message = buildOrderMessage(base)
    expect(message).toContain('*Entrega:* Delivery')
    expect(message).toContain('*Delivery:* Por cotizar')
    expect(message).toContain('*Dirección:* Calle 5, casa 3')
    expect(message).toContain('*Total productos:*')
    expect(message).toContain('Sin cebolla')
  })

  it('no incluye dirección ni delivery cuando es comer aquí', () => {
    const message = buildOrderMessage({
      ...base,
      customer: { ...base.customer, fulfillment: 'pickup', address: 'Calle 5' },
    })
    expect(message).toContain('*Entrega:* Comer aquí')
    expect(message).not.toContain('*Dirección:*')
    expect(message).not.toContain('*Delivery:*')
  })
})
