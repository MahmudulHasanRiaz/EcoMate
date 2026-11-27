import { useState } from 'react'
import { Logo } from '@/assets/logo'
import { mediaUrl } from '@/lib/utils'
import type { BrandMark } from './branding'

/**
 * The tenant's brand mark on the auth pages — the store's own logo,
 * else its admin favicon in a tile, else an indigo initials tile from
 * the store name, else the generic EcoMate mark.
 *
 * A plain <img> (not SafeImage) is deliberate here: SafeImage degrades
 * to a "No Image" picture on error, while a brand mark must degrade to
 * the initials tile. A broken image URL therefore falls through to
 * initials instead of showing a placeholder.
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
      <span className='flex size-10 items-center justify-center rounded-[3px] border bg-background'>
        <img
          src={mediaUrl(mark.src)}
          alt={mark.name ? `${mark.name} icon` : 'Store icon'}
          className='size-7 object-contain'
          onError={() => setImgFailed(true)}
        />
      </span>
    )
  }

  if (mark.initials) {
    return (
      <span
        // Brand tile: the tenant's own colour (scoped --auth-brand from
        // AuthLayout), not the admin's fixed --primary.
        className='flex size-10 items-center justify-center rounded-[3px] bg-(--auth-brand) text-base font-semibold text-white'
        aria-hidden
      >
        {mark.initials}
      </span>
    )
  }

  return (
    <span className='flex size-10 items-center justify-center rounded-[3px] border bg-background'>
      <Logo className='size-5' />
    </span>
  )
}
