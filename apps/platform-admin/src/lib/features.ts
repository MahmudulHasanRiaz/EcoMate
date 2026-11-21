import { readJson } from './api';
import type {
  BulkKindResult,
  ConvertFeatureResult,
  FeatureDetail,
  FeatureKind,
  FeatureSummary,
} from '../types';

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

export function featuresQueryString(filters: {
  kind?: FeatureKind | '';
  category?: string;
  search?: string;
}): string {
  const params = new URLSearchParams();
  if (filters.kind) params.set('kind', filters.kind);
  if (filters.category) params.set('category', filters.category);
  if (filters.search?.trim()) params.set('search', filters.search.trim());
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function fetchFeatures(
  api: ApiFetch,
  filters: {
    kind?: FeatureKind | '';
    category?: string;
    search?: string;
  } = {},
): Promise<FeatureSummary[]> {
  return api(`/features${featuresQueryString(filters)}`).then((r) =>
    readJson<FeatureSummary[]>(r),
  );
}

export function fetchFeatureDetail(
  api: ApiFetch,
  key: string,
): Promise<FeatureDetail> {
  return api(`/features/${encodeURIComponent(key)}`).then((r) =>
    readJson<FeatureDetail>(r),
  );
}

export function updateFeature(
  api: ApiFetch,
  key: string,
  patch: { kind?: FeatureKind; scope?: string; withoutAccess?: string },
): Promise<FeatureSummary> {
  return api(`/features/${encodeURIComponent(key)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  }).then((r) => readJson<FeatureSummary>(r));
}

export function bulkKind(
  api: ApiFetch,
  keys: string[],
  kind: FeatureKind,
): Promise<BulkKindResult> {
  return api('/features/bulk-kind', {
    method: 'POST',
    body: JSON.stringify({ keys, kind }),
  }).then((r) => readJson<BulkKindResult>(r));
}

export function convertFeature(
  api: ApiFetch,
  key: string,
  body: { price: number; name?: string; description?: string; dryRun: boolean },
): Promise<ConvertFeatureResult> {
  return api(`/features/${encodeURIComponent(key)}/convert-to-addon`, {
    method: 'POST',
    body: JSON.stringify(body),
  }).then((r) => readJson<ConvertFeatureResult>(r));
}

/** Badge tone for a kind: add-on is the indigo accent, initial is inert grey. */
export function kindBadgeTone(kind: FeatureKind): string {
  return kind === 'add-on' ? 'accent' : 'neutral';
}

export function kindLabel(kind: FeatureKind): string {
  return kind === 'add-on' ? 'Add-on' : 'Initial';
}

/** Group features by their A–O category, categories in catalogue order. */
export function groupFeaturesByCategory(
  features: FeatureSummary[],
): Array<{ category: string; features: FeatureSummary[] }> {
  const groups = new Map<string, FeatureSummary[]>();
  for (const feature of features) {
    const list = groups.get(feature.category) ?? [];
    list.push(feature);
    groups.set(feature.category, list);
  }
  return [...groups.entries()]
    .map(([category, list]) => ({ category, features: list }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

/** Client-side filter for the picker + list (search matches key/name). */
export function filterFeatures(
  features: FeatureSummary[],
  filters: { search?: string; kind?: FeatureKind | ''; category?: string },
): FeatureSummary[] {
  const search = filters.search?.trim().toLowerCase();
  return features.filter((feature) => {
    if (filters.kind && feature.kind !== filters.kind) return false;
    if (filters.category && feature.category !== filters.category) {
      return false;
    }
    if (search) {
      const haystack =
        `${feature.key} ${feature.name} ${feature.description ?? ''}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

/**
 * Keys in a saved selection that are NOT catalogue features (the '*'
 * wildcard, or legacy keys typed before validation). The picker shows
 * them as removable chips so a save never silently drops them.
 */
export function unknownFeatureKeys(
  selected: string[],
  catalogue: FeatureSummary[],
): string[] {
  const known = new Set(catalogue.map((feature) => feature.key));
  return selected.filter((key) => !known.has(key));
}
