/**
 * Shopify connect tutorial — static Help Center content (no CMS, no backend).
 *
 * Live-proven on the test store (ecomate-test) 2026-11-25: custom app in the
 * Shopify store admin, Client ID + Client Secret connect, Test Connection
 * auto-creates the 4 webhooks, product push works, orders auto-arrive as
 * Pending, Cancelled push works. Delivered → Fulfilled is NOT working yet
 * (dead endpoint, fix pending) — so this tutorial never claims it.
 *
 * Language: simple Bangla, Smart Mix — Shopify/EcoMate UI terms stay in
 * ENGLISH exactly as they appear on screen.
 */

const SCOPES = [
  'read_products',
  'write_products',
  'read_orders',
  'write_orders',
  'read_fulfillments',
  'write_fulfillments',
  'read_inventory',
  'write_inventory',
  'read_locations',
] as const

const WEBHOOK_TOPICS = [
  'orders/create',
  'orders/updated',
  'orders/delete',
  'products/update',
] as const

function Step({
  n,
  title,
  children,
}: {
  n: number
  title: string
  children: React.ReactNode
}) {
  return (
    <section aria-label={title} className="space-y-2">
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <span
          aria-hidden="true"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
        >
          {n}
        </span>
        <span>{title}</span>
      </h3>
      <div className="space-y-2 pl-8 text-sm leading-relaxed">{children}</div>
    </section>
  )
}

function Ordered({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal space-y-1 pl-5">{children}</ol>
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-[4px] border bg-muted/50 p-3 text-sm leading-relaxed">
      {children}
    </p>
  )
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[4px] border border-destructive/50 bg-destructive/[0.04] p-3">
      <p className="text-sm font-semibold text-destructive">Sotorko thakun</p>
      <div className="mt-1 space-y-1 text-sm leading-relaxed">{children}</div>
    </div>
  )
}

function Ui({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-[4px] bg-muted px-1 py-0.5 font-mono text-[13px]">
      {children}
    </code>
  )
}

export function ShopifyConnectTutorial() {
  return (
    <div className="space-y-6">
      <p className="text-sm leading-relaxed text-muted-foreground">
        Ei tutorial-e Shopify store EcoMate-er sathe connect korar sothik rasta
        ache — dhap-e dhap-e. Amra nije amader test store-e ei rasta diye
        connect korechi.
      </p>

      <section aria-label="Age ja lagbe" className="space-y-2">
        <h3 className="text-base font-semibold">Age ja lagbe</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
          <li>Shopify store-er owner/admin access — Shopify admin-e dhukte parben</li>
          <li>EcoMate tenant admin login</li>
        </ul>
      </section>

      <Step n={1} title="Shopify admin-e custom app banan">
        <Ordered>
          <li>
            Shopify admin-e jan: <Ui>Settings</Ui> → <Ui>Apps and sales channels</Ui>{' '}
            → <Ui>Develop apps</Ui>
          </li>
          <li>
            <Ui>Allow custom app development</Ui> ON koren
          </li>
          <li>
            <Ui>Create an app</Ui> chapen, app-er naam den: <Ui>EcoMate</Ui>
          </li>
          <li>
            <Ui>Create app</Ui> chapen
          </li>
        </Ordered>
        <Note>
          Jodi <Ui>Develop apps</Ui> dekhte na pan, tahole EcoMate support-ke
          janan — onno kono rasta try korben na.
        </Note>
      </Step>

      <Step n={2} title="Scope set koren">
        <Ordered>
          <li>
            App-er <Ui>Configuration</Ui> tab-e jan →{' '}
            <Ui>Admin API access scopes</Ui>
          </li>
          <li>Ei 9-ta scope on koren:</li>
        </Ordered>
        <ul className="flex flex-wrap gap-1.5">
          {SCOPES.map((s) => (
            <li key={s}>
              <code className="rounded-[4px] bg-muted px-1.5 py-0.5 font-mono text-[13px]">
                {s}
              </code>
            </li>
          ))}
        </ul>
        <Ordered>
          <li>
            <Ui>Save</Ui> chapen, tarpor <Ui>Install app</Ui> chapen
          </li>
        </Ordered>
        <Note>
          Webhook-er jonno kono alada scope nei. <Ui>read_webhooks</Ui> ba{' '}
          <Ui>write_webhooks</Ui> bole kichu khujben na — Shopify-te egula
          ekhon ar nei. Order ar product-er scope diyei webhook kaj kore.
        </Note>
      </Step>

      <Step n={3} title="Customer data access on koren">
        <Ordered>
          <li>
            Shopify Partner Dashboard-e app-ta khulen → <Ui>API Access</Ui> →{' '}
            <Ui>Protected Customer Data Access</Ui> → <Ui>Manage</Ui> chapen
          </li>
          <li>
            <Ui>Protected customer fields</Ui> theke ei 4-ta field on koren:{' '}
            <Ui>Name</Ui>, <Ui>Address</Ui>, <Ui>Email</Ui>, <Ui>Phone</Ui> — ar
            karon (reason) select koren
          </li>
        </Ordered>
        <Note>
          Ei step-ta na korle order asbe, kintu customer-er naam, phone,
          thikana kichui asbe na — order <Ui>Guest</Ui> hoye dekhabe.
        </Note>
      </Step>

      <Step n={4} title="API key ar API secret nen">
        <Ordered>
          <li>
            App-er <Ui>API credentials</Ui> theke <Ui>Client ID</Ui> ar{' '}
            <Ui>Client Secret</Ui> copy koren
          </li>
          <li>Dui-ta alada kore kothao likhe rakhen — pore EcoMate-te lagbe</li>
        </Ordered>
        <Warning>
          <p>
            <Ui>Client Secret</Ui>-er jaygay <Ui>Admin API access token</Ui>{' '}
            bosaben NA.
          </p>
          <p>
            Admin API access token ar Client Secret — duita ALADA jinis. Token
            bosale connect hobe na, ar{' '}
            <Ui>
              install the app on the store… approve the app version
            </Ui>{' '}
            — ei error asbe. Amader prothom try-te eitai hoyechilo, onek somoy
            noshto hoyeche. Secret nite hobe <Ui>API credentials</Ui> thekei —
            token theke na.
          </p>
        </Warning>
      </Step>

      <Step n={5} title="EcoMate-te connect koren">
        <Ordered>
          <li>
            EcoMate admin-e jan: <Ui>Sales Channels</Ui> → <Ui>Stores</Ui>
          </li>
          <li>
            <Ui>Connect store</Ui> button chapen
          </li>
          <li>
            Provider theke <Ui>Shopify</Ui> select koren
          </li>
          <li>
            Boshan: <Ui>Store name</Ui>, <Ui>Shop domain</Ui> (jemon:{' '}
            <Ui>apnar-dokan.myshopify.com</Ui>), <Ui>Client ID</Ui>,{' '}
            <Ui>Client Secret</Ui>
          </li>
          <li>
            <Ui>Create store</Ui> chapen —{' '}
            <Ui>Store registered — run Test Connection to verify</Ui> dekhabe
          </li>
        </Ordered>
      </Step>

      <Step n={6} title="Test Connection chapen">
        <Ordered>
          <li>
            Store-er page-e <Ui>Test Connection</Ui> chapen
          </li>
          <li>
            Connection check hobe, ar 4-ta webhook nije theke banabe:{' '}
            {WEBHOOK_TOPICS.map((t) => (
              <Ui key={t}>{t}</Ui>
            )).reduce<React.ReactNode[]>(
              (acc, el, i) => (i === 0 ? [el] : [...acc, ', ', el]),
              [],
            )}
          </li>
          <li>Shopify-te giye nije theke webhook banate hobe NA</li>
          <li>
            <Ui>Connection verified</Ui> dekhalei kaj sesh. Tarpor Sync
            configuration theke <Ui>Save &amp; Complete</Ui> chapen.
          </li>
        </Ordered>
        <Note>
          Jodi <Ui>install the app… approve the app version</Ui> error ashe —
          tahole Step 4 abar check koren: Client Secret-er jaygay token bosano
          hoyeche kina; ar app-ta store-e install ache kina dekhen.
        </Note>
      </Step>

      <section aria-label="Connect korar por ki hobe" className="space-y-2">
        <h3 className="text-base font-semibold">Connect korar por ki hobe</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
          <li>
            EcoMate theke product Shopify-te push kora jay (<Ui>Push to store</Ui>)
          </li>
          <li>
            Shopify-te notun order hole EcoMate-te nije theke chole ashe,{' '}
            <Ui>Pending</Ui> hoye thake — nije theke Confirmed hoy na
          </li>
          <li>
            EcoMate-te order Cancel korle Shopify-teo Cancelled hoy
          </li>
        </ul>
        <Note>
          Ekta kaj ekhono ashe nai: EcoMate-te order Delivered korle Shopify-te
          ekhono Fulfilled hoy na — eta amra thik korchi.
        </Note>
      </section>

      <section aria-label="Somossha hole" className="space-y-2">
        <h3 className="text-base font-semibold">Somossha hole</h3>
        <ul className="space-y-2 text-sm leading-relaxed">
          <li>
            <span className="font-medium">
              <Ui>install the app… approve the app version</Ui> error ashe:
            </span>{' '}
            Client Secret-e Admin API access token bosano hoyeche (Step 4).
            Asol Client Secret boshan.
          </li>
          <li>
            <span className="font-medium">Test Connection fail kore:</span>{' '}
            Shop domain thik ache kina dekhen (
            <Ui>apnar-dokan.myshopify.com</Ui>), Client ID ar Client Secret
            abar copy kore boshan.
          </li>
          <li>
            <span className="font-medium">
              Order Guest hoye ashe, naam/phone/thikana nai:
            </span>{' '}
            Step 3 kora hoy nai — customer data field (Name, Address, Email,
            Phone) on koren.
          </li>
          <li>
            <span className="font-medium">
              Webhook-er scope khuje pacchen na:
            </span>{' '}
            scope-ta Shopify-te nei; alada kore khujben na (Step 2).
          </li>
          <li>
            <span className="font-medium">Develop apps dekhte pacchen na:</span>{' '}
            EcoMate support-ke janan.
          </li>
        </ul>
      </section>
    </div>
  )
}
