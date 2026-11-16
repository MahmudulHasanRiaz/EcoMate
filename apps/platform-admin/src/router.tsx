import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';
import { AppShell } from './components/app-shell';
import { BillingPage } from './pages/billing';
import { DomainsPage } from './pages/domains';
import { LoginPage } from './pages/login';
import { MetricsPage } from './pages/metrics';
import { OverviewPage } from './pages/overview';
import { PlansPage } from './pages/plans';
import { SettingsPage } from './pages/settings';
import { TenantDetailPage } from './pages/tenant-detail';
import { TenantsPage } from './pages/tenants';
import { UsagePage } from './pages/usage';

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

const plansRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/plans',
  component: () => (
    <AppShell>
      <PlansPage />
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

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: () => (
    <AppShell>
      <SettingsPage />
    </AppShell>
  ),
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  overviewRoute,
  tenantsRoute,
  tenantRoute,
  billingRoute,
  domainsRoute,
  usageRoute,
  metricsRoute,
  plansRoute,
  settingsRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
