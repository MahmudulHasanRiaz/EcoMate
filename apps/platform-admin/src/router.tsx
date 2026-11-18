import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
} from '@tanstack/react-router';
import { AppShell } from './components/app-shell';
import { AcceptInvitePage } from './pages/accept-invite';
import { AccountPage } from './pages/account';
import { AuditPage } from './pages/audit';
import { BillingPage } from './pages/billing';
import { DomainsPage } from './pages/domains';
import { LandingPage } from './pages/landing';
import { LeadsPage } from './pages/leads';
import { LoginPage } from './pages/login';
import { MediaPage } from './pages/media';
import { MetricsPage } from './pages/metrics';
import { OverviewPage } from './pages/overview';
import { PlansPage } from './pages/plans';
import { SettingsPage } from './pages/settings';
import { DEFAULT_SETTINGS_SECTION } from './pages/settings/sections';
import { TenantCreatePage } from './pages/tenant-create';
import { TenantDetailPage } from './pages/tenant-detail';
import { TenantsPage } from './pages/tenants';
import { UsagePage } from './pages/usage';
import { UsersPage } from './pages/users';

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => (
    <AppShell>
      <OverviewPage />
    </AppShell>
  ),
});

const tenantsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tenants',
  component: () => (
    <AppShell>
      <TenantsPage />
    </AppShell>
  ),
});

const tenantRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tenants/$tenantId',
  component: () => (
    <AppShell>
      <TenantDetailPage />
    </AppShell>
  ),
});

// Static segment wins over the $tenantId param, so /tenants/new never
// reaches the detail page (previously it did — "uuid is expected", F1).
// ?leadId= pre-fills the form from a lead (Batch 1, C1 convert flow).
const tenantCreateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tenants/new',
  validateSearch: (search: Record<string, unknown>): { leadId?: string } => ({
    leadId:
      typeof search.leadId === 'string' && search.leadId.length > 0
        ? search.leadId
        : undefined,
  }),
  component: () => (
    <AppShell>
      <TenantCreatePage />
    </AppShell>
  ),
});

const plansRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/plans',
  component: () => (
    <AppShell>
      <PlansPage />
    </AppShell>
  ),
});

const leadsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/leads',
  component: () => (
    <AppShell>
      <LeadsPage />
    </AppShell>
  ),
});

const landingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/landing',
  component: () => (
    <AppShell>
      <LandingPage />
    </AppShell>
  ),
});

const mediaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/media',
  component: () => (
    <AppShell>
      <MediaPage />
    </AppShell>
  ),
});

const billingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/billing',
  component: () => (
    <AppShell>
      <BillingPage />
    </AppShell>
  ),
});

const domainsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/domains',
  component: () => (
    <AppShell>
      <DomainsPage />
    </AppShell>
  ),
});

const usageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/usage',
  component: () => (
    <AppShell>
      <UsagePage />
    </AppShell>
  ),
});

const metricsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/metrics',
  component: () => (
    <AppShell>
      <MetricsPage />
    </AppShell>
  ),
});

// /settings redirects to the first registry section; /settings/$sectionId
// renders the section (SettingsPage renders its own AppShell so it can
// pass the settings nav column as secondaryNav).
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: () => (
    <Navigate
      to="/settings/$sectionId"
      params={{ sectionId: DEFAULT_SETTINGS_SECTION.id }}
    />
  ),
});

const settingsSectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/$sectionId',
  component: SettingsPage,
});

const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/users',
  component: () => (
    <AppShell>
      <UsersPage />
    </AppShell>
  ),
});

const auditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/audit',
  component: () => (
    <AppShell>
      <AuditPage />
    </AppShell>
  ),
});

const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/account',
  component: () => (
    <AppShell>
      <AccountPage />
    </AppShell>
  ),
});

const acceptInviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/accept-invite',
  component: AcceptInvitePage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  acceptInviteRoute,
  overviewRoute,
  tenantsRoute,
  tenantRoute,
  tenantCreateRoute,
  leadsRoute,
  billingRoute,
  domainsRoute,
  usageRoute,
  metricsRoute,
  plansRoute,
  landingRoute,
  mediaRoute,
  settingsRoute,
  settingsSectionRoute,
  usersRoute,
  auditRoute,
  accountRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
