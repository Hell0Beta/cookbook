// Monorepo Metro config — SDK 54's expo/metro-config enables symlinks and
// package exports by default; this makes the workspace root a watch folder
// so @cookbook/shared (pnpm workspace symlink) and edits outside apps/mobile
// hot-reload (Expo monorepo docs setup).
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

module.exports = config;
