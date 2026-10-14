// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'supabase/functions/*', '.expo/*'],
  },
  {
    rules: {
      // Apostrophes and quotes inside <Text> are fine in React Native; this
      // rule exists for HTML entities on the web.
      'react/no-unescaped-entities': 'off',
    },
  },
]);
