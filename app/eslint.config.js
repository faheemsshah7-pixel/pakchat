// The linter's rules: Expo's recommended set (React, hooks, imports).
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['android/*', 'spike-check/*', 'modules/*/android/*'],
  },
]);
