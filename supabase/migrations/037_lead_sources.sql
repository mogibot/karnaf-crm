-- Editable lead-sources registry. Replaces the hard-coded ALLOWED_SOURCES
-- Set inside the leads-intake function so a new channel (TikTok ads,
-- LinkedIn, a partner referral form) can be enabled without a deploy.
-- The slug is the wire-format value; display_name is what the CRM
-- shows in filters and analytics.

CREATE TABLE IF NOT EXISTS public.lead_sources (
  slug          text PRIMARY KEY,
  display_name  text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 100,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_sources_active
  ON public.lead_sources (is_active, sort_order);

CREATE OR REPLACE FUNCTION public.touch_lead_sources_updated_at()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_lead_sources_updated_at ON public.lead_sources;
CREATE TRIGGER trg_lead_sources_updated_at
  BEFORE UPDATE ON public.lead_sources
  FOR EACH ROW EXECUTE FUNCTION public.touch_lead_sources_updated_at();

-- Seed the existing allowlist so post-migration prod behaviour matches
-- pre-migration. New rows are added through the admin UI.
INSERT INTO public.lead_sources (slug, display_name, sort_order) VALUES
  ('landing_page',     'דף נחיתה',         10),
  ('webinar',          'וובינר',           20),
  ('responder_form',   'טופס מענה',         30),
  ('lead_magnet',      'לקוח מגנט',         40),
  ('whatsapp_direct',  'WhatsApp ישיר',     50),
  ('instagram_dm',     'אינסטגרם DM',       60),
  ('manual_entry',     'הזנה ידנית',        70),
  ('screenshot_manual','צילום מסך ידני',    80),
  ('unknown',          'לא ידוע',          999)
ON CONFLICT (slug) DO NOTHING;
