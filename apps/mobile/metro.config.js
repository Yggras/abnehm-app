const { getDefaultConfig } = require('expo/metro-config');

// Metro muss die SQL-Dateien der Drizzle-Migrationen auflösen können; den Inhalt bündelt
// babel-plugin-inline-import (https://orm.drizzle.team/docs/connect-expo-sqlite).
const config = getDefaultConfig(__dirname);
config.resolver.sourceExts.push('sql');

module.exports = config;
