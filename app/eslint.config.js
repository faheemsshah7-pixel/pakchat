// The linter's rules: Expo's recommended set (React, hooks, imports).
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['android/*', 'spike-check/*', 'modules/*/android/*'],
  },
  // Every promise must be waited for (await), handled (.catch), or marked "on
  // purpose" with `void`. Forgetting an await on a file copy once broke voice notes.
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    // eslint-disable-next-line no-undef
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: __dirname } },
    rules: { '@typescript-eslint/no-floating-promises': 'error' },
  },
]);
