import { Link } from '@tanstack/react-router';
import { Settings as SettingsIcon } from 'lucide-react';
import { ScrollableTabs } from '../../components/ui';
import { SETTINGS_SECTIONS, settingsGroups } from './sections';

/**
 * Settings nav — StackMate SettingsShell pattern: a 240px column beside
 * the main nav rail, with a brand block ("Settings") and the sections
 * grouped under headings. Desktop only (the shell hides it ≤900px).
 * No "Back to admin" link: unlike StackMate, the main nav rail stays
 * visible beside this column, so every console page is one click away.
 */
export function SettingsNav({ activeId }: { activeId: string }) {
  return (
    <nav className="settings-nav" aria-label="Settings sections">
      <div className="settings-nav-brand">
        <SettingsIcon size={18} strokeWidth={2} aria-hidden="true" />
        <span>Settings</span>
      </div>
      {settingsGroups().map((group) => (
        <div className="settings-nav-group" key={group}>
          <div className="settings-nav-group-label">{group}</div>
          {SETTINGS_SECTIONS.filter((s) => s.group === group).map(
            (section) => {
              const Icon = section.icon;
              const active = section.id === activeId;
              return (
                <Link
                  key={section.id}
                  to="/settings/$sectionId"
                  params={{ sectionId: section.id }}
                  className={`settings-nav-link${active ? ' settings-nav-link--active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon size={16} strokeWidth={2} aria-hidden="true" />
                  <span>{section.label}</span>
                </Link>
              );
            },
          )}
        </div>
      ))}
    </nav>
  );
}

/**
 * Mobile settings nav: the same sections as a scrollable tab strip
 * (ScrollableTabs shows ‹ › buttons only while there is overflow).
 * Desktop hides this; the column nav shows instead.
 */
export function SettingsTabs({ activeId }: { activeId: string }) {
  return (
    <div className="settings-tabs">
      <ScrollableTabs label="Settings sections">
        {SETTINGS_SECTIONS.map((section) => (
          <Link
            key={section.id}
            to="/settings/$sectionId"
            params={{ sectionId: section.id }}
            role="tab"
            aria-selected={section.id === activeId}
            className="tab"
            data-active={section.id === activeId}
          >
            {section.label}
          </Link>
        ))}
      </ScrollableTabs>
    </div>
  );
}
