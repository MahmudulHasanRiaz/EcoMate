import { useCallback, useEffect, useRef, useState } from 'react';
import {
  File as FileIcon,
  FileArchive,
  FileText,
  Film,
  Image as ImageIcon,
  Music,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../auth';
import { errorMessage } from '../lib/api';
import {
  fetchMediaFolders,
  fetchMediaList,
  folderLabel,
  formatBytes,
  mediaAcceptForKinds,
  MEDIA_KIND_LABELS,
  MEDIA_KINDS,
  resolveMediaUrl,
  uploadMediaFile,
  type MediaAsset,
  type MediaKind,
} from '../lib/media';
import { Modal, Skeleton, useToast } from './ui';

/**
 * MediaPicker — the shared "pick from the library AND upload new"
 * dialog used by EVERY image/asset field in the console (branding
 * logo/favicon today; landing CMS image fields when they arrive).
 * StackMate ADR-0011 Decision 7 pattern, ported to the console's
 * fetch + Modal primitives.
 *
 * Browse/search the library with the same server-side search as the
 * Media Library page (`?q=` over the full dataset — never a filter
 * over a loaded page), or upload a new file from the same dialog; the
 * new file lands at the top of the grid and can be picked at once.
 * Clicking a file picks it (single-pick chooser) and closes.
 *
 * The picker returns the picked ASSET — it does not write anything to
 * the caller's field. Callers that store a URL (branding) use the
 * asset's `contentUrl` (resolved absolute via resolveMediaUrl).
 */

export interface MediaPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (asset: MediaAsset) => void;
  /** Restrict the library to these kinds (e.g. ['image'] for the logo). Empty = all kinds. */
  kinds?: MediaKind[];
  /**
   * Restrict the library to these exact MIME types (server-side).
   * Use this when the caller's field accepts fewer types than the
   * whole kind (branding: PNG/JPEG/WEBP/GIF/SVG). When set, the kind
   * filter is hidden and uploads from the picker accept only these
   * types too.
   */
  mimes?: string[];
  title?: string;
  /** Uploads from the picker go into this folder (default: root). */
  folder?: string;
}

const PICKER_PAGE_SIZE = 24;

/** Kind → lucide icon, shared with the Media Library page. */
export function mediaKindIcon(kind: MediaKind): LucideIcon {
  switch (kind) {
    case 'image':
      return ImageIcon;
    case 'video':
      return Film;
    case 'audio':
      return Music;
    case 'document':
      return FileText;
    case 'archive':
      return FileArchive;
    default:
      return FileIcon;
  }
}

export function MediaPicker({
  open,
  onClose,
  onSelect,
  kinds,
  mimes,
  title,
  folder,
}: MediaPickerProps) {
  const { api } = useAuth();
  const { pushToast } = useToast();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const allowedKinds = kinds && kinds.length > 0 ? kinds : [...MEDIA_KINDS];
  const [kind, setKind] = useState<MediaKind | ''>(
    allowedKinds.length === 1 ? allowedKinds[0]! : '',
  );
  const [currentFolder, setCurrentFolder] = useState(folder ?? '');
  const [folders, setFolders] = useState<string[]>([]);
  const [items, setItems] = useState<MediaAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [visible, setVisible] = useState(PICKER_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [q]);

  // Reset the browser state each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setQ('');
    setDebouncedQ('');
    setKind(allowedKinds.length === 1 ? allowedKinds[0]! : '');
    setCurrentFolder(folder ?? '');
    setVisible(PICKER_PAGE_SIZE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [list, folderList] = await Promise.all([
        fetchMediaList(api, {
          q: debouncedQ || undefined,
          // A mime restriction replaces the kind filter (the two would
          // fight: a mime outside the chosen kind yields an empty list).
          kind: mimes ? undefined : kind || undefined,
          mimes,
          folder: currentFolder || undefined,
          limit: visible,
          offset: 0,
        }),
        fetchMediaFolders(api),
      ]);
      setItems(list.items);
      setTotal(list.total);
      setFolders(folderList);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [api, open, debouncedQ, kind, mimes, currentFolder, visible]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleFiles(files: FileList | File[] | null) {
    const list = files ? Array.from(files) : [];
    if (list.length === 0) return;
    setUploading(true);
    let done = 0;
    let failed = 0;
    for (const file of list) {
      // A mime restriction applies to uploads from the picker too —
      // drag-and-drop bypasses the file input's accept attribute, so
      // enforce it here before the upload starts.
      if (
        mimes &&
        mimes.length > 0 &&
        !mimes.includes(file.type.toLowerCase())
      ) {
        failed += 1;
        pushToast(
          `${file.name} is ${file.type || 'an unknown type'} — this spot accepts ${mimes.join(', ')} only.`,
          'error',
        );
        continue;
      }
      try {
        await uploadMediaFile(api, file, {
          folder: currentFolder || undefined,
        });
        done += 1;
      } catch (err) {
        failed += 1;
        pushToast(errorMessage(err), 'error');
      }
    }
    setUploading(false);
    if (done > 0) {
      pushToast(
        done === 1
          ? 'File uploaded — click it to pick it.'
          : `${done} files uploaded — click one to pick it.`,
        'success',
      );
      void load();
    }
  }

  const accept =
    mimes && mimes.length > 0 ? mimes.join(',') : mediaAcceptForKinds(kinds);

  return (
    <Modal
      open={open}
      title={title ?? 'Choose from media library'}
      onClose={onClose}
      wide
    >
      <div
        className={`media-picker${dragOver ? ' media-picker--dragover' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          void handleFiles(event.dataTransfer.files);
        }}
      >
        <div className="media-picker-toolbar">
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search files by name or tag…"
            aria-label="Search media library"
            autoComplete="off"
          />
          {allowedKinds.length > 1 && !mimes ? (
            <select
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as MediaKind | '');
                setVisible(PICKER_PAGE_SIZE);
              }}
              aria-label="Filter by type"
            >
              <option value="">All types</option>
              {allowedKinds.map((k) => (
                <option key={k} value={k}>
                  {MEDIA_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          ) : null}
          <select
            value={currentFolder}
            onChange={(event) => {
              setCurrentFolder(event.target.value);
              setVisible(PICKER_PAGE_SIZE);
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
        </div>

        {loading ? (
          <Skeleton rows={3} />
        ) : loadError ? (
          <p className="media-picker-empty">
            {loadError}{' '}
            <button
              type="button"
              className="button button--sm"
              onClick={() => void load()}
            >
              Retry
            </button>
          </p>
        ) : items.length === 0 ? (
          <p className="media-picker-empty">
            {debouncedQ || kind || currentFolder
              ? 'No files match — try a different search, or upload one below.'
              : 'The library is empty — upload your first file below.'}
          </p>
        ) : (
          <>
            <div className="media-grid media-grid--picker">
              {items.map((asset) => {
                const Icon = mediaKindIcon(asset.kind);
                return (
                  <button
                    key={asset.id}
                    type="button"
                    className="media-card"
                    onClick={() => {
                      onSelect(asset);
                      onClose();
                    }}
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
                    </span>
                  </button>
                );
              })}
            </div>
            {total > items.length ? (
              <div className="media-picker-more">
                <button
                  type="button"
                  className="button button--sm"
                  onClick={() => setVisible((v) => v + PICKER_PAGE_SIZE)}
                >
                  Show more ({total - items.length} remaining)
                </button>
              </div>
            ) : null}
          </>
        )}

        <div className="media-picker-upload">
          <input
            ref={fileInputRef}
            type="file"
            accept={accept}
            multiple
            className="media-file-input"
            onChange={(event) => {
              void handleFiles(event.target.files);
              event.target.value = '';
            }}
          />
          <button
            type="button"
            className="button button--sm"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={14} /> {uploading ? 'Uploading…' : 'Upload new'}
          </button>
          <span className="muted-note">
            {dragOver
              ? 'Drop files to upload them'
              : `Uploads go to ${currentFolder === '' ? 'the root folder' : `“${currentFolder}”`} · up to 100 MB each`}
          </span>
        </div>
      </div>
    </Modal>
  );
}
