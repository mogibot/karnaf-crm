import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth, type Role } from '@/auth/auth-context';
import { t, type TranslationKey } from '@/lib/i18n';
import { useShortcutHelp } from '@/lib/useKeyboardShortcuts';
import { ShortcutHelp } from './ShortcutHelp';

// Three-tier visibility: sales_rep + viewer get only the lead-pipeline basics;
// mia (CRM manager) adds analytics + AI tuning surfaces; users + system health
// stay owner/admin only. See plans/imperative-chasing-stallman.md §1.1.
type NavTier = 'staff' | 'manager' | 'admin';
const TIER_ROLES: Record<NavTier, Role[]> = {
  staff: ['owner', 'admin', 'mia', 'sales_rep', 'viewer'],
  manager: ['owner', 'admin', 'mia'],
  admin: ['owner', 'admin'],
};

interface NavItem { to: string; labelKey: TranslationKey; end?: boolean; tier: NavTier; icon: ReactNode; }

const NAV: NavItem[] = [
  { to: '/', labelKey: 'nav_dashboard', end: true, tier: 'staff', icon: <IconDashboard /> },
  { to: '/leads', labelKey: 'nav_leads', tier: 'staff', icon: <IconUsers /> },
  { to: '/queue', labelKey: 'nav_queue', tier: 'staff', icon: <IconInbox /> },
  { to: '/analytics', labelKey: 'nav_analytics', tier: 'manager', icon: <IconChart /> },
  { to: '/admin/prompts', labelKey: 'nav_prompts', tier: 'manager', icon: <IconSparkles /> },
  { to: '/admin/product', labelKey: 'nav_product', tier: 'manager', icon: <IconBriefcase /> },
  { to: '/admin/objections', labelKey: 'nav_objections', tier: 'manager', icon: <IconChat /> },
  { to: '/admin/reviews', labelKey: 'nav_reviews', tier: 'manager', icon: <IconStar /> },
  { to: '/admin/users', labelKey: 'nav_users', tier: 'admin', icon: <IconShield /> },
  { to: '/admin/health', labelKey: 'nav_health', tier: 'admin', icon: <IconHeart /> },
];

export function Layout() {
  const auth = useAuth();
  const role = auth.role;
  const visible = role ? NAV.filter((item) => TIER_ROLES[item.tier].includes(role)) : [];
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  const initials = getInitials(auth.user?.email);

  return (
    <div className="min-h-screen">
      <a
        href="#kf-main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-brand-700 focus:px-3 focus:py-2 focus:text-sm focus:text-white"
      >
        {t('skip_to_main')}
      </a>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/70">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:gap-6">
          <Link to="/" className="group flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white shadow-sm transition group-hover:bg-brand-700" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 7l8 5 8-5M4 7v10l8 5 8-5V7M4 7l8-5 8 5" />
              </svg>
            </span>
            <span className="text-base font-semibold text-slate-900 sm:text-lg">Karnaf <span className="text-brand-700">CRM</span></span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" role="navigation" aria-label={t('app_name')}>
            {visible.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition',
                    isActive
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span aria-hidden="true" className="text-current opacity-80">{item.icon}</span>
                    <span aria-current={isActive ? 'page' : undefined}>{t(item.labelKey)}</span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="ms-auto flex items-center gap-2 sm:gap-3">
            <div className="hidden items-center gap-3 sm:flex">
              <div className="text-end">
                <div className="text-sm font-medium text-slate-700 leading-tight">{auth.user?.email}</div>
                <div className="text-xs text-slate-500 leading-tight">{auth.role}</div>
              </div>
              <span
                aria-hidden="true"
                title={auth.user?.email ?? ''}
                className="grid h-9 w-9 place-items-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700 ring-1 ring-brand-500/20"
              >{initials}</span>
            </div>
            <button type="button" onClick={() => auth.signOut()} className="kf-btn kf-btn-ghost hidden sm:inline-flex">
              {t('sign_out')}
            </button>
            <button
              type="button"
              aria-label={mobileOpen ? 'סגירת תפריט' : 'פתיחת תפריט'}
              aria-expanded={mobileOpen}
              aria-controls="kf-mobile-nav"
              className="kf-btn kf-btn-ghost md:hidden"
              onClick={() => setMobileOpen((v) => !v)}
            >
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                {mobileOpen ? (
                  <path strokeLinecap="round" d="M5 5l10 10M15 5L5 15" />
                ) : (
                  <path strokeLinecap="round" d="M3 6h14M3 10h14M3 14h14" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {mobileOpen ? (
          <div id="kf-mobile-nav" className="border-t border-slate-200 bg-white md:hidden">
            <nav
              className="mx-auto flex max-w-7xl flex-col gap-1 px-2 py-2"
              role="navigation"
              aria-label={t('app_name')}
            >
              {visible.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    clsx(
                      'flex items-center gap-2 rounded-md px-3 py-3 text-sm font-medium',
                      isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-100',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span aria-hidden="true">{item.icon}</span>
                      <span aria-current={isActive ? 'page' : undefined}>{t(item.labelKey)}</span>
                    </>
                  )}
                </NavLink>
              ))}
              <div className="mt-2 flex items-center justify-between gap-3 border-t border-slate-100 px-3 pt-2">
                <div className="min-w-0 text-sm">
                  <div className="truncate text-slate-700">{auth.user?.email}</div>
                  <div className="text-xs text-slate-500">{auth.role}</div>
                </div>
                <button type="button" className="kf-btn shrink-0" onClick={() => auth.signOut()}>{t('sign_out')}</button>
              </div>
            </nav>
          </div>
        ) : null}
      </header>
      {mobileOpen ? (
        <button
          type="button"
          aria-label="סגירת תפריט"
          className="fixed inset-0 z-20 bg-slate-900/20 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <main id="kf-main" tabIndex={-1} className="mx-auto max-w-7xl p-4 sm:p-6">
        <Outlet />
      </main>

      <GlobalShortcuts />
    </div>
  );
}

function GlobalShortcuts() {
  const { open, close } = useShortcutHelp();
  return <ShortcutHelp open={open} onClose={close} />;
}

function getInitials(email?: string | null): string {
  if (!email) return '?';
  const local = email.split('@')[0] ?? '';
  const cleaned = local.replace(/[^A-Za-z֐-׿]+/g, ' ').trim();
  if (!cleaned) return email.slice(0, 1).toUpperCase();
  const parts = cleaned.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]).join('').toUpperCase();
}

function IconDashboard() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="3" width="6" height="8" rx="1.5" /><rect x="11" y="3" width="6" height="4" rx="1.5" />
      <rect x="11" y="9" width="6" height="8" rx="1.5" /><rect x="3" y="13" width="6" height="4" rx="1.5" />
    </svg>
  );
}
function IconUsers() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="7" cy="8" r="3" /><path d="M2 17c.7-2.7 3-4.3 5-4.3S11.3 14.3 12 17" />
      <circle cx="14" cy="7" r="2.3" /><path d="M13 13c1.6 0 4.6.7 5 4" />
    </svg>
  );
}
function IconInbox() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M3 12l2.4-7H14.6L17 12v3.5A1.5 1.5 0 0 1 15.5 17h-11A1.5 1.5 0 0 1 3 15.5V12Z" />
      <path d="M3 12h4l1.4 2h3.2L13 12h4" />
    </svg>
  );
}
function IconChart() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path strokeLinecap="round" d="M3 17V7M8 17V3M13 17v-7M18 17V9" />
    </svg>
  );
}
function IconShield() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M10 2.5l6 2.2v5.6c0 3.7-2.6 6.5-6 7.2-3.4-.7-6-3.5-6-7.2V4.7l6-2.2Z" />
      <path strokeLinecap="round" d="m7.5 10 1.7 1.8L13 8" />
    </svg>
  );
}
function IconSparkles() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 3v3M10 14v3M3 10h3M14 10h3M5 5l2 2M13 13l2 2M15 5l-2 2M5 15l2-2" />
    </svg>
  );
}
function IconBriefcase() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="6" width="14" height="10" rx="1.5" />
      <path strokeLinecap="round" d="M7 6V4.5A1.5 1.5 0 0 1 8.5 3h3A1.5 1.5 0 0 1 13 4.5V6" />
      <path strokeLinecap="round" d="M3 11h14" />
    </svg>
  );
}
function IconChat() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 6.5A2.5 2.5 0 0 1 5.5 4h9A2.5 2.5 0 0 1 17 6.5v5A2.5 2.5 0 0 1 14.5 14H8l-3.5 3v-3A2.5 2.5 0 0 1 3 11.5z" />
    </svg>
  );
}
function IconHeart() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 16.5s-6.5-3.6-6.5-8.5a3.5 3.5 0 0 1 6.5-1.86A3.5 3.5 0 0 1 16.5 8c0 4.9-6.5 8.5-6.5 8.5z" />
    </svg>
  );
}
function IconStar() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path strokeLinecap="round" strokeLinejoin="round" d="m10 2.5 2.4 4.85 5.35.78-3.87 3.78.91 5.32L10 14.7l-4.78 2.52.91-5.32-3.87-3.78 5.35-.78z" />
    </svg>
  );
}
