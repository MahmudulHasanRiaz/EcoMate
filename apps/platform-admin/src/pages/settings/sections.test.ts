import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS_SECTION,
  getSettingsSection,
  SETTINGS_SECTIONS,
  settingsGroups,
} from './sections';

describe('settings sections registry', () => {
  it('has unique ids, labels, icons, groups and components', () => {
    const ids = SETTINGS_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const section of SETTINGS_SECTIONS) {
      expect(section.label.length).toBeGreaterThan(0);
      expect(section.icon).toBeDefined();
      expect(section.group.length).toBeGreaterThan(0);
      expect(typeof section.component).toBe('function');
    }
  });

  it('covers every section the old single-page settings had, plus Landing, Media storage and SaaS SMTP', () => {
    // The old page had 6 real sections + a Domains link card. Domains is
    // a top-level nav item, not a setting — it is intentionally absent.
    // Landing (Batch 1) is the 7th section; Media storage (media
    // library) is the 8th; SaaS SMTP (email-balance rate + expiry) is
    // the 9th; Ad tracking (CMS batch 2, item 21) is the 10th.
    expect(SETTINGS_SECTIONS.map((s) => s.id).sort()).toEqual([
      'ad-tracking',
      'branding',
      'landing',
      'maintenance',
      'media',
      'payment-methods',
      'saas-smtp',
      'smtp',
      'tax',
      'trial',
    ]);
  });

  it('defaults to the first section and looks up by id', () => {
    expect(DEFAULT_SETTINGS_SECTION.id).toBe('branding');
    expect(getSettingsSection('smtp')?.label).toBe('SMTP and email');
    expect(getSettingsSection('nope')).toBeUndefined();
    expect(getSettingsSection(undefined)).toBeUndefined();
  });

  it('groups render in first-seen order', () => {
    expect(settingsGroups()).toEqual([
      'General',
      'Billing',
      'Email',
      'Platform',
      'Website',
    ]);
  });
});
