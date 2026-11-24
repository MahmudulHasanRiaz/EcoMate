import { describe, it, expect, vi } from 'vitest'
import {
  adoptWarningText,
  pollSyncRun,
  productImageUrls,
  pushableStores,
  pushCountsSummary,
} from './push-utils'
import type { StoreResponse } from './api'

function store(overrides: Partial<StoreResponse>): StoreResponse {
  return {
    id: 's1',
    kind: 'WOOCOMMERCE',
    name: 'Woo',
    status: 'CONNECTED',
    healthState: 'HEALTHY',
    autoSyncEnabled: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as StoreResponse
}

describe('pushableStores (P1 store picker)', () => {
  it('keeps connected non-NATIVE stores only', () => {
    const stores = [
      store({ id: 'woo', kind: 'WOOCOMMERCE', status: 'CONNECTED' }),
      store({ id: 'shop', kind: 'SHOPIFY', status: 'CONNECTED' }),
      store({ id: 'bridge', kind: 'CUSTOM', status: 'CONNECTED' }),
      store({ id: 'native', kind: 'NATIVE', status: 'CONNECTED' }),
      store({ id: 'down', kind: 'WOOCOMMERCE', status: 'DISCONNECTED' }),
      store({ id: 'auth', kind: 'SHOPIFY', status: 'AUTH_FAILED' }),
      store({ id: 'pending', kind: 'WOOCOMMERCE', status: 'PENDING' }),
    ]
    expect(pushableStores(stores).map((s) => s.id)).toEqual(['woo', 'shop', 'bridge'])
  })

  it('returns [] for undefined / empty input', () => {
    expect(pushableStores(undefined)).toEqual([])
    expect(pushableStores([])).toEqual([])
  })
})

describe('productImageUrls (P1 preview)', () => {
  it('resolves string entries and skips blanks', () => {
    expect(productImageUrls({ images: ['/a.jpg', '  ', 'https://cdn/x.png'] })).toEqual([
      '/a.jpg',
      'https://cdn/x.png',
    ])
  })

  it('resolves object entries via url/path/src and ignores junk', () => {
    expect(
      productImageUrls({ images: [{ url: '/u.jpg' }, { path: '/p.jpg' }, { src: '/s.jpg' }, null, 42, {}] as never }),
    ).toEqual(['/u.jpg', '/p.jpg', '/s.jpg'])
  })

  it('returns [] for missing / non-array images', () => {
    expect(productImageUrls(null)).toEqual([])
    expect(productImageUrls({})).toEqual([])
    expect(productImageUrls({ images: '/single.jpg' })).toEqual([])
  })
})

describe('adoptWarningText (BR-05)', () => {
  it('names the store and states the link-instead-of-create behaviour', () => {
    expect(adoptWarningText('Woo Store')).toBe(
      'A product with this SKU already exists in Woo Store — pushing will link to it instead of creating a new one',
    )
  })
})

describe('pushCountsSummary', () => {
  it('formats the four run counts', () => {
    expect(pushCountsSummary({ createdCount: 1, updatedCount: 2, skippedCount: 3, failedCount: 4 })).toBe(
      'Created 1 · Updated 2 · Skipped 3 · Failed 4',
    )
  })
})

describe('pollSyncRun', () => {
  const running = { status: 'RUNNING' } as never
  const success = { status: 'SUCCESS', createdCount: 1, updatedCount: 0, skippedCount: 0, failedCount: 0 } as never

  it('returns the terminal run once it leaves RUNNING', async () => {
    const fetchRun = vi.fn().mockResolvedValueOnce(running).mockResolvedValueOnce(success)
    const res = await pollSyncRun('run-1', { intervalMs: 1, maxAttempts: 5, fetchRun })
    expect(res.run).toBe(success)
    expect(res.timedOut).toBe(false)
    expect(res.cancelled).toBe(false)
    expect(fetchRun).toHaveBeenCalledTimes(2)
  })

  it('times out (not failed) when the run stays RUNNING past the cap', async () => {
    const fetchRun = vi.fn().mockResolvedValue(running)
    const res = await pollSyncRun('run-1', { intervalMs: 1, maxAttempts: 3, fetchRun })
    expect(res.run).toBeNull()
    expect(res.timedOut).toBe(true)
    expect(fetchRun).toHaveBeenCalledTimes(3)
  })

  it('keeps polling through transient fetch failures', async () => {
    const fetchRun = vi.fn().mockRejectedValueOnce(new Error('blip')).mockResolvedValueOnce(success)
    const res = await pollSyncRun('run-1', { intervalMs: 1, maxAttempts: 5, fetchRun })
    expect(res.run).toBe(success)
    expect(res.timedOut).toBe(false)
  })

  it('stops early when cancelled', async () => {
    const fetchRun = vi.fn().mockResolvedValue(running)
    let cancelled = false
    const promise = pollSyncRun('run-1', {
      intervalMs: 5,
      maxAttempts: 30,
      fetchRun,
      isCancelled: () => cancelled,
    })
    // Cancel from the outside while polling is in flight.
    setTimeout(() => { cancelled = true }, 12)
    const res = await promise
    expect(res.cancelled).toBe(true)
    expect(res.run).toBeNull()
    expect(fetchRun.mock.calls.length).toBeLessThan(30)
  })
})
