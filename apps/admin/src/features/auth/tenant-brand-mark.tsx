import { useState } from 'react'
import { Logo } from '@/assets/logo'
import { mediaUrl } from '@/lib/utils'
import type { BrandMark } from './branding'

/**
 * The tenant's brand mark on the auth pages — rendered EXACTLY the way
 * the storefront header renders the same tenant (StoreBrand), from
 * the same display mode (`branding.display`, systems[0].display):
 *
 * - 'logo': the store logo on its own, as-is (wide/short logos keep
 *   their shape, `h-10 w-auto`) — no name, no tile beside it.
 * - 'name+logo': the storefront favicon (32px) beside the store name.
 * - 'name': the store name alone.
 *
 * There is no initials tile: the storefront never renders one. A
 * plain <img> (not SafeImage) is deliberate here: SafeImage degrades
 * to a "No Image" picture on error, while a brand mark must degrade
 * to the name text. A broken image URL therefore falls through to
 * the name instead of showing a placeholder.
 */
export function TenantBrandMark({ mark }: { mark: BrandMark }) {
  const [imgFailed, setImgFailed] = useState(false)

  if (mark.kind === 'logo' && mark.src && !imgFailed) {
    return (
      <img
        src={mediaUrl(mark.src)}
        alt={mark.name ? `${mark.name} logo` : 'Store logo'}
        className='h-10 w-auto max-w-60 object-contain'
        onError={() => setImgFailed(true)}
      />
    )
  }

  if (mark.kind === 'favicon' && mark.src && !imgFailed) {
    return (
      <span className='flex items-center gap-2'>
        <img
          src={mediaUrl(mark.src)}
          alt=''
          className='size-8 rounded-[3px] object-contain'
          onError={() => setImgFailed(true)}
        />
        <h1 className='text-base font-medium tracking-tight'>{mark.name}</h1>
      </span>
    )
  }

  if (mark.kind === 'name' && mark.name) {
    return (
      <h1 className='text-base font-medium tracking-tight'>{mark.name}</h1>
    )
  }

  return (
    <span className='flex size-10 items-center justify-center rounded-[3px] border bg-background'>
      <Logo className='size-5' />
    </span>
  )
}
