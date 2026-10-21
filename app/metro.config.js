// Metro bundles the app's JavaScript. The shared core lives next door in ../shared,
// so tell Metro to watch that folder too, and to find its packages (like phoenix)
// in the app's own node_modules.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.watchFolders = [path.resolve(__dirname, '../shared')];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];

module.exports = config;
