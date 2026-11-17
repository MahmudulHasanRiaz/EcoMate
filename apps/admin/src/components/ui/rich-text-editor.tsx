'use client'

import { useCallback, useRef, useState } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import ImageExtension from '@tiptap/extension-image'
import LinkExtension from '@tiptap/extension-link'
import PlaceholderExtension from '@tiptap/extension-placeholder'
import TextAlignExtension from '@tiptap/extension-text-align'
import UnderlineExtension from '@tiptap/extension-underline'
import { Bold, Italic, Underline, Code, List, ListOrdered, Quote, Heading1, Heading2, Heading3, Undo, Redo, Link, Image, AlignLeft, AlignCenter, AlignRight, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

interface RichTextEditorProps {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  minHeight?: number
  disabled?: boolean
  className?: string
}

const MenuButton = ({ onClick, active, children, title }: { onClick: () => void; active?: boolean; children: React.ReactNode; title?: string }) => (
  <button
    type='button'
    onClick={onClick}
    title={title}
    className={cn(
      'h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors',
      active && 'bg-accent text-accent-foreground'
    )}
  >
    {children}
  </button>
)

const Divider = () => <div className='w-px h-5 bg-border mx-0.5' />

// WordPress-imported descriptions often store line breaks as literal "\n"
// (backslash-n) or raw newlines. Convert them to <br> so TipTap renders
// actual line breaks instead of showing "\n" or collapsing them.
function normalizeNewlines(html: string): string {
  if (!html) return html
  const isHTML = /<[a-z][\s\S]*>/i.test(html)
  let p = html.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\r\n/g, '\n')
  if (!isHTML) return p.replace(/\n/g, '<br>')
  return p
}

export function RichTextEditor({ value, onChange, placeholder = 'Start writing...', minHeight = 250, disabled = false, className }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      UnderlineExtension,
      TextAlignExtension.configure({ types: ['heading', 'paragraph'] }),
      ImageExtension.configure({ inline: false, allowBase64: true }),
      LinkExtension.configure({ openOnClick: false }),
      PlaceholderExtension.configure({ placeholder }),
    ],
    content: normalizeNewlines(value) || '',
    onUpdate: ({ editor }) => {
      const html = editor.getHTML()
      onChange(html === '<p></p>' ? '' : html)
    },
    editable: !disabled,
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[200px] px-4 py-3',
      },
    },
  })

  // In-app URL prompt (replaces the browser's native prompt dialog): the
  // keeps the editor selection — editor.chain().focus() restores it.
  const [urlPrompt, setUrlPrompt] = useState<{
    kind: 'image' | 'link'
    initial: string
  } | null>(null)
  const [urlValue, setUrlValue] = useState('')

  const addImage = useCallback(() => {
    setUrlValue('')
    setUrlPrompt({ kind: 'image', initial: '' })
  }, [])

  const addLink = useCallback(() => {
    if (!editor) return
    const previousUrl = editor.getAttributes('link').href || ''
    setUrlValue(previousUrl)
    setUrlPrompt({ kind: 'link', initial: previousUrl })
  }, [editor])

  const submitUrlPrompt = useCallback(() => {
    if (!urlPrompt || !editor) return
    const url = urlValue.trim()
    if (urlPrompt.kind === 'image') {
      if (url) editor.chain().focus().setImage({ src: url }).run()
      setUrlPrompt(null)
      return
    }
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      setUrlPrompt(null)
      return
    }
    // Auto-add https:// for external links without protocol
    // so example.com → https://example.com instead of relative path
    const hasProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)
    const isRelative = url.startsWith('/') || url.startsWith('#') || url.startsWith('?')
    const finalUrl = !hasProtocol && !isRelative ? `https://${url}` : url
    editor.chain().focus().extendMarkRange('link').setLink({ href: finalUrl }).run()
    setUrlPrompt(null)
  }, [editor, urlPrompt, urlValue])

  if (!editor) return null

  return (
    <div className={cn('border rounded-lg overflow-hidden bg-background', disabled && 'opacity-60 pointer-events-none', className)}>
      <div className='flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b bg-muted/30'>
        <MenuButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title='Bold'><Bold className='h-4 w-4' /></MenuButton>
        <MenuButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title='Italic'><Italic className='h-4 w-4' /></MenuButton>
        <MenuButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title='Underline'><Underline className='h-4 w-4' /></MenuButton>
        <MenuButton onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} title='Code'><Code className='h-4 w-4' /></MenuButton>
        <Divider />
        <MenuButton onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title='Heading 1'><Heading1 className='h-4 w-4' /></MenuButton>
        <MenuButton onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title='Heading 2'><Heading2 className='h-4 w-4' /></MenuButton>
        <MenuButton onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title='Heading 3'><Heading3 className='h-4 w-4' /></MenuButton>
        <Divider />
        <MenuButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title='Bullet List'><List className='h-4 w-4' /></MenuButton>
        <MenuButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title='Ordered List'><ListOrdered className='h-4 w-4' /></MenuButton>
        <MenuButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title='Blockquote'><Quote className='h-4 w-4' /></MenuButton>
        <Divider />
        <MenuButton onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title='Align Left'><AlignLeft className='h-4 w-4' /></MenuButton>
        <MenuButton onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title='Align Center'><AlignCenter className='h-4 w-4' /></MenuButton>
        <MenuButton onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title='Align Right'><AlignRight className='h-4 w-4' /></MenuButton>
        <Divider />
        <MenuButton onClick={addLink} active={editor.isActive('link')} title='Link'><Link className='h-4 w-4' /></MenuButton>
        <MenuButton onClick={addImage} title='Image'><Image className='h-4 w-4' /></MenuButton>
        <MenuButton onClick={() => editor.chain().focus().setHorizontalRule().run()} title='Horizontal Rule'><Minus className='h-4 w-4' /></MenuButton>
        <div className='flex-1' />
        <MenuButton onClick={() => editor.chain().focus().undo().run()} title='Undo'><Undo className='h-4 w-4' /></MenuButton>
        <MenuButton onClick={() => editor.chain().focus().redo().run()} title='Redo'><Redo className='h-4 w-4' /></MenuButton>
      </div>
      <EditorContent editor={editor} className='[&_.tiptap]:outline-none' />
      <Dialog
        open={urlPrompt !== null}
        onOpenChange={(open) => {
          if (!open) setUrlPrompt(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {urlPrompt?.kind === 'image' ? 'Insert image' : 'Insert link'}
            </DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              submitUrlPrompt()
            }}
          >
            <Input
              value={urlValue}
              onChange={(event) => setUrlValue(event.target.value)}
              placeholder={
                urlPrompt?.kind === 'image'
                  ? 'https://example.com/image.png'
                  : 'https://example.com'
              }
              autoFocus
            />
            <DialogFooter className='mt-4'>
              <Button type='button' variant='outline' onClick={() => setUrlPrompt(null)}>
                Cancel
              </Button>
              <Button type='submit'>
                {urlPrompt?.kind === 'image' ? 'Insert image' : 'Apply link'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
