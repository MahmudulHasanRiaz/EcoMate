import { useEffect, useState } from 'react';
import LinkExtension from '@tiptap/extension-link';
import PlaceholderExtension from '@tiptap/extension-placeholder';
import TextAlignExtension from '@tiptap/extension-text-align';
import UnderlineExtension from '@tiptap/extension-underline';
import ImageExtension from '@tiptap/extension-image';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Redo,
  Underline,
  Undo,
} from 'lucide-react';
import { Modal } from './ui';

/**
 * RichTextEditor — Tiptap (the monorepo's maintained editor lib,
 * already used by apps/admin) wrapped for the console's own styling.
 * Content is HTML (stored as-is in the blog post; the landing
 * sanitizes it before rendering).
 *
 * The editor is created once per mount: callers switch posts by
 * remounting with a new `key` (the blog page does this). Link/image
 * URLs go through in-app Modals — never native prompts.
 *
 * Image inserts: when `onImageRequest` is provided (the blog page
 * wires it to the MediaPicker), the image button calls it with an
 * insert callback; otherwise a URL input dialog is used.
 */

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  disabled?: boolean;
  ariaLabel?: string;
  onImageRequest?: (insert: (url: string) => void) => void;
}

function MenuButton({
  onClick,
  active,
  title,
  disabled,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="rte-menu-btn"
      data-on={active || undefined}
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = 'Start writing…',
  minHeight = 240,
  disabled = false,
  ariaLabel = 'Rich text editor',
  onImageRequest,
}: RichTextEditorProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [imageOpen, setImageOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState('');

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      UnderlineExtension,
      TextAlignExtension.configure({ types: ['heading', 'paragraph'] }),
      ImageExtension.configure({ inline: false }),
      LinkExtension.configure({
        openOnClick: false,
        HTMLAttributes: { rel: 'noopener noreferrer' },
      }),
      PlaceholderExtension.configure({ placeholder }),
    ],
    content: value || '',
    onUpdate: ({ editor: next }) => {
      const html = next.getHTML();
      onChange(html === '<p></p>' ? '' : html);
    },
    editable: !disabled,
    // React 19: create the editor in an effect, not during render
    // (Tiptap v3 guidance — avoids the StrictMode double-mount warn).
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'rte-content',
        'aria-label': ariaLabel,
        style: `min-height: ${minHeight}px`,
      },
    },
  });

  // Keep the editable flag in sync when `disabled` flips.
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  if (!editor) {
    return (
      <div className="rte" aria-label={ariaLabel}>
        <div className="rte-content" style={{ minHeight }}>
          Loading editor…
        </div>
      </div>
    );
  }

  const insertImage = (url: string) => {
    if (!url.trim()) return;
    editor.chain().focus().setImage({ src: url.trim() }).run();
  };

  const applyLink = () => {
    const url = linkUrl.trim();
    if (!url) {
      editor.chain().focus().unsetLink().run();
    } else {
      editor
        .chain()
        .focus()
        .setLink({ href: url.startsWith('http') ? url : `https://${url}` })
        .run();
    }
    setLinkOpen(false);
    setLinkUrl('');
  };

  const openLinkDialog = () => {
    setLinkUrl(editor.getAttributes('link').href ?? '');
    setLinkOpen(true);
  };

  const onImageClick = () => {
    if (onImageRequest) {
      onImageRequest(insertImage);
      return;
    }
    setImageUrl('');
    setImageOpen(true);
  };

  return (
    <div className="rte">
      <div className="rte-toolbar" role="toolbar" aria-label="Formatting">
        <MenuButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive('bold')}
          title="Bold"
          disabled={disabled}
        >
          <Bold size={15} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive('italic')}
          title="Italic"
          disabled={disabled}
        >
          <Italic size={15} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive('underline')}
          title="Underline"
          disabled={disabled}
        >
          <Underline size={15} />
        </MenuButton>
        <span className="rte-divider" aria-hidden />
        <MenuButton
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 1 }).run()
          }
          active={editor.isActive('heading', { level: 1 })}
          title="Heading 1"
          disabled={disabled}
        >
          <Heading1 size={15} />
        </MenuButton>
        <MenuButton
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
          active={editor.isActive('heading', { level: 2 })}
          title="Heading 2"
          disabled={disabled}
        >
          <Heading2 size={15} />
        </MenuButton>
        <MenuButton
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 3 }).run()
          }
          active={editor.isActive('heading', { level: 3 })}
          title="Heading 3"
          disabled={disabled}
        >
          <Heading3 size={15} />
        </MenuButton>
        <span className="rte-divider" aria-hidden />
        <MenuButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive('bulletList')}
          title="Bullet list"
          disabled={disabled}
        >
          <List size={15} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive('orderedList')}
          title="Numbered list"
          disabled={disabled}
        >
          <ListOrdered size={15} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          active={editor.isActive('blockquote')}
          title="Quote"
          disabled={disabled}
        >
          <Quote size={15} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          active={editor.isActive('codeBlock')}
          title="Code block"
          disabled={disabled}
        >
          <Code size={15} />
        </MenuButton>
        <span className="rte-divider" aria-hidden />
        <MenuButton
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          active={editor.isActive({ textAlign: 'left' })}
          title="Align left"
          disabled={disabled}
        >
          <AlignLeft size={15} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          active={editor.isActive({ textAlign: 'center' })}
          title="Align center"
          disabled={disabled}
        >
          <AlignCenter size={15} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
          active={editor.isActive({ textAlign: 'right' })}
          title="Align right"
          disabled={disabled}
        >
          <AlignRight size={15} />
        </MenuButton>
        <span className="rte-divider" aria-hidden />
        <MenuButton
          onClick={openLinkDialog}
          active={editor.isActive('link')}
          title="Link"
          disabled={disabled}
        >
          <LinkIcon size={15} />
        </MenuButton>
        <MenuButton
          onClick={onImageClick}
          title="Insert image"
          disabled={disabled}
        >
          <ImageIcon size={15} />
        </MenuButton>
        <span className="rte-divider" aria-hidden />
        <MenuButton
          onClick={() => editor.chain().focus().undo().run()}
          title="Undo"
          disabled={disabled || !editor.can().undo()}
        >
          <Undo size={15} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().redo().run()}
          title="Redo"
          disabled={disabled || !editor.can().redo()}
        >
          <Redo size={15} />
        </MenuButton>
      </div>
      <EditorContent editor={editor} />

      <Modal
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        title="Insert link"
      >
        <label className="field">
          URL
          <input
            type="url"
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            placeholder="https://example.com"
            autoFocus
          />
        </label>
        <p className="muted-note muted-note--gap-top">
          Leave empty to remove the link from the selected text.
        </p>
        <div className="form-actions">
          <button
            type="button"
            className="button"
            onClick={() => setLinkOpen(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button button--accent"
            onClick={applyLink}
          >
            Apply link
          </button>
        </div>
      </Modal>

      <Modal
        open={imageOpen}
        onClose={() => setImageOpen(false)}
        title="Insert image"
      >
        <label className="field">
          Image URL
          <input
            type="url"
            value={imageUrl}
            onChange={(event) => setImageUrl(event.target.value)}
            placeholder="https://example.com/image.png"
            autoFocus
          />
        </label>
        <div className="form-actions">
          <button
            type="button"
            className="button"
            onClick={() => setImageOpen(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button button--accent"
            onClick={() => {
              insertImage(imageUrl);
              setImageOpen(false);
            }}
            disabled={!imageUrl.trim()}
          >
            Insert image
          </button>
        </div>
      </Modal>
    </div>
  );
}

export type { Editor };
