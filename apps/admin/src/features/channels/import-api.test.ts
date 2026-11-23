import { describe, it, expect } from 'vitest'
import {
  applyCatalogDefaults,
  buildImportPayload,
  defaultRowDecision,
  deriveResultTarget,
  detectProblems,
  formatVariablePriceRange,
  importRunProgress,
  isRowDisabled,
  parseRunItemReason,
  summarizeSelection,
  type RemoteCatalogProduct,
  type RowDecisionMap,
} from './import-api'

function row(overrides: Partial<RemoteCatalogProduct> & { remoteId: string }): RemoteCatalogProduct {
  return {
    name: 'Product',
    type: 'simple',
    status: 'publish',
    ...overrides,
  } as RemoteCatalogProduct
}

const UNMATCHED = row({ remoteId: '1', name: 'Unmatched', sku: 'U-1' })
const MATCHED = row({
  remoteId: '2',
  name: 'Matched',
  sku: 'M-1',
  match: { productId: 'p-2', name: 'Local Matched', sku: 'M-1', kind: 'SKU' },
})
const LINKED = row({
  remoteId: '3',
  name: 'Linked',
  sku: 'L-1',
  alreadyLinked: true,
  linkedProductId: 'p-3',
  linkedProductName: 'Local Linked',
})
const SKIPPED = row({ remoteId: '4', name: 'Skipped', sku: 'S-1', skipped: true, skipNote: 'Test product' })
const UNSUPPORTED = row({ remoteId: '5', name: 'Grouped', type: 'grouped', unsupportedType: true })
const VARIANT_COLLISION = row({
  remoteId: '6',
  name: 'Variable clash',
  type: 'variable',
  variantCount: 3,
  variantSkuCollision: true,
  match: { productId: 'p-6', name: 'Local Variable', sku: 'V-1', kind: 'SKU' },
})

describe('import selection defaults (§3.2)', () => {
  it('unmatched rows are checked with Create-new', () => {
    expect(defaultRowDecision(UNMATCHED)).toEqual({ selected: true, action: 'create' })
  })

  it('matched rows are unchecked with Link-to-suggestion', () => {
    expect(defaultRowDecision(MATCHED)).toEqual({
      selected: false,
      action: 'link',
      linkProductId: 'p-2',
      linkProductName: 'Local Matched',
      linkKind: 'suggestion',
    })
  })

  it('already-linked rows are disabled and unchecked', () => {
    expect(isRowDisabled(LINKED)).toBe(true)
    expect(defaultRowDecision(LINKED).selected).toBe(false)
  })

  it('unsupported types are disabled and unchecked', () => {
    expect(isRowDisabled(UNSUPPORTED)).toBe(true)
    expect(defaultRowDecision(UNSUPPORTED).selected).toBe(false)
  })

  it('skipped rows stay unselected with action skip (already recorded)', () => {
    expect(defaultRowDecision(SKIPPED)).toEqual({ selected: false, action: 'skip', note: 'Test product' })
  })

  it('applyCatalogDefaults never clobbers an existing decision', () => {
    const existing: RowDecisionMap = new Map([
      ['1', { selected: false, action: 'skip', note: 'operator chose' }],
    ])
    const next = applyCatalogDefaults(existing, [UNMATCHED, MATCHED])
    expect(next.get('1')).toEqual({ selected: false, action: 'skip', note: 'operator chose' })
    expect(next.get('2')).toEqual({
      selected: false,
      action: 'link',
      linkProductId: 'p-2',
      linkProductName: 'Local Matched',
      linkKind: 'suggestion',
    })
  })
})

describe('summarizeSelection (review footer)', () => {
  it('counts selected rows by decision across pages', () => {
    const decisions: RowDecisionMap = new Map([
      ['1', { selected: true, action: 'create' }],
      ['2', { selected: true, action: 'link', linkProductId: 'p-2' }],
      ['4', { selected: true, action: 'skip' }],
      ['6', { selected: false, action: 'create' }],
    ])
    const s = summarizeSelection([UNMATCHED, MATCHED, SKIPPED, VARIANT_COLLISION], decisions)
    expect(s.selected).toBe(3)
    expect(s.willCreate).toBe(1)
    expect(s.willLink).toBe(1)
    expect(s.willSkip).toBe(1)
  })

  it('counts matched/unmatched totals for the banner', () => {
    const s = summarizeSelection([UNMATCHED, MATCHED, LINKED, VARIANT_COLLISION], new Map())
    expect(s.matchedTotal).toBe(2)
    expect(s.unmatchedTotal).toBe(1)
  })
})

describe('detectProblems (preview, §2.4)', () => {
  it('a variant-SKU collision on Create-new is a failing problem with a Link fix', () => {
    const decisions: RowDecisionMap = new Map([['6', { selected: true, action: 'create' }]])
    const problems = detectProblems([VARIANT_COLLISION], decisions)
    expect(problems).toHaveLength(1)
    expect(problems[0].kind).toBe('variant-sku-collision')
    expect(problems[0].failing).toBe(true)
    expect(problems[0].switchableToLink).toBe(true)
  })

  it('a duplicate product SKU is a flagged choice, never a problem', () => {
    const decisions: RowDecisionMap = new Map([['2', { selected: true, action: 'create' }]])
    const problems = detectProblems([MATCHED], decisions)
    expect(problems).toHaveLength(1)
    expect(problems[0].kind).toBe('duplicate-product-sku')
    expect(problems[0].failing).toBe(false)
    expect(problems[0].switchableToLink).toBe(true)
  })

  it('a link without a target is a failing problem', () => {
    const decisions: RowDecisionMap = new Map([['1', { selected: true, action: 'link' }]])
    const problems = detectProblems([UNMATCHED], decisions)
    expect(problems).toHaveLength(1)
    expect(problems[0].kind).toBe('link-without-target')
    expect(problems[0].failing).toBe(true)
  })

  it('unselected rows never produce problems', () => {
    const decisions: RowDecisionMap = new Map([['6', { selected: false, action: 'create' }]])
    expect(detectProblems([VARIANT_COLLISION], decisions)).toHaveLength(0)
  })
})

describe('buildImportPayload (confirm, §2.5)', () => {
  const rowsById = new Map<string, RemoteCatalogProduct>([
    ['1', UNMATCHED],
    ['2', MATCHED],
    ['4', SKIPPED],
  ])

  it('assembles decisions + publish mode + category mode + stock tick + skip-images + idempotency key', () => {
    const decisions: RowDecisionMap = new Map([
      ['1', { selected: true, action: 'create' }],
      ['2', { selected: true, action: 'link', linkProductId: 'p-2', linkProductName: 'Local Matched', linkKind: 'suggestion' }],
      ['4', { selected: true, action: 'skip', note: 'Never import' }],
    ])
    const body = buildImportPayload(
      rowsById,
      decisions,
      { publishMode: 'draft', categoryMode: 'with_categories', stockTick: true, skipImages: false },
      'key-1',
    )
    expect(body).toEqual({
      decisions: [
        { remoteId: '1', action: 'create' },
        { remoteId: '2', action: 'link', productId: 'p-2' },
        { remoteId: '4', action: 'skip', note: 'Never import' },
      ],
      publishMode: 'draft',
      categoryMode: 'with_categories',
      stockTick: true,
      skipImages: false,
      idempotencyKey: 'key-1',
    })
  })

  it('assign_one carries the category id; other modes omit it', () => {
    const decisions: RowDecisionMap = new Map([['1', { selected: true, action: 'create' }]])
    const body = buildImportPayload(
      rowsById,
      decisions,
      { publishMode: 'active', categoryMode: 'assign_one', categoryId: 'cat-9', stockTick: false, skipImages: true },
      'key-2',
    )
    expect(body.categoryMode).toBe('assign_one')
    expect(body.categoryId).toBe('cat-9')
    expect(body.publishMode).toBe('active')
    expect(body.stockTick).toBe(false)
    expect(body.skipImages).toBe(true)
  })

  it('fails closed: assign_one without a category throws', () => {
    const decisions: RowDecisionMap = new Map([['1', { selected: true, action: 'create' }]])
    expect(() =>
      buildImportPayload(rowsById, decisions, { publishMode: 'draft', categoryMode: 'assign_one', stockTick: true, skipImages: false }, 'k'),
    ).toThrow(/Pick a category/)
  })

  it('fails closed: a link without a target throws naming the product', () => {
    const decisions: RowDecisionMap = new Map([['1', { selected: true, action: 'link' }]])
    expect(() =>
      buildImportPayload(rowsById, decisions, { publishMode: 'draft', categoryMode: 'none', stockTick: true, skipImages: false }, 'k'),
    ).toThrow(/Unmatched.*no EcoMate product is picked/)
  })

  it('unselected rows never become decisions', () => {
    const decisions: RowDecisionMap = new Map([
      ['1', { selected: false, action: 'create' }],
      ['2', { selected: true, action: 'create' }],
    ])
    const body = buildImportPayload(
      rowsById,
      decisions,
      { publishMode: 'draft', categoryMode: 'none', stockTick: true, skipImages: false },
      'k',
    )
    expect(body.decisions).toEqual([{ remoteId: '2', action: 'create' }])
  })
})

describe('parseRunItemReason (§10.4 reason-prefix contract)', () => {
  it.each([
    ['LINKED', 'LINKED', undefined],
    ['CREATED', 'CREATED', undefined],
    // D-5: suffixed reasons parse by prefix, suffix kept as the code.
    ['LINKED:DRAFT_NO_ASSIGNMENT', 'LINKED', 'DRAFT_NO_ASSIGNMENT'],
    ['CREATED:IMAGE_LIMIT', 'CREATED', 'IMAGE_LIMIT'],
    // D-5: bare REMOTE_DELETED (and its SKIPPED: form) is a skip with an explanation.
    ['REMOTE_DELETED', 'SKIPPED_REMOTE_DELETED', 'REMOTE_DELETED'],
    ['SKIPPED:REMOTE_DELETED', 'SKIPPED_REMOTE_DELETED', 'REMOTE_DELETED'],
    ['SKIPPED:DECISION', 'SKIPPED_DECISION', 'DECISION'],
    ['SKIPPED:ALREADY_LINKED', 'SKIPPED_ALREADY_LINKED', 'ALREADY_LINKED'],
    ['SKIPPED:UNSUPPORTED_TYPE', 'SKIPPED_UNSUPPORTED_TYPE', 'UNSUPPORTED_TYPE'],
    ['SKIPPED:IMAGE_LIMIT', 'SKIPPED_IMAGE_LIMIT', 'IMAGE_LIMIT'],
    ['FAILED:VARIANT_SKU_COLLISION', 'FAILED', 'VARIANT_SKU_COLLISION'],
    ['FAILED:QUOTA', 'FAILED', 'QUOTA'],
  ])('%s → %s', (reason, kind, code) => {
    expect(parseRunItemReason(reason)).toEqual({ kind, code })
  })

  it('unknown and empty reasons are OTHER', () => {
    expect(parseRunItemReason(null).kind).toBe('OTHER')
    expect(parseRunItemReason('SOMETHING_ELSE').kind).toBe('OTHER')
  })
})

describe('deriveResultTarget (R6 deep-link)', () => {
  const run = (created: number, updated: number) =>
    ({ createdCount: created, updatedCount: updated, skippedCount: 0, failedCount: 0 } as never)
  const items = [
    { status: 'SUCCESS', productId: 'prod-1', reason: 'CREATED' },
    { status: 'SUCCESS', productId: 'prod-2', reason: 'LINKED' },
  ] as never[]

  it('exactly one created/linked product deep-links to its view page', () => {
    expect(deriveResultTarget(run(1, 0), items, 'draft')).toEqual({ kind: 'product', productId: 'prod-1' })
    expect(deriveResultTarget(run(0, 1), items, 'active')).toEqual({ kind: 'product', productId: 'prod-1' })
  })

  it('D-5: suffixed reasons still deep-link (R6) — single draft link / >10-image create', () => {
    const draftLink = [{ status: 'SUCCESS', productId: 'prod-9', reason: 'LINKED:DRAFT_NO_ASSIGNMENT' }] as never[]
    expect(deriveResultTarget(run(0, 1), draftLink, 'active')).toEqual({ kind: 'product', productId: 'prod-9' })
    const imageLimit = [{ status: 'SUCCESS', productId: 'prod-8', reason: 'CREATED:IMAGE_LIMIT' }] as never[]
    expect(deriveResultTarget(run(1, 0), imageLimit, 'draft')).toEqual({ kind: 'product', productId: 'prod-8' })
  })

  it('multiple imports go to the Drafts tab when draft, products list when active', () => {
    expect(deriveResultTarget(run(1, 1), items, 'draft')).toEqual({ kind: 'drafts' })
    expect(deriveResultTarget(run(2, 0), items, 'active')).toEqual({ kind: 'products' })
  })

  it('zero created/linked has no product target (empty-run honesty)', () => {
    expect(deriveResultTarget(run(0, 0), [], 'draft')).toEqual({ kind: 'none' })
  })

  it('falls back to the list when the single item carries no product id', () => {
    expect(deriveResultTarget(run(1, 0), [], 'draft')).toEqual({ kind: 'drafts' })
  })
})

describe('importRunProgress (§2.6)', () => {
  it('computes processed/total/pct from the run counters', () => {
    const run = {
      createdCount: 3, updatedCount: 1, skippedCount: 1, failedCount: 1, totalCount: 10,
    } as never
    expect(importRunProgress(run)).toEqual({ processed: 6, total: 10, pct: 60 })
  })

  it('stays honest (pct null) when the total is still unknown', () => {
    const run = {
      createdCount: 0, updatedCount: 0, skippedCount: 0, failedCount: 0, totalCount: 0,
    } as never
    expect(importRunProgress(run)).toEqual({ processed: 0, total: 0, pct: null })
  })
})

describe('formatVariablePriceRange (D-2/D-3)', () => {
  const variable = (priceMin?: number | string | null, priceMax?: number | string | null) =>
    row({ remoteId: 'v', type: 'variable', priceMin, priceMax })

  it('shows a single price when max is absent (the v1 case — never "min – min")', () => {
    expect(formatVariablePriceRange(variable(200, null))).toBe('৳200.00')
    expect(formatVariablePriceRange(variable('200', undefined))).toBe('৳200.00')
  })

  it('shows a single price when only max exists', () => {
    expect(formatVariablePriceRange(variable(null, 350))).toBe('৳350.00')
  })

  it('shows a range only when both ends exist', () => {
    expect(formatVariablePriceRange(variable(200, 350))).toBe('৳200.00 – ৳350.00')
  })

  it('shows a dash when neither end exists', () => {
    expect(formatVariablePriceRange(variable(null, null))).toBe('—')
  })
})
