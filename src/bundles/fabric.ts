/**
 * A fabric shop: fabric and trims by the metre, haberdashery by the piece, offcuts at one price.
 *
 * One product per material + colour, counted in metres. Its family is the Sell tile (Fabric or
 * Trims), `variant` the material and `size` the colour, so the two-level picker cold drinks use
 * (brand → size) reads material → colour. Price per metre, smallest cut and roll length belong
 * to the material: every colour carries the same values and they are edited together
 * (updateMaterial). The roll length is the pack size, so Stock came in counts rolls and the
 * Restock list rounds up to whole rolls with no fabric code of its own.
 *
 * Every number is a starting default for the test shop and editable (fabric store spec).
 */
import { buildStarterCatalogue, type StarterPack, type StarterSelection, type Template } from '../data/starterPacks'
import type { CategoryKey, Family } from '../data/types'
import type { Bundle } from '.'
import { withCapabilities } from './capabilities'
import { DEFAULT_CUT_STEP, DEFAULT_MIN_CUT } from './capabilities/lengthSale'
import { OFFCUT_ITEM } from './capabilities/offcuts'

type Material = {
  name: string
  pack: 'fabrics' | 'lining' | 'trims'
  family: Family
  category: CategoryKey
  /** Rand per metre. Guesses, to be set in setup. */
  price: number
  minCut: number
  /** Usual roll length in metres. */
  roll: number
  colours: string[]
}

const STARTER_COLOURS = ['Black', 'White', 'Navy', 'Red']
const fabricMaterial = (name: string, price: number): Material => ({
  name, pack: 'fabrics', family: 'fabric', category: 'fabric', price, minCut: DEFAULT_MIN_CUT, roll: 30, colours: STARTER_COLOURS,
})
const lining = (name: string, price: number): Material => ({
  name, pack: 'lining', family: 'fabric', category: 'lining', price, minCut: DEFAULT_MIN_CUT, roll: 30, colours: ['Black', 'White'],
})
const trim = (name: string, price: number): Material => ({
  name, pack: 'trims', family: 'trims', category: 'trims', price, minCut: 0.1, roll: 25, colours: ['Black', 'White'],
})

export const FABRIC_MATERIALS: Material[] = [
  fabricMaterial('Cotton', 45),
  fabricMaterial('Shweshwe', 95),
  fabricMaterial('African print', 85),
  fabricMaterial('Chiffon', 60),
  fabricMaterial('Satin', 65),
  fabricMaterial('Denim', 110),
  fabricMaterial('Fleece', 150),
  lining('Polyester lining', 25),
  lining('Fusible interfacing', 40),
  trim('Elastic 2.5 cm', 8),
  trim('Lace', 15),
  trim('Ribbon', 5),
  trim('Bias binding', 10),
]

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** "fabric-cotton-navy": stable, so setup answers (prices, unticked colours) can name it. */
export const colourTemplateId = (material: string, colour: string) => `fabric-${slug(material)}-${slug(colour)}`

function colourTemplate(m: Material, colour: string): Template {
  return {
    id: colourTemplateId(m.name, colour),
    name: `${colour} ${m.name}`,
    detail: 'Sold by the metre',
    category: m.category,
    icon: m.family === 'trims' ? 'straighten' : 'texture',
    price: m.price,
    unit: 'm',
    unitPlural: 'm',
    packSize: m.roll,
    packLabel: `roll of ${m.roll}`,
    family: m.family,
    variant: m.name,
    size: colour,
    soldBy: 'length',
    minCut: m.minCut,
    cutStep: DEFAULT_CUT_STEP,
  }
}

const each = (id: string, name: string, price: number): Template => ({
  id: `fabric-${id}`, name, detail: 'Sold by the piece', category: 'notions', icon: 'straighten',
  price, unit: 'item', unitPlural: 'items', packSize: 1, packLabel: 'single item',
})

const HABERDASHERY: Template[] = [
  each('zip-20', 'Zip 20 cm', 10),
  each('buttons', 'Buttons (card)', 15),
  each('thread', 'Thread spool', 12),
  each('needles', 'Needles (pack)', 20),
  each('pins', 'Pins (box)', 25),
  each('tape-measure', 'Tape measure', 40),
]

const coloursOf = (pack: Material['pack']) =>
  FABRIC_MATERIALS.filter((m) => m.pack === pack).flatMap((m) => m.colours.map((c) => colourTemplate(m, c)))

export const FABRIC_PACKS: StarterPack[] = [
  // The Offcuts item comes with fabrics: it is where their short ends go
  { key: 'fabrics', label: 'Fabrics', blurb: 'Cotton, shweshwe, print, denim', icon: 'texture', products: [...coloursOf('fabrics'), OFFCUT_ITEM] },
  { key: 'lining', label: 'Lining and interfacing', blurb: 'Polyester lining, fusible', icon: 'layers', products: coloursOf('lining') },
  { key: 'haberdashery', label: 'Haberdashery', blurb: 'Zips, buttons, thread, needles', icon: 'straighten', products: HABERDASHERY },
  { key: 'trims', label: 'Trims', blurb: 'Elastic, lace, ribbon, binding', icon: 'gesture', products: coloursOf('trims') },
]

/**
 * The starter catalogue: the picked packs, plus any colours added in setup, with each material's
 * price per metre and smallest cut as the owner set them (on every colour of it).
 */
export function fabricCatalogue(sel: StarterSelection) {
  const packs = FABRIC_PACKS.map((pack) => {
    const added = FABRIC_MATERIALS.filter((m) => m.pack === pack.key).flatMap((m) =>
      (sel.colours?.[m.name] ?? []).filter((c) => c.trim() && !m.colours.includes(c.trim())).map((c) => colourTemplate(m, c.trim())),
    )
    return { ...pack, products: [...pack.products, ...added] }
  })
  return buildStarterCatalogue(sel, packs).map((p) => {
    const set = p.soldBy === 'length' && p.variant ? sel.materials?.[p.variant] : undefined
    if (!set) return p
    return {
      ...p,
      ...(set.price !== undefined && Number.isFinite(set.price) && set.price >= 0 ? { price: set.price } : {}),
      ...(set.minCut !== undefined && set.minCut > 0 ? { minCut: set.minCut } : {}),
    }
  })
}

export const fabric: Bundle = {
  key: 'fabric',
  label: 'Fabric store',
  blurb: 'Fabric by the metre, haberdashery, offcuts',
  icon: 'texture',
  categories: [
    { key: 'fabric', label: 'Fabric', icon: 'texture' },
    { key: 'lining', label: 'Lining & interfacing', icon: 'layers' },
    { key: 'trims', label: 'Trims', icon: 'gesture' },
    { key: 'notions', label: 'Haberdashery', icon: 'straighten' },
    { key: 'offcuts', label: 'Offcuts', icon: 'content_cut' },
  ],
  families: [
    { key: 'fabric', label: 'Fabric', icon: 'texture', levels: 2 },
    { key: 'trims', label: 'Trims', icon: 'gesture', levels: 2 },
  ],
  packs: FABRIC_PACKS,
  kotaBuilds: [],
  catalogue: fabricCatalogue,
  commonBrands: () => [],
  ...withCapabilities(['lengthSale', 'offcuts']),
  stock: { lowDays: 14, restockDays: 30 },
}
