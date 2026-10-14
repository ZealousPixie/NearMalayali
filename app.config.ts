// Dynamic config layered on app.json, for values that differ per
// environment and must not be committed (set them in EAS environment
// variables or a local .env).
import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const androidMapsKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY;
  const easProjectId = process.env.EAS_PROJECT_ID;

  return {
    ...(config as ExpoConfig),
    plugins: [
      ...(config.plugins ?? []),
      // Android maps need a Google Maps SDK key (restricted to the app's package
      // and signing certificate). iOS uses Apple Maps and needs no key.
      ['react-native-maps', androidMapsKey ? { androidGoogleMapsApiKey: androidMapsKey } : {}],
    ],
    extra: {
      ...config.extra,
      eas: { ...(config.extra?.eas ?? {}), ...(easProjectId ? { projectId: easProjectId } : {}) },
    },
  };
};
