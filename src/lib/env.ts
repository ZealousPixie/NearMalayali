// Public build-time configuration. Only EXPO_PUBLIC_ values are available in
// the app bundle, and they are visible to anyone, so no secrets here.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

const looksLikePlaceholder = (v: string) => v === '' || v.includes('YOUR-');

export const env = {
  supabaseUrl: url,
  supabaseAnonKey: anonKey,
  /** False until real Supabase values are provided in .env. */
  isConfigured: !looksLikePlaceholder(url) && !looksLikePlaceholder(anonKey),
};

/** Versions of the legal documents shown in the app; bump when they change. */
export const LEGAL_VERSIONS = {
  terms: '2026-10',
  privacy: '2026-10',
  guidelines: '2026-10',
} as const;

export const MIN_AGE = 18;
