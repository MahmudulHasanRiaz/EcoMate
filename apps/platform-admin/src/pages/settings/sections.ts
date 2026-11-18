import type { ComponentType } from 'react';
import {
  Clock,
  CreditCard,
  Globe,
  Mail,
  Palette,
  Percent,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { PaymentMethod, PlatformSettings } from '../../types';
import { BrandingSection } from './branding';
import { LandingSection } from './landing';
import { MaintenanceSection } from './maintenance';
import { PaymentMethodsSection } from './payment-methods';
import { SmtpSection } from './smtp';
import { TaxSection } from './tax';
import { TrialSection } from './trial';

/**
 * Settings sections registry — the extensibility point for the console
 * Settings area. Adding a section is one registry row + one component
 * file: the route is a param route (/settings/$sectionId), so no router
 * edit is needed, and the nav (desktop column + mobile tabs) renders
 * from this list.
 *
 * Each section owns its form state and save calls; the Settings page
 * shell owns the shared data (settings + methods), the notice/error
 * banners, and the reload that follows a save.
 */
export interface SettingsSectionProps {
  settings: PlatformSettings | null;
  methods: PaymentMethod[];
  /** A save succeeded: show the notice and reload the shared data. */
  onSaved: (message: string) => void;
  /** Show a page-level error ('' clears it). */
  onError: (message: string) => void;
}

export interface SettingsSectionDef {
  /** URL id: /settings/<id>. */
  id: string;
  label: string;
  icon: LucideIcon;
  /** Nav group heading; groups render in first-seen order. */
  group: string;
  component: ComponentType<SettingsSectionProps>;
}

export const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  {
    id: 'branding',
    label: 'Branding',
    icon: Palette,
    group: 'General',
    component: BrandingSection,
  },
  {
    id: 'trial',
    label: 'Trial defaults',
    icon: Clock,
    group: 'General',
    component: TrialSection,
  },
  {
    id: 'payment-methods',
    label: 'Payment methods',
    icon: CreditCard,
    group: 'Billing',
    component: PaymentMethodsSection,
  },
  {
    id: 'tax',
    label: 'Tax',
    icon: Percent,
    group: 'Billing',
    component: TaxSection,
  },
  {
    id: 'smtp',
    label: 'SMTP and email',
    icon: Mail,
    group: 'Email',
    component: SmtpSection,
  },
  {
    id: 'maintenance',
    label: 'Maintenance',
    icon: Wrench,
    group: 'Platform',
    component: MaintenanceSection,
  },
  {
    id: 'landing',
    label: 'Landing',
    icon: Globe,
    group: 'Website',
    component: LandingSection,
  },
];

/** The section /settings redirects to (the first registry row). */
export const DEFAULT_SETTINGS_SECTION = SETTINGS_SECTIONS[0]!;

export function getSettingsSection(
  id: string | undefined,
): SettingsSectionDef | undefined {
  if (!id) return undefined;
  return SETTINGS_SECTIONS.find((section) => section.id === id);
}

/** Group labels in first-seen registry order. */
export function settingsGroups(): string[] {
  const groups: string[] = [];
  for (const section of SETTINGS_SECTIONS) {
    if (!groups.includes(section.group)) groups.push(section.group);
  }
  return groups;
}
