import { Check, ChevronsUpDown } from 'lucide-react'
import { toast } from 'sonner'
import { authClient } from '@/lib/better-auth-client'
import { sessionRedirect } from '@/lib/session-redirect'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/**
 * Org (store) switcher — Phase 3 tenant cutover (tenant = organization).
 *
 * Lists the orgs the user belongs to (`useListOrganizations`) and switches
 * the active one (`organization.setActive`). The backend resolves the
 * tenant from the Host header, not from the session's active org, so
 * switching stores also navigates to that store's host:
 * `https://<slug>.<base>/admin/`, where `<base>` is the current host minus
 * its first label (the current store's slug). On a custom-domain host the
 * base cannot be derived, so the switch only sets the active org and
 * reloads the current page.
 *
 * Only renders when the user belongs to more than one org — a single-store
 * user has nothing to switch.
 */
/**
 * The store host for a slug, derived from the current host. Exported (and
 * taking the host as an argument) so the URL math is unit-testable: the
 * test browser runs on `localhost`, where no base host is derivable and
 * the switch always takes the reload path.
 */
export function orgHostUrl(host: string, slug: string): string | null {
  const currentSlug = host.split('.')[0]
  if (slug === currentSlug) return null
  const parts = host.split('.')
  if (parts.length < 3) return null // custom domain: base not derivable
  const base = parts.slice(1).join('.')
  return `https://${slug}.${base}/admin/`
}

export function OrgSwitcher() {
  const { data: organizations } = authClient.useListOrganizations()
  const { data: activeOrganization } = authClient.useActiveOrganization()

  if (!organizations || organizations.length < 2) return null

  const active = activeOrganization

  async function handleSelect(orgId: string, slug: string) {
    if (active?.id === orgId) return
    try {
      const { error } = await authClient.organization.setActive({
        organizationId: orgId,
      })
      if (error) {
        toast.error('Could not switch store. Please try again.')
        return
      }
    } catch {
      toast.error('Could not switch store. Please try again.')
      return
    }
    const url = orgHostUrl(window.location.hostname, slug)
    if (url) {
      sessionRedirect.assign(url)
    } else {
      // Custom-domain host: no other host to navigate to — reload so the
      // shell re-bootstraps against the newly active org.
      sessionRedirect.reload()
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          className='h-8 max-w-55 gap-1.5 rounded-md px-2 text-xs font-medium'
          aria-label='Switch store'
        >
          <span className='min-w-0 truncate'>
            {active?.name ?? 'Switch store'}
          </span>
          <ChevronsUpDown className='size-3.5 shrink-0 text-muted-foreground' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className='min-w-55 rounded-md border-border/60 p-1 shadow-md'
        align='start'
        sideOffset={4}
      >
        <DropdownMenuLabel className='px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>
          Switch store
        </DropdownMenuLabel>
        {organizations.map((org) => {
          const isActive = org.id === active?.id
          return (
            <DropdownMenuItem
              key={org.id}
              onClick={() => handleSelect(org.id, org.slug)}
              className='flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium'
            >
              <span className='grid min-w-0 flex-1 leading-tight'>
                <span className='truncate font-semibold'>{org.name}</span>
                <span className='truncate text-[10px] opacity-80'>
                  {org.slug}
                </span>
              </span>
              {isActive && <Check className='size-3.5 shrink-0' />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
