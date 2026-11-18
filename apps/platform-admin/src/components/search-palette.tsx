import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  BadgeCheck,
  Building,
  Clock,
  CornerDownLeft,
  CreditCard,
  FileText,
  Globe,
  Layers,
  LayoutTemplate,
  Mail,
  Receipt,
  RefreshCw,
  ScrollText,
  Search as SearchIcon,
  Ticket,
  UserPlus,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../auth';
import { errorMessage, readJson } from '../lib/api';
import {
  buildSearchUrl,
  clearRecentSearches,
  flattenGroups,
  getRecentSearches,
  MIN_SEARCH_LENGTH,
  parseConsoleLink,
  saveRecentSearch,
  SEARCH_TYPES,
  TYPE_STATUSES,
  type SearchGroup,
  type SearchResultItem,
} from '../lib/search';
import { formatStatus } from '../lib/format';
import { ScrollableTabs } from './ui';

/**
 * Global search palette (Cmd/Ctrl+K). Server-backed: every keystroke
 * debounces 250ms into GET /search. Grouped results, type filter chips,
 * a per-type status filter, keyboard navigation (↑/↓/Enter/Esc), and
 * recent searches (localStorage) when the query is empty.
 *
 * The status filter only appears when a single type with a status
 * vocabulary is selected — status values differ per entity, so a status
 * filter without a type would be ambiguous.
 *
 * The palette UI follows live StackMate (centred ~480px modal, title,
 * ~36px rows with accent-tinted type icons, selected-row bg) — but the
 * SCOPE stays data-entity search per the owner's order, never
 * nav-only.
 */

/** Accent-tinted icon per entity type (live StackMate palette rows). */
const TYPE_ICONS: Record<string, LucideIcon> = {
  tenant: Building,
  user: Users,
  plan: Layers,
  invoice: Receipt,
  payment: CreditCard,
  proof: BadgeCheck,
  subscription: RefreshCw,
  coupon: Ticket,
  'credit-note': FileText,
  method: Wallet,
  job: Clock,
  lead: UserPlus,
  domain: Globe,
  audit: ScrollText,
  invite: Mail,
  landing: LayoutTemplate,
};
export function SearchPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { api } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('');
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const flat = useMemo(() => flattenGroups(groups), [groups]);
  const trimmed = query.trim();
  const statusOptions = type === 'all' ? [] : (TYPE_STATUSES[type] ?? []);
  const searching = trimmed.length >= MIN_SEARCH_LENGTH;

  // Fresh state on every open; focus the input.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setType('all');
    setStatus('');
    setGroups([]);
    setTotal(0);
    setError('');
    setActiveIndex(-1);
    setRecent(getRecentSearches());
    inputRef.current?.focus();
  }, [open ]);

  // Esc closes (backdrop click too, below). The palette is a dialog, not
  // a native popup — everything renders in-app.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  // Debounced search; aborts the in-flight request on each new keystroke.
  useEffect(() => {
    if (!open) return;
    if (!searching) {
      setGroups([]);
      setTotal(0);
      setLoading(false);
      setError('');
      setActiveIndex(-1);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      void api(buildSearchUrl(trimmed, type, status), {
        signal: controller.signal,
      })
        .then((r) => readJson<{ groups: SearchGroup[]; total: number }>(r))
        .then((data) => {
          if (controller.signal.aborted) return;
          setGroups(data.groups);
          setTotal(data.total);
          setError('');
          setActiveIndex(-1);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setError(errorMessage(err));
          setGroups([]);
          setTotal(0);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, searching, trimmed, type, status, api]);

  // Keep the active row visible while arrow-keying through results.
  useEffect(() => {
    if (activeIndex < 0) return;
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open) return null;

  const goTo = (item: SearchResultItem) => {
    saveRecentSearch(trimmed);
    setRecent(getRecentSearches());
    onClose();
    const { to, search } = parseConsoleLink(item.link);
    void navigate({ to, search });
  };

  const onInputKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (flat.length === 0) return;
      setActiveIndex((current) => {
        if (current === -1) return event.key === 'ArrowDown' ? 0 : flat.length - 1;
        const next = current + (event.key === 'ArrowDown' ? 1 : -1);
        return (next + flat.length) % flat.length;
      });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = flat[activeIndex] ?? flat[0];
      if (target) goTo(target);
    }
  };

  const runRecent = (recentQuery: string) => {
    setQuery(recentQuery);
    inputRef.current?.focus();
  };

  let flatIndex = -1;

  return (
    <div
      className="dialog-backdrop search-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="search-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search the console"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="search-palette-header">
          <span className="search-palette-title">Search</span>
          <button
            type="button"
            className="search-palette-clear"
            aria-label="Close search"
            onClick={onClose}
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <div className="search-palette-input-row">
          <SearchIcon size={18} strokeWidth={2} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            className="search-palette-input"
            placeholder="Search tenants, invoices, users…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls="search-palette-results"
            aria-label="Search the console"
            autoComplete="off"
            spellCheck={false}
          />
          {query ? (
            <button
              type="button"
              className="search-palette-clear"
              aria-label="Clear search"
              onClick={() => setQuery('')}
            >
              <X size={16} strokeWidth={2} />
            </button>
          ) : null}
          <kbd className="search-trigger-kbd">Esc</kbd>
        </div>

        <div className="search-palette-filters">
          <ScrollableTabs label="Filter by type">
            <button
              type="button"
              role="tab"
              aria-selected={type === 'all'}
              className="tab"
              data-active={type === 'all'}
              onClick={() => {
                setType('all');
                setStatus('');
              }}
            >
              All
            </button>
            {SEARCH_TYPES.map((t) => (
              <button
                key={t.type}
                type="button"
                role="tab"
                aria-selected={type === t.type}
                className="tab"
                data-active={type === t.type}
                onClick={() => {
                  setType(t.type);
                  setStatus('');
                }}
              >
                {t.label}
              </button>
            ))}
          </ScrollableTabs>
          {statusOptions.length > 0 ? (
            <label className="search-status-filter">
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                aria-label="Filter by status"
              >
                <option value="">Any status</option>
                {statusOptions.map((s) => (
                  <option key={s} value={s}>
                    {formatStatus(s)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        <div
          className="search-palette-results"
          id="search-palette-results"
          role="listbox"
          aria-label="Search results"
          ref={listRef}
        >
          {loading ? (
            <div className="search-palette-state">Searching…</div>
          ) : error ? (
            <div className="search-palette-state search-palette-state--error">
              {error}
            </div>
          ) : !searching ? (
            <>
              {trimmed.length > 0 && trimmed.length < MIN_SEARCH_LENGTH ? (
                <div className="search-palette-state">
                  Type at least {MIN_SEARCH_LENGTH} characters to search.
                </div>
              ) : null}
              {recent.length > 0 ? (
                <div className="search-group">
                  <div className="search-group-header">
                    <span>Recent searches</span>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => {
                        clearRecentSearches();
                        setRecent([]);
                      }}
                    >
                      Clear
                    </button>
                  </div>
                  {recent.map((recentQuery) => (
                    <button
                      key={recentQuery}
                      type="button"
                      className="search-recent-item"
                      onClick={() => runRecent(recentQuery)}
                    >
                      <Clock size={14} strokeWidth={2} aria-hidden="true" />
                      <span>{recentQuery}</span>
                    </button>
                  ))}
                </div>
              ) : trimmed.length === 0 ? (
                <div className="search-palette-state">
                  Search anything in the console — tenants, invoices,
                  payments, users, leads, domains and more.
                </div>
              ) : null}
            </>
          ) : flat.length === 0 ? (
            <div className="search-palette-state">
              No results for “{trimmed}”.
            </div>
          ) : (
            groups.map((group) =>
              group.items.length === 0 ? null : (
                <div className="search-group" key={group.type}>
                  <div className="search-group-header">
                    <span>
                      {group.label} ({group.items.length})
                    </span>
                  </div>
                  {group.items.map((item) => {
                    flatIndex += 1;
                    const index = flatIndex;
                    const ItemIcon = TYPE_ICONS[item.type] ?? SearchIcon;
                    return (
                      <button
                        key={`${item.type}:${item.id}`}
                        type="button"
                        role="option"
                        aria-selected={index === activeIndex}
                        data-index={index}
                        data-active={index === activeIndex}
                        className="search-result-item"
                        onClick={() => goTo(item)}
                        onMouseEnter={() => setActiveIndex(index)}
                      >
                        <span
                          className="search-result-icon"
                          aria-hidden="true"
                        >
                          <ItemIcon size={16} strokeWidth={2} />
                        </span>
                        <span className="search-result-text">
                          <span className="search-result-title">
                            {item.title}
                          </span>
                          <span className="search-result-subtitle">
                            {item.subtitle}
                          </span>
                        </span>
                        {item.status ? (
                          <span className="badge badge--muted">
                            {formatStatus(item.status)}
                          </span>
                        ) : null}
                        <CornerDownLeft
                          size={14}
                          strokeWidth={2}
                          className="search-result-enter"
                          aria-hidden="true"
                        />
                      </button>
                    );
                  })}
                </div>
              ),
            )
          )}
        </div>

        <div className="search-palette-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>Enter</kbd> open
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
          {searching && !loading && !error ? (
            <span className="search-palette-count">
              {total} result{total === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
