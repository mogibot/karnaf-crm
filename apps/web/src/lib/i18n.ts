// Minimal i18n seam. Strings live in a single dictionary file so the
// codebase has one place to swap when an English (or any other) locale
// becomes a real product requirement. Today only Hebrew is wired in.

export type Locale = 'he' | 'en';

const HE = {
  app_name: 'Karnaf CRM',
  nav_dashboard: 'מסך מצב',
  nav_leads: 'לידים',
  nav_queue: 'תורי עבודה',
  nav_analytics: 'אנליטיקה',
  nav_users: 'משתמשים',
  nav_prompts: 'תבניות AI',
  loading: 'טוען...',
  refresh: 'רענון',
  refreshing: 'מרענן...',
  error_prefix: 'שגיאה',
  sign_out: 'יציאה',
  skip_to_main: 'דלג לתוכן הראשי',
} as const;

const EN: Partial<Record<keyof typeof HE, string>> = {
  app_name: 'Karnaf CRM',
  nav_dashboard: 'Dashboard',
  nav_leads: 'Leads',
  nav_queue: 'Queues',
  nav_analytics: 'Analytics',
  nav_users: 'Users',
  nav_prompts: 'AI Prompts',
  loading: 'Loading...',
  refresh: 'Refresh',
  refreshing: 'Refreshing...',
  error_prefix: 'Error',
  sign_out: 'Sign out',
  skip_to_main: 'Skip to main content',
};

const DICTS: Record<Locale, Partial<Record<keyof typeof HE, string>>> = { he: HE, en: EN };

export type TranslationKey = keyof typeof HE;

let activeLocale: Locale = 'he';

export function setLocale(locale: Locale): void {
  activeLocale = locale;
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === 'he' ? 'rtl' : 'ltr';
}

export function getLocale(): Locale {
  return activeLocale;
}

export function t(key: TranslationKey): string {
  return DICTS[activeLocale][key] ?? HE[key];
}
