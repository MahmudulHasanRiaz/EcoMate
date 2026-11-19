import { useEffect, useState } from 'react';
import { FolderTree, Newspaper, Tags } from 'lucide-react';
import { useAuth } from '../auth';
import { BlogPostEditor } from '../components/blog-post-editor';
import {
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  Modal,
  Pager,
  PageHeader,
  ScrollableTabs,
  Skeleton,
  StatusBadge,
  useToast,
} from '../components/ui';
import { errorMessage } from '../lib/api';
import {
  blogStatusLabel,
  BLOG_POST_STATUSES,
  BLOG_STATUS_LABELS,
  createBlogCategory,
  createBlogPost,
  createBlogTag,
  deleteBlogCategory,
  deleteBlogPost,
  deleteBlogTag,
  fetchBlogCategories,
  fetchBlogPosts,
  fetchBlogTags,
  flattenCategories,
  updateBlogCategory,
  updateBlogPost,
  updateBlogTag,
  type BlogCategory,
  type BlogCategoryInput,
  type BlogPost,
  type BlogPostInput,
  type BlogTag,
  type BlogTagInput,
} from '../lib/blog';
import { formatDate, formatDateTime } from '../lib/format';
import type { Page } from '../types';

/**
 * Blog (Landing CMS Batch 2, item 20): posts list + editor,
 * categories tree manager, tags manager. Reads follow READ_ROLES;
 * writes are SUPERADMIN/BILLING only — write buttons are hidden for
 * roles that would 403 (same rule as the leads export button).
 *
 * Deletes are in-app confirms, never native dialogs. Post delete is
 * a SOFT delete: the row stays (hidden by default) and its slug is
 * freed for reuse. Category delete is hard: children become roots
 * and posts lose the category (both SetNull).
 */

type BlogTab = 'posts' | 'categories' | 'tags';

type CategoryForm = {
  nameEn: string;
  nameBn: string;
  descEn: string;
  descBn: string;
  slug: string;
  parentId: string;
  sortOrder: string;
};

type TagForm = { nameEn: string; nameBn: string; slug: string };

const EMPTY_CATEGORY_FORM: CategoryForm = {
  nameEn: '',
  nameBn: '',
  descEn: '',
  descBn: '',
  slug: '',
  parentId: '',
  sortOrder: '0',
};

const EMPTY_TAG_FORM: TagForm = { nameEn: '', nameBn: '', slug: '' };

export function BlogPage() {
  const { api, session } = useAuth();
  const { pushToast } = useToast();
  const role = session?.user.role ?? '';
  const canWrite = role === 'SUPERADMIN' || role === 'BILLING';

  const [tab, setTab] = useState<BlogTab>('posts');

  // ── posts list ────────────────────────────────────────────────────
  const [posts, setPosts] = useState<Page<BlogPost> | null>(null);
  const [postsLoading, setPostsLoading] = useState(true);
  const [postsError, setPostsError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [showDeleted, setShowDeleted] = useState(false);

  // ── editor ────────────────────────────────────────────────────────
  // 'new' = creating, BlogPost = editing, null = list view.
  const [editing, setEditing] = useState<BlogPost | 'new' | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingPost, setDeletingPost] = useState<BlogPost | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // ── categories ────────────────────────────────────────────────────
  const [categories, setCategories] = useState<BlogCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState<string | null>(
    null,
  );
  const [categoryForm, setCategoryForm] =
    useState<CategoryForm>(EMPTY_CATEGORY_FORM);
  const [editingCategory, setEditingCategory] =
    useState<BlogCategory | 'new' | null>(null);
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [deletingCategory, setDeletingCategory] =
    useState<BlogCategory | null>(null);

  // ── tags ──────────────────────────────────────────────────────────
  const [tags, setTags] = useState<BlogTag[]>([]);
  const [tagsLoading, setTagsLoading] = useState(true);
  const [tagsError, setTagsError] = useState<string | null>(null);
  const [tagForm, setTagForm] = useState<TagForm>(EMPTY_TAG_FORM);
  const [editingTag, setEditingTag] = useState<BlogTag | 'new' | null>(
    null,
  );
  const [tagBusy, setTagBusy] = useState(false);
  const [deletingTag, setDeletingTag] = useState<BlogTag | null>(null);

  const loadPosts = () => {
    setPostsLoading(true);
    fetchBlogPosts(api, {
      page,
      limit,
      status: statusFilter || undefined,
      search: search || undefined,
      includeDeleted: showDeleted,
    })
      .then(setPosts)
      .catch((err) => setPostsError(errorMessage(err)))
      .finally(() => setPostsLoading(false));
  };

  const loadCategories = () => {
    setCategoriesLoading(true);
    fetchBlogCategories(api)
      .then(setCategories)
      .catch((err) => setCategoriesError(errorMessage(err)))
      .finally(() => setCategoriesLoading(false));
  };

  const loadTags = () => {
    setTagsLoading(true);
    fetchBlogTags(api)
      .then(setTags)
      .catch((err) => setTagsError(errorMessage(err)))
      .finally(() => setTagsLoading(false));
  };

  useEffect(() => {
    loadPosts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, statusFilter, search, page, limit, showDeleted]);

  useEffect(() => {
    loadCategories();
    loadTags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  // ── post actions ──────────────────────────────────────────────────

  const savePost = async (input: BlogPostInput) => {
    setSaving(true);
    try {
      if (editing === 'new') {
        const created = await createBlogPost(api, input);
        pushToast(`Post “${created.titleEn}” created.`, 'success');
      } else if (editing) {
        const updated = await updateBlogPost(api, editing.id, input);
        pushToast(`Post “${updated.titleEn}” saved.`, 'success');
      }
      setEditing(null);
      loadPosts();
    } finally {
      setSaving(false);
    }
  };

  const confirmDeletePost = async () => {
    if (!deletingPost) return;
    setDeleteBusy(true);
    try {
      await deleteBlogPost(api, deletingPost.id);
      pushToast(
        `Post “${deletingPost.titleEn}” deleted. Its slug is free again.`,
        'success',
      );
      setDeletingPost(null);
      loadPosts();
    } catch (err) {
      pushToast(errorMessage(err), 'error');
    } finally {
      setDeleteBusy(false);
    }
  };

  // ── category actions ──────────────────────────────────────────────

  const openCategoryForm = (category: BlogCategory | 'new') => {
    setEditingCategory(category);
    setCategoryForm(
      category === 'new'
        ? EMPTY_CATEGORY_FORM
        : {
            nameEn: category.nameEn,
            nameBn: category.nameBn,
            descEn: category.descEn ?? '',
            descBn: category.descBn ?? '',
            slug: category.slug,
            parentId: category.parentId ?? '',
            sortOrder: String(category.sortOrder),
          },
    );
  };

  const saveCategory = async () => {
    if (!categoryForm.nameEn.trim() || !categoryForm.nameBn.trim()) {
      pushToast('Both the English and Bangla names are required.', 'error');
      return;
    }
    const input: BlogCategoryInput = {
      nameEn: categoryForm.nameEn.trim(),
      nameBn: categoryForm.nameBn.trim(),
      descEn: categoryForm.descEn.trim() || null,
      descBn: categoryForm.descBn.trim() || null,
      parentId: categoryForm.parentId || null,
      sortOrder: Number(categoryForm.sortOrder) || 0,
    };
    if (categoryForm.slug.trim()) input.slug = categoryForm.slug.trim();
    setCategoryBusy(true);
    try {
      if (editingCategory === 'new') {
        const created = await createBlogCategory(api, input);
        pushToast(`Category “${created.nameEn}” created.`, 'success');
      } else if (editingCategory) {
        const updated = await updateBlogCategory(
          api,
          editingCategory.id,
          input,
        );
        pushToast(`Category “${updated.nameEn}” saved.`, 'success');
      }
      setEditingCategory(null);
      loadCategories();
    } catch (err) {
      pushToast(errorMessage(err), 'error');
    } finally {
      setCategoryBusy(false);
    }
  };

  const confirmDeleteCategory = async () => {
    if (!deletingCategory) return;
    setCategoryBusy(true);
    try {
      await deleteBlogCategory(api, deletingCategory.id);
      pushToast(
        `Category “${deletingCategory.nameEn}” deleted.`,
        'success',
      );
      setDeletingCategory(null);
      loadCategories();
      loadPosts();
    } catch (err) {
      pushToast(errorMessage(err), 'error');
    } finally {
      setCategoryBusy(false);
    }
  };

  // ── tag actions ───────────────────────────────────────────────────

  const openTagForm = (tag: BlogTag | 'new') => {
    setEditingTag(tag);
    setTagForm(
      tag === 'new'
        ? EMPTY_TAG_FORM
        : { nameEn: tag.nameEn, nameBn: tag.nameBn, slug: tag.slug },
    );
  };

  const saveTag = async () => {
    if (!tagForm.nameEn.trim() || !tagForm.nameBn.trim()) {
      pushToast('Both the English and Bangla names are required.', 'error');
      return;
    }
    const input: BlogTagInput = {
      nameEn: tagForm.nameEn.trim(),
      nameBn: tagForm.nameBn.trim(),
    };
    if (tagForm.slug.trim()) input.slug = tagForm.slug.trim();
    setTagBusy(true);
    try {
      if (editingTag === 'new') {
        const created = await createBlogTag(api, input);
        pushToast(`Tag “${created.nameEn}” created.`, 'success');
      } else if (editingTag) {
        const updated = await updateBlogTag(api, editingTag.id, input);
        pushToast(`Tag “${updated.nameEn}” saved.`, 'success');
      }
      setEditingTag(null);
      loadTags();
    } catch (err) {
      pushToast(errorMessage(err), 'error');
    } finally {
      setTagBusy(false);
    }
  };

  const confirmDeleteTag = async () => {
    if (!deletingTag) return;
    setTagBusy(true);
    try {
      await deleteBlogTag(api, deletingTag.id);
      pushToast(`Tag “${deletingTag.nameEn}” deleted.`, 'success');
      setDeletingTag(null);
      loadTags();
      loadPosts();
    } catch (err) {
      pushToast(errorMessage(err), 'error');
    } finally {
      setTagBusy(false);
    }
  };

  // ── editor view ───────────────────────────────────────────────────

  if (editing !== null) {
    return (
      <div>
        <PageHeader
          eyebrow="Website"
          title={editing === 'new' ? 'New blog post' : 'Edit blog post'}
          description={
            editing === 'new'
              ? 'Write the article in English and Bangla, then save it as a draft or publish it.'
              : `Editing “${editing.titleEn}” — /blog/${editing.slug}`
          }
          actions={
            <button
              type="button"
              className="button"
              onClick={() => setEditing(null)}
            >
              Back to posts
            </button>
          }
        />
        <BlogPostEditor
          post={editing === 'new' ? null : editing}
          categories={categories}
          tags={tags}
          busy={saving}
          onSave={savePost}
          onCancel={() => setEditing(null)}
        />
      </div>
    );
  }

  const flatCategories = flattenCategories(categories);

  const renderCategoryRows = (
    nodes: BlogCategory[],
    depth: number,
  ): React.ReactNode[] =>
    nodes.flatMap((node) => [
      <tr key={node.id}>
        <td>
          <span
            className="blog-tree-indent"
            style={{ paddingLeft: depth * 20 }}
          >
            {depth > 0 ? '↳ ' : ''}
            {node.nameEn}
          </span>
          <span className="muted-note"> {node.nameBn}</span>
        </td>
        <td>
          <code>{node.slug}</code>
        </td>
        <td>{node.postCount ?? 0}</td>
        <td>{node.sortOrder}</td>
        <td>
          {canWrite && (
            <span className="row-actions">
              <button
                type="button"
                className="button button--sm"
                onClick={() => openCategoryForm(node)}
              >
                Edit
              </button>
              <button
                type="button"
                className="button button--sm button--danger"
                onClick={() => setDeletingCategory(node)}
              >
                Delete
              </button>
            </span>
          )}
        </td>
      </tr>,
      ...(node.children?.length
        ? renderCategoryRows(node.children, depth + 1)
        : []),
    ]);

  return (
    <div>
      <PageHeader
        eyebrow="Website"
        title="Blog"
        description="Articles for the public landing blog — bilingual posts, categories and tags."
        actions={
          canWrite && tab === 'posts' ? (
            <button
              type="button"
              className="button button--primary"
              onClick={() => setEditing('new')}
            >
              <Newspaper size={15} /> New post
            </button>
          ) : canWrite && tab === 'categories' ? (
            <button
              type="button"
              className="button button--primary"
              onClick={() => openCategoryForm('new')}
            >
              New category
            </button>
          ) : canWrite && tab === 'tags' ? (
            <button
              type="button"
              className="button button--primary"
              onClick={() => openTagForm('new')}
            >
              New tag
            </button>
          ) : undefined
        }
      />

      <ScrollableTabs label="Blog sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'posts'}
          className="tab"
          data-active={tab === 'posts'}
          onClick={() => setTab('posts')}
        >
          Posts
          {posts ? <span>{posts.meta.total}</span> : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'categories'}
          className="tab"
          data-active={tab === 'categories'}
          onClick={() => setTab('categories')}
        >
          Categories &amp; tree
          <span>{flatCategories.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'tags'}
          className="tab"
          data-active={tab === 'tags'}
          onClick={() => setTab('tags')}
        >
          Tags
          <span>{tags.length}</span>
        </button>
      </ScrollableTabs>

      {tab === 'posts' && (
        <section>
          <div className="toolbar">
            <div className="toolbar-search">
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    setPage(1);
                    setSearch(searchInput);
                  }
                }}
                placeholder="Search title or slug…"
                aria-label="Search posts"
              />
              <button
                type="button"
                className="button"
                onClick={() => {
                  setPage(1);
                  setSearch(searchInput);
                }}
              >
                Search
              </button>
            </div>
            <select
              value={statusFilter}
              onChange={(event) => {
                setPage(1);
                setStatusFilter(event.target.value);
              }}
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              {BLOG_POST_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {BLOG_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
            <label className="blog-show-deleted">
              <input
                type="checkbox"
                checked={showDeleted}
                onChange={(event) => {
                  setPage(1);
                  setShowDeleted(event.target.checked);
                }}
              />
              Show deleted
            </label>
          </div>

          {postsError && <ErrorNote message={postsError} />}
          {postsLoading ? (
            <Skeleton rows={6} />
          ) : !posts || posts.data.length === 0 ? (
            <EmptyState icon={Newspaper} title="No blog posts yet">
              <p>
                Write the first article for the public blog — it appears
                on /blog once published.
              </p>
              {canWrite && (
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => setEditing('new')}
                >
                  New post
                </button>
              )}
            </EmptyState>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Category</th>
                      <th>Status</th>
                      <th>Published</th>
                      <th>Updated</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {posts.data.map((post) => (
                      <tr key={post.id} data-deleted={post.deletedAt ? true : undefined}>
                        <td>
                          <button
                            type="button"
                            className="table-link"
                            onClick={() =>
                              !post.deletedAt && setEditing(post)
                            }
                            disabled={!!post.deletedAt}
                            title={
                              post.deletedAt
                                ? 'Deleted posts cannot be edited'
                                : 'Edit post'
                            }
                          >
                            {post.titleEn}
                          </button>
                          <div className="muted-note">
                            <code>/blog/{post.slug}</code>
                            {post.tags.length > 0 &&
                              ` · ${post.tags.map((t) => t.nameEn).join(', ')}`}
                          </div>
                        </td>
                        <td>
                          {post.category ? post.category.nameEn : '—'}
                        </td>
                        <td>
                          <StatusBadge
                            status={post.deletedAt ? 'DELETED' : post.effectiveStatus}
                          />
                          {post.effectiveStatus !== post.status && (
                            <div className="muted-note">
                              {blogStatusLabel(post)}
                            </div>
                          )}
                        </td>
                        <td>{formatDate(post.publishedAt)}</td>
                        <td>{formatDateTime(post.updatedAt)}</td>
                        <td>
                          {canWrite && !post.deletedAt && (
                            <span className="row-actions">
                              <button
                                type="button"
                                className="button button--sm"
                                onClick={() => setEditing(post)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="button button--sm button--danger"
                                onClick={() => setDeletingPost(post)}
                              >
                                Delete
                              </button>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager
                page={posts.meta.page}
                totalPages={posts.meta.totalPages}
                total={posts.meta.total}
                limit={limit}
                onPage={setPage}
                onLimit={(next) => {
                  setPage(1);
                  setLimit(next);
                }}
              />
            </>
          )}
        </section>
      )}

      {tab === 'categories' && (
        <section>
          {categoriesError && <ErrorNote message={categoriesError} />}
          {categoriesLoading ? (
            <Skeleton rows={5} />
          ) : categories.length === 0 ? (
            <EmptyState icon={FolderTree} title="No categories yet">
              <p>
                Categories organise the blog archive — nest them up to
                three levels deep.
              </p>
              {canWrite && (
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => openCategoryForm('new')}
                >
                  New category
                </button>
              )}
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Slug</th>
                    <th>Posts</th>
                    <th>Order</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {renderCategoryRows(categories, 0)}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted-note muted-note--gap-top">
            Deleting a category is permanent: its sub-categories become
            top-level and its posts lose the category.
          </p>
        </section>
      )}

      {tab === 'tags' && (
        <section>
          {tagsError && <ErrorNote message={tagsError} />}
          {tagsLoading ? (
            <Skeleton rows={5} />
          ) : tags.length === 0 ? (
            <EmptyState icon={Tags} title="No tags yet">
              <p>
                Tags group posts across categories — readers filter the
                archive by tag.
              </p>
              {canWrite && (
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => openTagForm('new')}
                >
                  New tag
                </button>
              )}
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Slug</th>
                    <th>Posts</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {tags.map((tag) => (
                    <tr key={tag.id}>
                      <td>
                        {tag.nameEn}
                        <span className="muted-note"> {tag.nameBn}</span>
                      </td>
                      <td>
                        <code>{tag.slug}</code>
                      </td>
                      <td>{tag.postCount ?? 0}</td>
                      <td>
                        {canWrite && (
                          <span className="row-actions">
                            <button
                              type="button"
                              className="button button--sm"
                              onClick={() => openTagForm(tag)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="button button--sm button--danger"
                              onClick={() => setDeletingTag(tag)}
                            >
                              Delete
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ── post delete confirm ─────────────────────────────────── */}
      <ConfirmDialog
        open={deletingPost !== null}
        title="Delete this post?"
        body={
          deletingPost ? (
            <p>
              “{deletingPost.titleEn}” will be soft-deleted: it leaves
              the public blog at once, and its slug{' '}
              <code>/blog/{deletingPost.slug}</code> becomes available
              for a new post.
            </p>
          ) : null
        }
        confirmLabel="Delete post"
        danger
        busy={deleteBusy}
        onConfirm={confirmDeletePost}
        onClose={() => setDeletingPost(null)}
      />

      {/* ── category form ───────────────────────────────────────── */}
      <Modal
        open={editingCategory !== null}
        onClose={() => setEditingCategory(null)}
        title={
          editingCategory === 'new' ? 'New category' : 'Edit category'
        }
      >
        <div className="inline-form">
          <label>
            Name (English) *
            <input
              type="text"
              value={categoryForm.nameEn}
              onChange={(event) =>
                setCategoryForm((f) => ({ ...f, nameEn: event.target.value }))
              }
              maxLength={120}
              autoFocus
            />
          </label>
          <label>
            Name (Bangla) *
            <input
              type="text"
              value={categoryForm.nameBn}
              onChange={(event) =>
                setCategoryForm((f) => ({ ...f, nameBn: event.target.value }))
              }
              maxLength={120}
            />
          </label>
          <label>
            Slug
            <input
              type="text"
              value={categoryForm.slug}
              onChange={(event) =>
                setCategoryForm((f) => ({ ...f, slug: event.target.value }))
              }
              maxLength={120}
              placeholder="auto-from-name"
            />
          </label>
          <label>
            Parent category
            <select
              value={categoryForm.parentId}
              onChange={(event) =>
                setCategoryForm((f) => ({
                  ...f,
                  parentId: event.target.value,
                }))
              }
            >
              <option value="">Top level</option>
              {flatCategories
                .filter(
                  (option) =>
                    // A category cannot be its own parent; deeper
                    // cycles are rejected by the API (400 + toast).
                    editingCategory === 'new' ||
                    editingCategory === null ||
                    option.id !== editingCategory.id,
                )
                .map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Sort order
            <input
              type="number"
              min={0}
              value={categoryForm.sortOrder}
              onChange={(event) =>
                setCategoryForm((f) => ({
                  ...f,
                  sortOrder: event.target.value,
                }))
              }
            />
          </label>
        </div>
        <label className="field">
          Description (English)
          <textarea
            value={categoryForm.descEn}
            onChange={(event) =>
              setCategoryForm((f) => ({ ...f, descEn: event.target.value }))
            }
            maxLength={500}
            rows={2}
          />
        </label>
        <label className="field">
          Description (Bangla)
          <textarea
            value={categoryForm.descBn}
            onChange={(event) =>
              setCategoryForm((f) => ({ ...f, descBn: event.target.value }))
            }
            maxLength={500}
            rows={2}
          />
        </label>
        <div className="form-actions">
          <button
            type="button"
            className="button button--accent"
            onClick={saveCategory}
            disabled={categoryBusy}
          >
            {categoryBusy
              ? 'Saving…'
              : editingCategory === 'new'
                ? 'Create category'
                : 'Save changes'}
          </button>
          <button
            type="button"
            className="button"
            onClick={() => setEditingCategory(null)}
          >
            Cancel
          </button>
        </div>
      </Modal>

      {/* ── category delete confirm ─────────────────────────────── */}
      <ConfirmDialog
        open={deletingCategory !== null}
        title="Delete this category?"
        body={
          deletingCategory ? (
            <p>
              “{deletingCategory.nameEn}” will be deleted permanently.
              Its sub-categories become top-level and its posts lose
              the category.
            </p>
          ) : null
        }
        confirmLabel="Delete category"
        danger
        busy={categoryBusy}
        onConfirm={confirmDeleteCategory}
        onClose={() => setDeletingCategory(null)}
      />

      {/* ── tag form ────────────────────────────────────────────── */}
      <Modal
        open={editingTag !== null}
        onClose={() => setEditingTag(null)}
        title={editingTag === 'new' ? 'New tag' : 'Edit tag'}
      >
        <div className="inline-form">
          <label>
            Name (English) *
            <input
              type="text"
              value={tagForm.nameEn}
              onChange={(event) =>
                setTagForm((f) => ({ ...f, nameEn: event.target.value }))
              }
              maxLength={120}
              autoFocus
            />
          </label>
          <label>
            Name (Bangla) *
            <input
              type="text"
              value={tagForm.nameBn}
              onChange={(event) =>
                setTagForm((f) => ({ ...f, nameBn: event.target.value }))
              }
              maxLength={120}
            />
          </label>
          <label>
            Slug
            <input
              type="text"
              value={tagForm.slug}
              onChange={(event) =>
                setTagForm((f) => ({ ...f, slug: event.target.value }))
              }
              maxLength={120}
              placeholder="auto-from-name"
            />
          </label>
        </div>
        <div className="form-actions">
          <button
            type="button"
            className="button button--accent"
            onClick={saveTag}
            disabled={tagBusy}
          >
            {tagBusy
              ? 'Saving…'
              : editingTag === 'new'
                ? 'Create tag'
                : 'Save changes'}
          </button>
          <button
            type="button"
            className="button"
            onClick={() => setEditingTag(null)}
          >
            Cancel
          </button>
        </div>
      </Modal>

      {/* ── tag delete confirm ──────────────────────────────────── */}
      <ConfirmDialog
        open={deletingTag !== null}
        title="Delete this tag?"
        body={
          deletingTag ? (
            <p>
              “{deletingTag.nameEn}” will be removed from every post
              that uses it.
            </p>
          ) : null
        }
        confirmLabel="Delete tag"
        danger
        busy={tagBusy}
        onConfirm={confirmDeleteTag}
        onClose={() => setDeletingTag(null)}
      />
    </div>
  );
}
