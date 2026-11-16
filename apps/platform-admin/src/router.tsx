import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';
import { AppShell } from './components/app-shell';
import { BillingPage } from './pages/billing';
import { LoginPage } from './pages/login';
import { OverviewPage } from './pages/overview';
import { PlansPage } from './pages/plans';
import { TenantDetailPage } from './pages/tenant-detail';
import { TenantsPage } from './pages/tenants';

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

const routeTree = rootRoute.addChildren([
  loginRoute,
  overviewRoute,
  tenantsRoute,
  tenantRoute,
  billingRoute,
  plansRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
