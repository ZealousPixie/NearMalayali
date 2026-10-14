import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { env } from './env';
import { chunkedSecureStorage } from './secure-storage';

// When the backend isn't configured yet we still create a client against a
// dummy URL so imports don't crash; the root layout shows a setup screen
// instead of making any calls.
export const supabase = createClient(
  env.isConfigured ? env.supabaseUrl : 'https://not-configured.invalid',
  env.isConfigured ? env.supabaseAnonKey : 'not-configured',
  {
    auth: {
      storage: chunkedSecureStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);

// Refresh tokens only while the app is in the foreground (Supabase's
// recommendation for React Native).
AppState.addEventListener('change', (state) => {
  if (!env.isConfigured) return;
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
