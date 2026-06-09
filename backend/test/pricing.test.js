import { test } from 'node:test'
import assert from 'node:assert/strict'
import { priceForOperator, normalizeOperator, DEFAULT_PUBLIC_PRICE, HOME_PRICE } from '../src/services/pricing.service.js'

test('priceForOperator riconosce i CPO noti (match fuzzy)', () => {
  assert.equal(priceForOperator('Tesla Supercharger Milano'), 0.45)
  assert.equal(priceForOperator('IONITY GmbH'), 0.69)
  assert.equal(priceForOperator('Enel X Way'), 0.59)
  assert.equal(priceForOperator('Free To X'), 0.79)
})

test('priceForOperator usa il prezzo di default per operatori sconosciuti o nulli', () => {
  assert.equal(priceForOperator('Colonnina Sconosciuta SRL'), DEFAULT_PUBLIC_PRICE)
  assert.equal(priceForOperator(null), DEFAULT_PUBLIC_PRICE)
  assert.equal(priceForOperator(''), DEFAULT_PUBLIC_PRICE)
})

test('normalizeOperator restituisce il nome canonico o l’originale', () => {
  assert.equal(normalizeOperator('ionity gmbh'), 'Ionity')
  assert.equal(normalizeOperator('Pinco Pallo Charge'), 'Pinco Pallo Charge')
  assert.equal(normalizeOperator(null), null)
})

test('HOME_PRICE è inferiore al prezzo pubblico (ricarica domestica più economica)', () => {
  assert.ok(HOME_PRICE < DEFAULT_PUBLIC_PRICE)
})
