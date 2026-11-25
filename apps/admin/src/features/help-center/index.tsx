import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { ShopifyConnectTutorial } from './shopify-connect-tutorial'

export interface HelpSection {
  id: string
  title: string
  summary: string
  Content: () => React.JSX.Element
}

/**
 * Help Center sections — static content only (no CMS, no backend). Add a
 * future tutorial by appending one entry here; the page renders any section
 * in this list the same way.
 */
export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'shopify-connect',
    title: 'Shopify store connect korben kivabe',
    summary:
      'Shopify store EcoMate-er sathe connect kora — custom app, scope, ar Test Connection, dhap-e dhap-e.',
    Content: ShopifyConnectTutorial,
  },
]

export function HelpCenterPage() {
  const [openId, setOpenId] = useState<string | null>(
    HELP_SECTIONS[0]?.id ?? null,
  )

  return (
    <>
      <Header fixed>
        <h1 className="font-semibold">Help Center</h1>
        <div className="ml-auto flex items-center gap-2">
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        <p className="mb-4 text-sm text-muted-foreground">
          EcoMate bebohar korar tutorial ar nirdeshona — ekhane paben.
        </p>
        <div className="space-y-4">
          {HELP_SECTIONS.map(({ id, title, summary, Content }) => {
            const open = openId === id
            return (
              <Card key={id} className="rounded-[4px] py-0">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : id)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-2 px-5 py-4 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-semibold">{title}</span>
                    <span className="mt-0.5 block text-sm text-muted-foreground">
                      {summary}
                    </span>
                  </span>
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                      open && 'rotate-180',
                    )}
                  />
                </button>
                {open && (
                  <CardContent className="border-t px-5 py-5">
                    <Content />
                  </CardContent>
                )}
              </Card>
            )
          })}
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Aro tutorial ashle ekhane jog hobe.
        </p>
      </Main>
    </>
  )
}
