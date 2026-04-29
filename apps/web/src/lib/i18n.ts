// Minimal i18n seam. Strings live in a single dictionary file so the
// codebase has one place to swap when an English (or any other) locale
// becomes a real product requirement. Hebrew is the canonical source;
// English entries fall back to Hebrew for any key that's not translated.

export type Locale = 'he' | 'en';

const HE = {
  // Brand + chrome
  app_name: 'Karnaf CRM',
  skip_to_main: 'דלג לתוכן הראשי',

  // Navigation
  nav_dashboard: 'מסך מצב',
  nav_leads: 'לידים',
  nav_queue: 'תורי עבודה',
  nav_analytics: 'אנליטיקה',
  nav_users: 'משתמשים',
  nav_prompts: 'תבניות AI',

  // Common UI
  loading: 'טוען...',
  refresh: 'רענון',
  refreshing: 'מרענן...',
  error_prefix: 'שגיאה',
  sign_out: 'יציאה',
  sign_in: 'התחברות',
  sign_up: 'הרשמה',
  cancel: 'ביטול',
  save: 'שמירה',
  delete: 'מחיקה',
  search: 'חיפוש',
  total_count: 'סה"כ',

  // Login
  login_title: 'כניסת מפעיל',
  signup_title: 'יצירת משתמש חדש',
  email_label: 'אימייל',
  password_label: 'סיסמה',
  password_min_hint: 'לפחות 8 תווים',
  show_password: 'הצגת סיסמה',
  hide_password: 'הסתרת סיסמה',
  signing_in: 'מתחבר...',
  signing_up: 'נרשם...',
  has_account: 'כבר יש לך חשבון?',
  no_account: 'אין לך עדיין חשבון?',
  email_confirmation_sent: 'נשלח אימייל לאימות הכתובת. יש ללחוץ על הקישור ואז לחזור להתחברות.',
  account_created_pending_admin: 'המשתמש נוצר. ממתין להפעלת פרופיל על ידי מנהל המערכת.',
  password_too_short: 'הסיסמה חייבת לכלול לפחות 8 תווים',
  user_no_active_profile: 'המשתמש מחובר אך אין לו פרופיל פעיל. צרו קשר עם מנהל המערכת.',

  // Dashboard
  dashboard_title: 'מסך מצב',
  kpi_leads_today: 'לידים היום',
  kpi_unanswered: 'ממתינים למענה',
  kpi_hot_leads: 'לידים חמים',
  kpi_payment_pending: 'ממתינים לתשלום',
  kpi_sla_risk: 'סיכון SLA',
  conversion_funnel: 'משפך המרה',
  conversion_step_over_step: 'המרה שלב אחרי שלב',
  pending_queues: 'תורי עבודה ממתינים',
  to_all_queues: 'לכל התורים →',
  no_pending_items: 'אין פריטים פתוחים.',
  queues_by_type: 'תורים לפי סוג',

  // Leads
  leads_title: 'לידים',
  filter_all_statuses: 'כל הסטטוסים',
  filter_all_heat: 'כל החום',
  filter_all_ownership: 'כל הבעלויות',
  filter_clear: 'ניקוי סינונים',
  search_placeholder: 'חיפוש לפי שם / טלפון / אימייל',
  no_matching_leads: 'אין לידים תואמים.',
  table_name: 'שם',
  table_phone: 'טלפון',
  table_status: 'סטטוס',
  table_heat: 'חום',
  table_ownership: 'בעלות',
  table_score: 'ציון',
  table_updated: 'עודכן',
  pagination_prev: 'הקודם',
  pagination_next: 'הבא',
} as const;

const EN: Partial<Record<keyof typeof HE, string>> = {
  app_name: 'Karnaf CRM',
  skip_to_main: 'Skip to main content',
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
  sign_in: 'Sign in',
  sign_up: 'Sign up',
  cancel: 'Cancel',
  save: 'Save',
  delete: 'Delete',
  search: 'Search',
  total_count: 'total',
  login_title: 'Operator sign-in',
  signup_title: 'Create account',
  email_label: 'Email',
  password_label: 'Password',
  password_min_hint: 'At least 8 characters',
  show_password: 'Show password',
  hide_password: 'Hide password',
  signing_in: 'Signing in...',
  signing_up: 'Creating account...',
  has_account: 'Already have an account?',
  no_account: 'No account yet?',
  email_confirmation_sent: 'A verification email was sent. Click the link, then sign in.',
  account_created_pending_admin: 'Account created. Waiting for an admin to activate the profile.',
  password_too_short: 'Password must be at least 8 characters',
  user_no_active_profile: 'You are signed in but your profile is not active. Contact an admin.',
  dashboard_title: 'Dashboard',
  kpi_leads_today: 'Leads today',
  kpi_unanswered: 'Unanswered',
  kpi_hot_leads: 'Hot leads',
  kpi_payment_pending: 'Payment pending',
  kpi_sla_risk: 'SLA risk',
  conversion_funnel: 'Conversion funnel',
  conversion_step_over_step: 'Step-over-step conversion',
  pending_queues: 'Pending queues',
  to_all_queues: 'See all queues →',
  no_pending_items: 'No open items.',
  queues_by_type: 'Queues by type',
  leads_title: 'Leads',
  filter_all_statuses: 'All statuses',
  filter_all_heat: 'All heat',
  filter_all_ownership: 'All ownership',
  filter_clear: 'Clear filters',
  search_placeholder: 'Search by name / phone / email',
  no_matching_leads: 'No matching leads.',
  table_name: 'Name',
  table_phone: 'Phone',
  table_status: 'Status',
  table_heat: 'Heat',
  table_ownership: 'Ownership',
  table_score: 'Score',
  table_updated: 'Updated',
  pagination_prev: 'Previous',
  pagination_next: 'Next',
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
