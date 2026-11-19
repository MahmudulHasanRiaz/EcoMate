import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { apiClient } from '@/lib/api-client'
import { useFeatures } from '@/context/features-provider'
import { toast } from 'sonner'
import {
  Check,
  Copy,
  Globe,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  CUSTOM_DOMAIN_FEATURE,
  LOCKED_MESSAGE,
  domainStatusMeta,
  errorMessage,
  isForbiddenError,
  isValidHostname,
  normalizeHostnameInput,
  recheckSummary,
  type AddDomainResult,
  type DnsInstructions,
  type RecheckResult,
  type TenantDomain,
} from './lib'

function DnsRecordRow({
  label,
  record,
  copyKey,
  copiedKey,
  onCopy,
}: {
  label: string
  record: { name: string; value: string }
  copyKey: string
  copiedKey: string | null
  onCopy: (key: string, value: string) => void
}) {
  return (
    <div className='rounded-lg border p-3'>
      <p className='text-xs font-medium tracking-wide text-muted-foreground uppercase'>
        {label} record
      </p>
      <dl className='mt-2 space-y-1 text-sm'>
        <div className='flex items-start justify-between gap-2'>
          <dt className='shrink-0 text-muted-foreground'>Name</dt>
          <dd className='font-mono text-xs break-all text-right'>
            {record.name}
          </dd>
        </div>
        <div className='flex items-start justify-between gap-2'>
          <dt className='shrink-0 text-muted-foreground'>Value</dt>
          <dd className='flex min-w-0 items-start gap-1'>
            <span className='font-mono text-xs break-all'>{record.value}</span>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className='h-6 w-6 shrink-0'
              aria-label={`Copy ${label} value`}
              onClick={() => onCopy(copyKey, record.value)}
            >
              {copiedKey === copyKey ? (
                <Check className='h-3.5 w-3.5 text-green-600' />
              ) : (
                <Copy className='h-3.5 w-3.5' />
              )}
            </Button>
          </dd>
        </div>
      </dl>
    </div>
  )
}

function DnsInstructionsCard({
  host,
  dns,
  copiedKey,
  onCopy,
}: {
  host: string
  dns: DnsInstructions
  copiedKey: string | null
  onCopy: (key: string, value: string) => void
}) {
  return (
    <div className='space-y-3'>
      <p className='text-sm text-muted-foreground'>
        Add these two records at your domain provider to connect{' '}
        <span className='font-medium text-foreground'>{host}</span>. The
        CNAME routes visitors to your store; the TXT record proves you own
        the domain. EcoMate checks them automatically — no need to come
        back unless verification stalls.
      </p>
      <div className='grid gap-3 md:grid-cols-2'>
        <DnsRecordRow
          label='CNAME'
          record={dns.cname}
          copyKey={`${host}-cname`}
          copiedKey={copiedKey}
          onCopy={onCopy}
        />
        <DnsRecordRow
          label='TXT'
          record={dns.txt}
          copyKey={`${host}-txt`}
          copiedKey={copiedKey}
          onCopy={onCopy}
        />
      </div>
    </div>
  )
}

export function DomainsSettings() {
  const queryClient = useQueryClient()
  const { hasFeature, loading: featuresLoading } = useFeatures()
  const [featureDenied, setFeatureDenied] = useState(false)
  const [hostInput, setHostInput] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [addResult, setAddResult] = useState<AddDomainResult | null>(null)
  const [recheckingId, setRecheckingId] = useState<string | null>(null)
  const [recheckResults, setRecheckResults] = useState<
    Record<string, RecheckResult>
  >({})
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  // Locked when the plan lacks the feature — or when the server says so
  // (plan changed after the page loaded). The section stays visible,
  // just unusable: the tenant sees what they are missing.
  const locked =
    !featuresLoading &&
    (!hasFeature(CUSTOM_DOMAIN_FEATURE) || featureDenied)

  const {
    data: domains,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['tenant-domains'],
    queryFn: () =>
      apiClient.get<TenantDomain[]>('/settings/domains').then((r) => r.data),
    staleTime: 30_000,
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['tenant-domains'] })

  const handleCopy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedKey(key)
      window.setTimeout(
        () => setCopiedKey((current) => (current === key ? null : current)),
        2000,
      )
      toast.success('Copied to clipboard')
    } catch {
      toast.error('Could not copy — select the text manually')
    }
  }

  const handleAdd = async () => {
    const host = normalizeHostnameInput(hostInput)
    if (!isValidHostname(host)) {
      toast.error('Enter a valid domain name, e.g. shop.example.com')
      return
    }
    setIsAdding(true)
    try {
      const { data } = await apiClient.post<AddDomainResult>(
        '/settings/domains',
        { host },
      )
      setAddResult(data)
      setHostInput('')
      await invalidate()
      toast.success('Domain added — add the DNS records below to verify it')
    } catch (err) {
      if (isForbiddenError(err)) setFeatureDenied(true)
      toast.error(errorMessage(err, 'Failed to add domain'))
    } finally {
      setIsAdding(false)
    }
  }

  const handleRecheck = async (domainId: string) => {
    setRecheckingId(domainId)
    try {
      const { data } = await apiClient.post<RecheckResult>(
        `/settings/domains/${domainId}/recheck`,
        {},
      )
      setRecheckResults((prev) => ({ ...prev, [domainId]: data }))
      await invalidate()
      if (data.verified) {
        // The setup card is done once the domain verifies.
        setAddResult((prev) =>
          prev?.domain.id === domainId ? null : prev,
        )
        toast.success(recheckSummary(data))
      } else {
        toast.warning(recheckSummary(data))
      }
    } catch (err) {
      if (isForbiddenError(err)) setFeatureDenied(true)
      toast.error(errorMessage(err, 'Failed to check domain'))
    } finally {
      setRecheckingId(null)
    }
  }

  const handleRemove = async () => {
    if (!deleteId) return
    setIsDeleting(true)
    try {
      await apiClient.delete(`/settings/domains/${deleteId}`)
      setDeleteId(null)
      // The setup card describes the removed domain — clear it too.
      setAddResult((prev) => (prev?.domain.id === deleteId ? null : prev))
      setRecheckResults((prev) => {
        const next = { ...prev }
        delete next[deleteId]
        return next
      })
      await invalidate()
      toast.success('Domain removed')
    } catch (err) {
      if (isForbiddenError(err)) setFeatureDenied(true)
      toast.error(errorMessage(err, 'Failed to remove domain'))
    } finally {
      setIsDeleting(false)
    }
  }

  const deletingDomain = domains?.find((d) => d.id === deleteId)

  return (
    <div className='space-y-6'>
      <div>
        <h1 className='text-2xl font-bold tracking-tight'>Custom Domains</h1>
        <p className='text-muted-foreground'>
          Connect your own domain to your store — your customers see your
          brand, not an EcoMate subdomain.
        </p>
      </div>

      {locked ? (
        <Card>
          <CardContent className='flex flex-col items-start gap-3 py-6 sm:flex-row sm:items-center'>
            <div className='rounded-full bg-amber-100 p-3 dark:bg-amber-900/30'>
              <Lock className='h-5 w-5 text-amber-600 dark:text-amber-400' />
            </div>
            <div className='flex-1'>
              <p className='font-medium'>Custom domains are locked</p>
              <p className='text-sm text-muted-foreground'>
                {LOCKED_MESSAGE} Your store keeps working on its EcoMate
                subdomain — upgrade to a plan that includes custom domains
                to connect your own.
              </p>
            </div>
            <Button asChild variant='outline'>
              <Link to='/mon/settings/plan'>View Plan &amp; Usage</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Add a custom domain</CardTitle>
            <CardDescription>
              Enter the domain you own. We will show you two DNS records to
              add at your domain provider — verification is automatic once
              they propagate.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className='flex flex-col gap-3 sm:flex-row sm:items-end'>
              <div className='flex-1 space-y-1.5'>
                <Label htmlFor='domain-host'>Domain name</Label>
                <Input
                  id='domain-host'
                  type='text'
                  inputMode='url'
                  autoComplete='off'
                  autoCapitalize='none'
                  autoCorrect='off'
                  spellCheck={false}
                  placeholder='shop.example.com'
                  value={hostInput}
                  onChange={(e) => setHostInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void handleAdd()
                    }
                  }}
                />
              </div>
              <Button
                onClick={() => void handleAdd()}
                disabled={isAdding || featuresLoading}
              >
                {isAdding ? (
                  <>
                    <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                    Adding…
                  </>
                ) : (
                  <>
                    <Plus className='mr-2 h-4 w-4' />
                    Add domain
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {addResult?.dns ? (
        <Card>
          <CardHeader>
            <CardTitle>Set up DNS for {addResult.domain.host}</CardTitle>
            <CardDescription>
              Your domain was added. Add these records, then wait — we check
              them every minute and your store goes live on the domain as
              soon as both are found.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DnsInstructionsCard
              host={addResult.domain.host}
              dns={addResult.dns}
              copiedKey={copiedKey}
              onCopy={(key, value) => void handleCopy(key, value)}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Your domains</CardTitle>
          <CardDescription>
            Every address your store answers on. The primary domain is the
            one customers see.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className='space-y-3'>
              <Skeleton className='h-16 w-full' />
              <Skeleton className='h-16 w-full' />
            </div>
          ) : isError ? (
            <p className='py-6 text-center text-sm text-muted-foreground'>
              Could not load your domains. Please try again.
            </p>
          ) : !domains || domains.length === 0 ? (
            <p className='py-6 text-center text-sm text-muted-foreground'>
              No domains found.
            </p>
          ) : (
            <ul className='space-y-4'>
              {domains.map((domain) => {
                const meta = domainStatusMeta(domain.status)
                const recheck = recheckResults[domain.id]
                return (
                  <li key={domain.id} className='rounded-lg border p-4'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <Globe className='h-4 w-4 text-muted-foreground' />
                      <span className='font-medium break-all'>
                        {domain.host}
                      </span>
                      <Badge variant='secondary'>
                        {domain.type === 'CUSTOM' ? 'Custom' : 'Subdomain'}
                      </Badge>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                      {domain.isPrimary ? (
                        <Badge variant='default'>Primary</Badge>
                      ) : null}
                    </div>
                    <p className='mt-1 text-sm text-muted-foreground'>
                      {domain.type === 'SUBDOMAIN'
                        ? 'Your EcoMate address — always works, cannot be removed.'
                        : domain.status === 'VERIFIED' ||
                            domain.status === 'ACTIVE'
                          ? `Verified${domain.verifiedAt ? ` on ${new Date(domain.verifiedAt).toLocaleDateString()}` : ''}. Your store is live on this domain.`
                          : 'Waiting for DNS verification.'}
                    </p>

                    {domain.dns && !locked ? (
                      <div className='mt-4'>
                        <DnsInstructionsCard
                          host={domain.host}
                          dns={domain.dns}
                          copiedKey={copiedKey}
                          onCopy={(key, value) => void handleCopy(key, value)}
                        />
                      </div>
                    ) : null}

                    {recheck ? (
                      <div className='mt-3 rounded-lg border p-3 text-sm'>
                        <p className='font-medium'>
                          {recheck.verified
                            ? 'Verification passed'
                            : 'Verification check'}
                        </p>
                        <ul className='mt-1 space-y-1 text-muted-foreground'>
                          <li className='flex items-center gap-2'>
                            {recheck.checks.txt.ok ? (
                              <Check className='h-4 w-4 text-green-600' />
                            ) : (
                              <span className='text-destructive'>✗</span>
                            )}
                            TXT record{' '}
                            {recheck.checks.txt.ok ? 'found' : 'not found yet'}
                          </li>
                          <li className='flex items-center gap-2'>
                            {recheck.checks.cname.ok ? (
                              <Check className='h-4 w-4 text-green-600' />
                            ) : (
                              <span className='text-destructive'>✗</span>
                            )}
                            CNAME record{' '}
                            {recheck.checks.cname.ok
                              ? 'points to EcoMate'
                              : `not pointing to ${recheck.checks.cname.expected} yet`}
                          </li>
                        </ul>
                      </div>
                    ) : null}

                    {domain.type === 'CUSTOM' && !locked ? (
                      <div className='mt-3 flex flex-wrap gap-2'>
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={() => void handleRecheck(domain.id)}
                          disabled={recheckingId === domain.id}
                        >
                          {recheckingId === domain.id ? (
                            <>
                              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                              Checking…
                            </>
                          ) : (
                            <>
                              <RefreshCw className='mr-2 h-4 w-4' />
                              Check now
                            </>
                          )}
                        </Button>
                        <Button
                          variant='outline'
                          size='sm'
                          className='text-destructive hover:text-destructive'
                          onClick={() => setDeleteId(domain.id)}
                        >
                          <Trash2 className='mr-2 h-4 w-4' />
                          Remove
                        </Button>
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this domain?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingDomain
                ? `${deletingDomain.host} will stop serving your store. Visitors will see an error until you point the domain elsewhere. Your EcoMate subdomain keeps working. This cannot be undone.`
                : 'This cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleRemove()}
              disabled={isDeleting}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            >
              {isDeleting ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Removing…
                </>
              ) : (
                'Remove domain'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
