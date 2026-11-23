/**
 * Barcodes on products: what a code is, and which product it scans as. No React, no storage.
 *
 * Every code is stored and looked up in one form, so the same can matches however it was read:
 *   UPC-A (12 digits)  -> 13 digits with a leading 0, which is how iOS already reports it as EAN-13
 *   EAN-13             -> as is
 *   GTIN-14 (cartons)  -> 13 digits when it starts with 0 (it is then the EAN-13), else as is
 *   EAN-8 / UPC-E      -> as is (8 digits)
 */
import type { Barcode, Product } from './types'

export type BarcodeCheck = { ok: true; code: string } | { ok: false; message: string }

export const NOT_NUMBERS_MESSAGE = 'A product barcode is numbers only.'
export const WRONG_LENGTH_MESSAGE = "That isn't a product barcode. They have 8, 12 or 13 numbers."
export const BAD_CHECK_MESSAGE = 'That barcode has a number wrong. Check it and try again.'

/** GS1 check digit: weights 3,1,3,1… from the right, over every digit but the last. Works for 8, 12, 13 and 14. */
function checkDigitOk(d: string): boolean {
  let sum = 0
  for (let i = d.length - 2, w = 3; i >= 0; i--, w = 4 - w) sum += Number(d[i]) * w
  return (10 - (sum % 10)) % 10 === Number(d[d.length - 1])
}

/** UPC-E (8 digits) written out as the UPC-A it stands for, only to test its check digit. */
function upcEtoA(e: string): string {
  const m = e.slice(1, 7)
  const last = m[5]
  const body =
    last <= '2' ? m.slice(0, 2) + last + '0000' + m.slice(2, 5)
    : last === '3' ? m.slice(0, 3) + '00000' + m.slice(3, 5)
    : last === '4' ? m.slice(0, 4) + '00000' + m[4]
    : m.slice(0, 5) + '0000' + last
  return e[0] + body + e[7]
}

/**
 * The stored form of a code from the camera, a handheld scanner or the owner's typing, or why it
 * can't be one. Spaces are dropped (typed codes are often grouped "6 001234 567890").
 *
 * shortcut: UPC-E stays 8 digits, matching the camera and handhelds' default; a handheld set to
 * expand UPC-E to UPC-A would not match it. Expand both sides here if a shop ever hits that.
 */
export function normalizeBarcode(raw: string): BarcodeCheck {
  const d = raw.replace(/\s+/g, '')
  if (!/^\d+$/.test(d)) return { ok: false, message: NOT_NUMBERS_MESSAGE }
  if (d.length === 8) {
    const valid = checkDigitOk(d) || (/^[01]/.test(d) && checkDigitOk(upcEtoA(d)))
    return valid ? { ok: true, code: d } : { ok: false, message: BAD_CHECK_MESSAGE }
  }
  if (d.length < 12 || d.length > 14) return { ok: false, message: WRONG_LENGTH_MESSAGE }
  if (!checkDigitOk(d)) return { ok: false, message: BAD_CHECK_MESSAGE }
  const gtin = d.padStart(14, '0')
  return { ok: true, code: gtin[0] === '0' ? gtin.slice(1) : gtin }
}

export type BarcodeHit = { product: Product; pack: boolean }

/** Code -> product, from the products already in memory. Build once per products change, look up per scan. */
export function barcodeIndex(products: Product[]): Map<string, BarcodeHit> {
  const map = new Map<string, BarcodeHit>()
  for (const product of products) for (const b of product.barcodes ?? []) map.set(b.code, { product, pack: b.pack })
  return map
}

/** The product with these codes; no codes drops the field, so product meta stays as it was before barcodes. */
export function withBarcodes(p: Product, barcodes: Barcode[]): Product {
  if (barcodes.length) return { ...p, barcodes }
  const { barcodes: _gone, ...rest } = p
  return rest
}
