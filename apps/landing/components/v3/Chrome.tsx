'use client';

/**
 * v3 site chrome: floating nav pill, footer, mobile dock + desktop FAB.
 *
 * Copy comes from `useLanding()` (header/footer/dock keys); contact URLs
 * are content data in the `dock` key, not hardcoded links. Branding
 * comes from GET /public/branding (lib/branding.ts via the provider,
 * env fallback); nav and footer links are managed in the console
 * (Landing CMS `nav` + `footerLinks` sections).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Menu, Moon, Sun } from 'lucide-react';
import { useLanding } from '@/components/shell/useLanding';
import { buildHttpUrl, buildTelUrl, buildWhatsAppUrl } from '@/lib/contact';
import {
  CalendarIcon,
  CallIcon,
  ChatIcon,
  CloseIcon,
  MessengerIcon,
  WhatsAppIcon,
} from './BrandIcons';

export function MkHeader({
  drawerOpen: controlledOpen,
  onDrawerChange,
  // R-PRICING-NAV: when the platform has no public plans the pricing
  // section hides itself (MkPricing returns null), so the #pricing nav
  // link would point at a missing anchor. LandingV3 passes
  // plans.length > 0; standalone pages omit it and keep the link.
  hasPricing = true,
}: {
  // Controlled by LandingV3 so the dock can hide with the drawer; standalone
  // pages omit both and the drawer manages itself locally.
  drawerOpen?: boolean;
  onDrawerChange?: (open: boolean) => void;
  hasPricing?: boolean;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const drawerOpen = controlledOpen ?? internalOpen;
  const setDrawerOpen = onDrawerChange ?? setInternalOpen;
  const { content, locale, branding, toggleLocale, toggleTheme, theme } = useLanding();
  const header = content.header;
  const dock = content.dock;
  const nav = hasPricing
    ? header.nav
    : header.nav.filter((item) => item.href !== '#pricing');
  const logoUrl = branding?.logoUrl.trim() ?? '';
  const brandName = branding?.siteName.trim() || 'EcoMate';
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const callUrl = buildTelUrl(dock.callNumber);
  const whatsappUrl = buildWhatsAppUrl(dock.whatsapp);
  const messengerUrl = buildHttpUrl(dock.messengerUrl);

  const close = () => setDrawerOpen(false);

  // Focus the panel on open; return focus to the trigger on close.
  // The ref guard skips the initial mount so page load never steals focus.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (drawerOpen) {
      panelRef.current?.focus();
    } else if (wasOpen.current) {
      triggerRef.current?.focus();
    }
    wasOpen.current = drawerOpen;
  }, [drawerOpen]);

  // Esc closes; Tab cycles inside the panel (lightweight focus trap).
  const onPanelKey = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;
    const focusable = panelRef.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0] as HTMLElement;
    const last = focusable[focusable.length - 1] as HTMLElement;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <header className="mk-nav">
        <div className="mk-nav-bar">
          <a href="#top" className="mk-logo" aria-label={brandName}>
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={brandName}
                width={26}
                height={26}
                className="mk-logo-img motion-img is-loaded"
                loading="eager"
                decoding="async"
                onLoad={(e) => e.currentTarget.classList.add('is-loaded')}
              />
            ) : (
              <span className="mk-logo-mark" aria-hidden="true">
                E
              </span>
            )}
            {brandName}
          </a>
          <nav className="mk-nav-links" aria-label="Primary">
            {nav.map((item) => (
              <a key={`${item.label}-${item.href}`} href={item.href}>
                {item.label}
              </a>
            ))}
          </nav>
          <div className="mk-nav-right">
            <button
              type="button"
              className="mk-lang"
              data-active={locale}
              onClick={toggleLocale}
              aria-label={locale === 'en' ? 'Switch to Bangla' : 'Switch to English'}
            >
              <span className="mk-lang-thumb" aria-hidden="true" />
              <span className="mk-lang-opt" data-on={locale === 'bn'}>
                বাং
              </span>
              <span className="mk-lang-opt" data-on={locale === 'en'}>
                EN
              </span>
            </button>
            <button
              type="button"
              className="mk-icon-btn"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {theme === 'dark' ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
            </button>
            <a href="/sign-in" className="mk-signin">
              {header.signInLabel}
            </a>
            <a href="/signup" className="mk-btn mk-btn-primary mk-btn-sm mk-nav-cta">
              {header.ctaStartTrial}
            </a>
            <button
              ref={triggerRef}
              type="button"
              className="mk-icon-btn mk-nav-burger"
              onClick={() => setDrawerOpen(true)}
              aria-expanded={drawerOpen}
              aria-controls="mk-nav-drawer"
              aria-label="Open navigation menu"
            >
              <Menu size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      {drawerOpen && (
        <div
          className="mk-drawer-scrim"
          onClick={close}
          aria-hidden="true"
        />
      )}
      <div
        ref={panelRef}
        id="mk-nav-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Site navigation"
        tabIndex={-1}
        data-open={drawerOpen}
        className="mk-drawer motion-drawer"
        onKeyDown={onPanelKey}
        aria-hidden={!drawerOpen}
        inert={!drawerOpen}
      >
        <div className="mk-drawer-head">
          <span className="mk-logo">{brandName}</span>
          <button
            type="button"
            className="mk-icon-btn"
            onClick={close}
            aria-label="Close navigation menu"
          >
            <CloseIcon size={17} />
          </button>
        </div>
        <nav aria-label="Mobile">
          {nav.map((item) => (
            <a key={`${item.label}-${item.href}`} href={item.href} onClick={close} className="mk-drawer-link">
              {item.label}
            </a>
          ))}
          {/* SaaS: returning owners need a sign-in path on mobile too. */}
          <a href="/sign-in" onClick={close} className="mk-drawer-link">
            {header.signInLabel}
          </a>
        </nav>
        <div className="mk-drawer-row">
          <button
            type="button"
            className="mk-lang"
            data-active={locale}
            onClick={() => {
              toggleLocale();
              close();
            }}
            aria-label={locale === 'en' ? 'Switch to Bangla' : 'Switch to English'}
          >
            <span className="mk-lang-thumb" aria-hidden="true" />
            <span className="mk-lang-opt" data-on={locale === 'bn'}>
              বাং
            </span>
            <span className="mk-lang-opt" data-on={locale === 'en'}>
              EN
            </span>
          </button>
          <button
            type="button"
            className="mk-icon-btn"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
          </button>
        </div>
        <a href="/signup" onClick={close} className="mk-btn mk-btn-primary mk-btn-block">
          {header.ctaStartTrial}
        </a>
        <div className="mk-drawer-contact">
          {callUrl && (
            <a href={callUrl} className="mk-drawer-contact-btn" aria-label={dock.callLabel}>
              <CallIcon size={16} />
              {dock.callLabel}
            </a>
          )}
          {whatsappUrl && (
            <a href={whatsappUrl} target="_blank" rel="noreferrer" className="mk-drawer-contact-btn mk-drawer-contact-btn-wa" aria-label={dock.whatsappLabel}>
              <WhatsAppIcon size={16} />
              {dock.whatsappLabel}
            </a>
          )}
          {messengerUrl && (
            <a href={messengerUrl} target="_blank" rel="noreferrer" className="mk-drawer-contact-btn mk-drawer-contact-btn-ms" aria-label={dock.messengerLabel}>
              <MessengerIcon size={16} />
              {dock.messengerLabel}
            </a>
          )}
        </div>
      </div>
    </>
  );
}

export function MkFooter({ hasPricing = true }: { hasPricing?: boolean } = {}) {
  const { content } = useLanding();
  const footer = content.footer;
  // Same R-PRICING-NAV rule as the header: no plans, no dead #pricing link.
  const platform = hasPricing
    ? footer.capabilities
    : footer.capabilities.filter((item) => item.href !== '#pricing');

  return (
    <footer className="mk-footer">
      <div className="mk-w">
        <div className="mk-foot-grid">
          <div>
            <b>EcoMate</b>
            <p>{footer.tagline}</p>
          </div>
          <div>
            <b>{footer.linksTitle}</b>
            {platform.map((item) => (
              <a key={`${item.label}-${item.href}`} href={item.href}>
                {item.label}
              </a>
            ))}
          </div>
          <div>
            <b>{footer.contactTitle}</b>
            <a href={`tel:${footer.phone.replace(/[^+0-9]/g, '')}`}>{footer.phone}</a>
            <a href={`mailto:${footer.email}`}>{footer.email}</a>
            <a href="#demo">{content.dock.demoLabel}</a>
          </div>
        </div>
        <div className="mk-foot-base">
          {footer.copyright} · <a href="/privacy">{footer.privacyLabel}</a> ·{' '}
          <a href="/terms">{footer.termsLabel}</a>
        </div>
      </div>
    </footer>
  );
}

export function MkDock({ drawerOpen = false }: { drawerOpen?: boolean }) {
  const { content } = useLanding();
  const dock = content.dock;
  const [open, setOpen] = useState(false);
  // Smart hide: the dock slides away on scroll down and returns on scroll up
  // or near the top/bottom. Passive listener + rAF throttle; a ~10px dead zone
  // stops jitter. It also stays hidden while the nav drawer is open.
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;
    const onScroll = (): void => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const y = window.scrollY;
        const delta = y - lastY;
        lastY = y;
        const nearTop = y < 80;
        const nearBottom = window.innerHeight + y > document.body.scrollHeight - 80;
        if (nearTop || nearBottom) {
          setHidden(false);
        } else if (Math.abs(delta) > 10) {
          setHidden(delta > 0);
        }
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // All four endpoints resolve through the contact builders: a blank or
  // unparseable CMS value hides that action instead of linking nowhere.
  const callUrl = buildTelUrl(dock.callNumber);
  const whatsappUrl = buildWhatsAppUrl(dock.whatsapp);
  const messengerUrl = buildHttpUrl(dock.messengerUrl);

  const fan = (x: string, y: string, delay: string): React.CSSProperties =>
    ({ '--x': x, '--y': y, '--d': delay }) as React.CSSProperties;

  return (
    <>
      {/* Desktop: FAB with a four-icon quarter-circle fan-out (mockup-exact
          offsets and stagger). Hidden icons stay out of the tab order. */}
      <div className="mk-fab" data-open={open}>
        <a
          href={dock.demoUrl}
          className="mk-fab-item mk-fab-item-demo"
          style={fan('-0px', '-96px', '.18s')}
          aria-label={dock.demoLabel}
          title={dock.demoLabel}
          tabIndex={open ? 0 : -1}
        >
          <CalendarIcon size={17} />
        </a>
        {callUrl && (
          <a
            href={callUrl}
            className="mk-fab-item"
            style={fan('-48px', '-83px', '.12s')}
            aria-label={dock.callLabel}
            title={dock.callLabel}
            tabIndex={open ? 0 : -1}
          >
            <CallIcon size={17} />
          </a>
        )}
        {whatsappUrl && (
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noreferrer"
            className="mk-fab-item mk-fab-item-wa"
            style={fan('-83px', '-48px', '.06s')}
            aria-label={dock.whatsappLabel}
            title={dock.whatsappLabel}
            tabIndex={open ? 0 : -1}
          >
            <WhatsAppIcon size={17} />
          </a>
        )}
        {messengerUrl && (
          <a
            href={messengerUrl}
            target="_blank"
            rel="noreferrer"
            className="mk-fab-item mk-fab-item-ms"
            style={fan('-96px', '0px', '0s')}
            aria-label={dock.messengerLabel}
            title={dock.messengerLabel}
            tabIndex={open ? 0 : -1}
          >
            <MessengerIcon size={17} />
          </a>
        )}
        <button
          type="button"
          className="mk-fab-main motion-dock-press"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-label={dock.fabLabel}
        >
          {open ? <CloseIcon size={20} /> : <ChatIcon size={20} />}
        </button>
      </div>

      {/* Mobile: help text + big demo button + three icon actions in a row. */}
      <div className="mk-dock" data-hidden={hidden || drawerOpen} aria-hidden={drawerOpen} inert={drawerOpen}>
        <span className="mk-dock-help">
          <span className="mk-pulse-dot" aria-hidden="true" />
          {dock.helpLabel}
        </span>
        <a href={dock.demoUrl} className="mk-btn mk-btn-primary motion-press">
          <CalendarIcon size={18} />
          {dock.demoLabel}
        </a>
        {callUrl && (
          <a
            href={callUrl}
            className="mk-dock-icon motion-dock-press"
            aria-label={dock.callLabel}
            title={dock.callLabel}
          >
            <CallIcon size={17} />
          </a>
        )}
        {whatsappUrl && (
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noreferrer"
            className="mk-dock-icon mk-dock-icon-wa"
            aria-label={dock.whatsappLabel}
            title={dock.whatsappLabel}
          >
            <WhatsAppIcon size={19} />
          </a>
        )}
        {messengerUrl && (
          <a
            href={messengerUrl}
            target="_blank"
            rel="noreferrer"
            className="mk-dock-icon mk-dock-icon-ms"
            aria-label={dock.messengerLabel}
            title={dock.messengerLabel}
          >
            <MessengerIcon size={19} />
          </a>
        )}
      </div>
    </>
  );
}
