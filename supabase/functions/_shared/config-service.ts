import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface RuntimeConfig {
  activeHours: {
    start: string;
    end: string;
    timezone: string;
  };
  followUpDelays: {
    firstResponseMinutes: number;
    nurtureHours: number;
    paymentPendingHours: number;
  };
}

const defaultRuntimeConfig: RuntimeConfig = {
  activeHours: {
    start: '09:00',
    end: '21:00',
    timezone: 'Asia/Jerusalem',
  },
  followUpDelays: {
    firstResponseMinutes: 30,
    nurtureHours: 24,
    paymentPendingHours: 12,
  },
};

export async function getRuntimeConfig(supabase: SupabaseClient): Promise<RuntimeConfig> {
  const { data, error } = await supabase
    .from('crm_config')
    .select('config_key, config_value');

  if (error || !data) {
    return defaultRuntimeConfig;
  }

  const map = new Map<string, unknown>();
  for (const row of data) {
    map.set(row.config_key, row.config_value);
  }

  const activeHours = map.get('active_hours') as RuntimeConfig['activeHours'] | undefined;
  const followUpDelays = map.get('follow_up_delays') as RuntimeConfig['followUpDelays'] | undefined;

  return {
    activeHours: activeHours || defaultRuntimeConfig.activeHours,
    followUpDelays: followUpDelays || defaultRuntimeConfig.followUpDelays,
  };
}
