import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Copy,
  FolderOpen,
  HardDrive,
  Image as ImageIcon,
  Images,
  LayoutGrid,
  List as ListIcon,
  Trash2,
  Upload,
} from 'lucide-react';
import { useAuth } from '../auth';
import { mediaKindIcon } from '../components/media-picker';
import {
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  Modal,
  Pager,
  PageHeader,
  Skeleton,
  useToast,
} from '../components/ui';
import { errorMessage, readJson } from '../lib/api';
import { formatDateTime } from '../lib/format';
import {
  fetchMediaFolders,
  fetchMediaList,
  fetchMediaStats,
  fetchMediaUsage,
  folderLabel,
  formatBytes,
  mediaAcceptForKinds,
  MEDIA_KIND_LABELS,
  MEDIA_KINDS,
  resolveMediaUrl,
  uploadMediaFile,
  type MediaAsset,
  type MediaKind,
  type MediaStats,
  type MediaUsageRef,
} from '../lib/media';

export function MediaPage() {
  const { api, session } = useAuth();
  const { pushToast } = useToast();
  const role = session?.user.role ?? '';
  const canManage = role === 'SUPERADMIN' || role === 'BILLING';

  const [items, setItems] = useState<MediaAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [folders, setFolders] = useState<string[]>([]);
  const [stats, setStats] = useState<MediaStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<MediaKind | ''>('');
  const [folder, setFolder] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<MediaAsset | null>(null);
  const [usage, setUsage] = useState<MediaUsageRef[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MediaAsset[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Detail edit state (rename / move / tags).
  const [editName, setEditName] = useState('');
  const [editFolder, setEditFolder] = useState('');
  const [newFolder, setNewFolder] = useState('');
  const [editTags, setEditTags] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, folderList, nextStats] = await Promise.all([
        fetchMediaList(api, {
          q: search || undefined,
          kind: kind || undefined,
          folder: folder || undefined,
          limit,
          offset: (page - 1) * limit,
        }),
        fetchMediaFolders(api),
        fetchMediaStats(api),
      ]);
      setItems(list.items);
      setTotal(list.total);
      setFolders(folderList);
      setStats(nextStats);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [api, search, kind, folder, page, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep the detail edit fields in sync with the open asset, and load
  // its usage info (where the file is referenced).
  useEffect(() => {
    if (!detail) {
      setUsage(null);
      return;
    }
    setEditName(detail.originalFilename);
    setEditFolder(detail.folder);
    setNewFolder('');
    setEditTags(detail.tags.join(', '));
    setUsage(null);
    fetchMediaUsage(api, detail.id)
      .then(setUsage)
      .catch(() => setUsage([]));
  }, [detail, api]);

  async function handleFiles(files: FileList | File[] | null) {
    const list = files ? Array.from(files) : [];
    if (list.length === 0) return;
    setUploading(true);
    setError(null);
    let done = 0;
    for (const file of list) {
      try {
        await uploadMediaFile(api, file, { folder: folder || undefined });
        done += 1;
      } catch (err) {
        pushToast(errorMessage(err), 'error');
      }
    }
    setUploading(false);
    if (done > 0) {
      setNotice(
        done === 1 ? 'File uploaded to the library.' : `${done} files uploaded.`,
      );
      setSelectedIds(new Set());
      void load();
    }
  }

  async function copyUrl(asset: MediaAsset) {
    const url = resolveMediaUrl(asset.contentUrl);
    try {
      await navigator.clipboard.writeText(url);
      pushToast('URL copied to the clipboard.', 'success');
    } catch {
      // Clipboard API unavailable (permissions) — fall back to a
      // selectable prompt-free path: select the URL in the detail view.
      pushToast(`Copy the URL from the detail view: ${url}`, 'info');
    }
  }

  async function saveDetail(patch: {
    rename?: string;
    move?: string;
    tags?: string[];
  }) {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      let updated = detail;
      if (patch.rename !== undefined && patch.rename !== detail.originalFilename) {
        updated = await api(`/media/${detail.id}/rename`, {
          method: 'PATCH',
          body: JSON.stringify({ originalFilename: patch.rename }),
        }).then((r) => readJson<MediaAsset>(r));
      }
      if (patch.move !== undefined && patch.move !== detail.folder) {
        updated = await api(`/media/${detail.id}/move`, {
          method: 'PATCH',
          body: JSON.stringify({ folder: patch.move }),
        }).then((r) => readJson<MediaAsset>(r));
      }
      if (patch.tags !== undefined) {
        updated = await api(`/media/${detail.id}/tags`, {
          method: 'PATCH',
          body: JSON.stringify({ tags: patch.tags }),
        }).then((r) => readJson<MediaAsset>(r));
      }
      setDetail(updated);
      setNotice('File updated.');
      void load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteAssets(assets: MediaAsset[]) {
    setBusy(true);
    setError(null);
    let done = 0;
    for (const asset of assets) {
      try {
        await api(`/media/${asset.id}`, { method: 'DELETE' }).then((r) =>
          readJson(r),
        );
        done += 1;
      } catch (err) {
        pushToast(errorMessage(err), 'error');
      }
    }
    setBusy(false);
    setConfirmDelete(null);
    setSelectedIds(new Set());
    if (detail && assets.some((a) => a.id === detail.id)) setDetail(null);
    if (done > 0) {
      setNotice(done === 1 ? 'File deleted.' : `${done} files deleted.`);
      void load();
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const selectedAssets = items.filter((item) => selectedIds.has(item.id));
  const detailUrl = detail ? resolveMediaUrl(detail.contentUrl) : '';
  // The move select must always offer the open file's own folder —
  // the folders list refreshes a beat after a move, and without this
  // the select briefly shows the wrong folder (Root) while its value
  // points at a folder not yet in the options.
  const moveFolders = detail
    ? [...new Set([...folders, detail.folder])]
    : folders;

  return (
    <>
      <PageHeader
        eyebrow="Website"
        title="Media library"
        description="Files for the landing page and platform branding — logos, images, documents. Pick them from any image field in the console, or manage them here."
      />
      {error ? <ErrorNote message={error} /> : null}
      {notice ? (
        <div className="notice notice--success" role="status">
          {notice}
        </div>
      ) : null}

      {stats ? (
        <section className="metric-grid">
          <article className="metric metric--tint-1">
            <span className="metric-icon" aria-hidden="true">
              <Images size={16} strokeWidth={2} />
            </span>
            <span>Total files</span>
            <strong>{stats.totalFiles}</strong>
            <small>Across all folders</small>
          </article>
          <article className="metric metric--tint-2">
            <span className="metric-icon" aria-hidden="true">
              <HardDrive size={16} strokeWidth={2} />
            </span>
            <span>Storage used</span>
            <strong>{formatBytes(stats.totalBytes)}</strong>
            <small>Local volume</small>
          </article>
          <article className="metric metric--tint-3">
            <span className="metric-icon" aria-hidden="true">
              <ImageIcon size={16} strokeWidth={2} />
            </span>
            <span>Images</span>
            <strong>{stats.byKind.image.files}</strong>
            <small>{formatBytes(stats.byKind.image.bytes)}</small>
          </article>
          <article className="metric metric--tint-4">
            <span className="metric-icon" aria-hidden="true">
              <FolderOpen size={16} strokeWidth={2} />
            </span>
            <span>Folders</span>
            <strong>{stats.folderCount}</strong>
            <small>Including the root</small>
          </article>
        </section>
      ) : null}

      <div className="toolbar">
        <div className="toolbar-search">
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search files by name or tag…"
            aria-label="Search media library"
            autoComplete="off"
          />
        </div>
        <select
          value={folder}
          onChange={(event) => {
            setFolder(event.target.value);
            setPage(1);
          }}
          aria-label="Filter by folder"
        >
          <option value="">All folders</option>
          {folders.map((f) => (
            <option key={f} value={f}>
              {folderLabel(f)}
            </option>
          ))}
        </select>
        <div className="media-view-toggle" role="group" aria-label="View">
          <button
            type="button"
            className={`button button--sm${view === 'grid' ? ' button--accent-outline' : ''}`}
            onClick={() => setView('grid')}
            aria-pressed={view === 'grid'}
          >
            <LayoutGrid size={14} /> Grid
          </button>
          <button
            type="button"
            className={`button button--sm${view === 'list' ? ' button--accent-outline' : ''}`}
            onClick={() => setView('list')}
            aria-pressed={view === 'list'}
          >
            <ListIcon size={14} /> List
          </button>
        </div>
        {canManage ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={mediaAcceptForKinds()}
              multiple
              className="media-file-input"
              onChange={(event) => {
                void handleFiles(event.target.files);
                event.target.value = '';
              }}
            />
            <button
              type="button"
              className="button button--primary"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={14} /> {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </>
        ) : null}
      </div>

      <div className="media-kind-chips" role="group" aria-label="Filter by type">
        <button
          type="button"
          className={`media-kind-chip${kind === '' ? ' media-kind-chip--active' : ''}`}
          onClick={() => {
            setKind('');
            setPage(1);
          }}
        >
          All
        </button>
        {MEDIA_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            className={`media-kind-chip${kind === k ? ' media-kind-chip--active' : ''}`}
            onClick={() => {
              setKind(k);
              setPage(1);
            }}
          >
            {MEDIA_KIND_LABELS[k]}
            {stats ? ` (${stats.byKind[k].files})` : ''}
          </button>
        ))}
      </div>

      {selectedIds.size > 0 ? (
        <div className="media-bulk-bar" role="status">
          <span>{selectedIds.size} selected</span>
          <button
            type="button"
            className="button button--sm"
            onClick={() => setSelectedIds(new Set())}
          >
            Clear
          </button>
          {canManage ? (
            <button
              type="button"
              className="button button--sm button--danger-solid"
              onClick={() => setConfirmDelete(selectedAssets)}
            >
              <Trash2 size={14} /> Delete selected
            </button>
          ) : null}
        </div>
      ) : null}

      <div
        className={`card media-dropzone${dragOver ? ' media-dropzone--dragover' : ''}`}
        onDragOver={(event) => {
          if (!canManage) return;
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          if (!canManage) return;
          event.preventDefault();
          setDragOver(false);
          void handleFiles(event.dataTransfer.files);
        }}
      >
        {loading ? (
          <Skeleton rows={4} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Images}
            title={
              search || kind || folder
                ? 'No files match'
                : 'The library is empty'
            }
          >
            {search || kind || folder
              ? 'Try a different search or filter — or upload a file.'
              : 'Upload your first file to use it anywhere in the console.'}
          </EmptyState>
        ) : view === 'grid' ? (
          <div className="media-grid">
            {items.map((asset) => {
              const Icon = mediaKindIcon(asset.kind);
              return (
                <article key={asset.id} className="media-card media-card--page">
                  {canManage ? (
                    <input
                      type="checkbox"
                      className="media-card-select"
                      checked={selectedIds.has(asset.id)}
                      onChange={() => toggleSelect(asset.id)}
                      aria-label={`Select ${asset.originalFilename}`}
                    />
                  ) : null}
                  <button
                    type="button"
                    className="media-card-body"
                    onClick={() => setDetail(asset)}
                    title={`${asset.originalFilename} · ${formatBytes(asset.byteSize)}`}
                  >
                    <span className="media-thumb">
                      {asset.kind === 'image' ? (
                        <img
                          src={resolveMediaUrl(asset.contentUrl)}
                          alt=""
                          loading="lazy"
                        />
                      ) : asset.kind === 'video' ? (
                        <video
                          src={resolveMediaUrl(asset.contentUrl)}
                          preload="metadata"
                          muted
                        />
                      ) : (
                        <Icon size={28} strokeWidth={1.5} />
                      )}
                    </span>
                    <span className="media-card-name">
                      {asset.originalFilename}
                    </span>
                    <span className="media-card-meta">
                      {formatBytes(asset.byteSize)}
                      {asset.width && asset.height
                        ? ` · ${asset.width}×${asset.height}`
                        : ''}
                      {asset.folder ? ` · ${asset.folder}` : ''}
                    </span>
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="media-table">
              <thead>
                <tr>
                  {canManage ? <th aria-label="Select" /> : null}
                  <th aria-label="Preview" />
                  <th>Name</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>Folder</th>
                  <th>Uploaded</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {items.map((asset) => {
                  const Icon = mediaKindIcon(asset.kind);
                  return (
                    <tr key={asset.id}>
                      {canManage ? (
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(asset.id)}
                            onChange={() => toggleSelect(asset.id)}
                            aria-label={`Select ${asset.originalFilename}`}
                          />
                        </td>
                      ) : null}
                      <td>
                        <span className="media-thumb media-thumb--sm">
                          {asset.kind === 'image' ? (
                            <img
                              src={resolveMediaUrl(asset.contentUrl)}
                              alt=""
                              loading="lazy"
                            />
                          ) : (
                            <Icon size={20} strokeWidth={1.5} />
                          )}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="table-link"
                          onClick={() => setDetail(asset)}
                        >
                          {asset.originalFilename}
                        </button>
                      </td>
                      <td>{MEDIA_KIND_LABELS[asset.kind]}</td>
                      <td>{formatBytes(asset.byteSize)}</td>
                      <td>{folderLabel(asset.folder)}</td>
                      <td>{formatDateTime(asset.createdAt)}</td>
                      <td>
                        <button
                          type="button"
                          className="button button--sm"
                          onClick={() => void copyUrl(asset)}
                        >
                          <Copy size={14} /> Copy URL
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {dragOver ? (
          <p className="media-dropzone-hint">Drop files to upload them</p>
        ) : null}
      </div>

      <Pager
        page={page}
        totalPages={totalPages}
        total={total}
        limit={limit}
        onPage={setPage}
        onLimit={(next) => {
          setLimit(next);
          setPage(1);
        }}
      />

      {/* Detail modal: preview + metadata + usage + edit actions. */}
      <Modal
        open={detail !== null}
        title={detail?.originalFilename ?? 'File'}
        onClose={() => setDetail(null)}
        wide
      >
        {detail ? (
          <div className="media-detail">
            <div className="media-detail-preview">
              {detail.kind === 'image' ? (
                <img src={detailUrl} alt={detail.originalFilename} />
              ) : detail.kind === 'video' ? (
                <video src={detailUrl} controls preload="metadata" />
              ) : detail.kind === 'audio' ? (
                <audio src={detailUrl} controls preload="metadata" />
              ) : (
                <span className="media-detail-icon">
                  {(() => {
                    const Icon = mediaKindIcon(detail.kind);
                    return <Icon size={48} strokeWidth={1} />;
                  })()}
                </span>
              )}
            </div>
            <dl className="media-detail-meta">
              <div>
                <dt>Type</dt>
                <dd>
                  {MEDIA_KIND_LABELS[detail.kind]} · {detail.mimeType}
                </dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>
                  {formatBytes(detail.byteSize)}
                  {detail.width && detail.height
                    ? ` · ${detail.width}×${detail.height}px`
                    : ''}
                </dd>
              </div>
              <div>
                <dt>Folder</dt>
                <dd>{folderLabel(detail.folder)}</dd>
              </div>
              <div>
                <dt>Tags</dt>
                <dd>{detail.tags.length > 0 ? detail.tags.join(', ') : '—'}</dd>
              </div>
              <div>
                <dt>Storage</dt>
                <dd>{detail.driver === 'local' ? 'Local volume' : 'R2'}</dd>
              </div>
              <div>
                <dt>Uploaded</dt>
                <dd>{formatDateTime(detail.createdAt)}</dd>
              </div>
              <div>
                <dt>Checksum</dt>
                <dd className="media-mono">{detail.checksumSha256.slice(0, 16)}…</dd>
              </div>
              <div>
                <dt>URL</dt>
                <dd className="media-detail-url">
                  <span className="media-mono">{detailUrl}</span>
                  <button
                    type="button"
                    className="button button--sm"
                    onClick={() => void copyUrl(detail)}
                  >
                    <Copy size={14} /> Copy
                  </button>
                </dd>
              </div>
              <div>
                <dt>Used in</dt>
                <dd>
                  {usage === null
                    ? 'Checking…'
                    : usage.length === 0
                      ? 'Not used anywhere yet.'
                      : usage.map((ref) => ref.label).join(' · ')}
                </dd>
              </div>
            </dl>

            {canManage ? (
              <>
                <div className="media-detail-edit">
                  <label className="inline-field">
                    <span>Rename</span>
                    <input
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                      aria-label="File name"
                    />
                  </label>
                  <button
                    type="button"
                    className="button button--accent button--sm"
                    disabled={busy || editName.trim() === detail.originalFilename}
                    onClick={() => void saveDetail({ rename: editName.trim() })}
                  >
                    Save name
                  </button>
                </div>
                <div className="media-detail-edit">
                  <label className="inline-field">
                    <span>Move to folder</span>
                    <select
                      value={editFolder}
                      onChange={(event) => {
                        setEditFolder(event.target.value);
                        setNewFolder('');
                      }}
                      aria-label="Folder"
                    >
                      {moveFolders.map((f) => (
                        <option key={f} value={f}>
                          {folderLabel(f)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="inline-field">
                    <span>Or a new folder</span>
                    <input
                      value={newFolder}
                      onChange={(event) => setNewFolder(event.target.value)}
                      placeholder="landing/hero"
                      aria-label="New folder"
                    />
                  </label>
                  <button
                    type="button"
                    className="button button--accent button--sm"
                    disabled={busy}
                    onClick={() =>
                      void saveDetail({
                        move: newFolder.trim() ? newFolder.trim() : editFolder,
                      })
                    }
                  >
                    Move
                  </button>
                </div>
                <div className="media-detail-edit">
                  <label className="inline-field">
                    <span>Tags (comma-separated)</span>
                    <input
                      value={editTags}
                      onChange={(event) => setEditTags(event.target.value)}
                      placeholder="hero, landing"
                      aria-label="Tags"
                    />
                  </label>
                  <button
                    type="button"
                    className="button button--accent button--sm"
                    disabled={busy}
                    onClick={() =>
                      void saveDetail({
                        tags: editTags
                          .split(',')
                          .map((t) => t.trim())
                          .filter(Boolean),
                      })
                    }
                  >
                    Save tags
                  </button>
                </div>
                <div className="dialog-actions">
                  <button
                    type="button"
                    className="button button--danger-solid"
                    disabled={busy}
                    onClick={() => setConfirmDelete([detail])}
                  >
                    <Trash2 size={14} /> Delete file
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={
          confirmDelete && confirmDelete.length > 1
            ? `Delete ${confirmDelete.length} files?`
            : 'Delete this file?'
        }
        body={
          confirmDelete && confirmDelete.length === 1
            ? `“${confirmDelete[0]!.originalFilename}” will be removed from the library and its stored file deleted.`
            : `${confirmDelete?.length ?? 0} files will be removed from the library and their stored files deleted.`
        }
        dangerNote={
          detail &&
          confirmDelete?.length === 1 &&
          confirmDelete[0]!.id === detail.id &&
          usage &&
          usage.length > 0
            ? `This file is used in: ${usage.map((u) => u.label).join(', ')}. Deleting it breaks those references.`
            : undefined
        }
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={() => {
          if (confirmDelete) void deleteAssets(confirmDelete);
        }}
        onClose={() => setConfirmDelete(null)}
      />
    </>
  );
}
