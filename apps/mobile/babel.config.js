// Expo-Standard plus babel-plugin-inline-import: Die generierten Drizzle-Migrationen
// (src/local-db/migrations/migrations.js) importieren ihre SQL-Dateien, das Plugin bündelt sie als
// Zeichenfolgen (https://orm.drizzle.team/docs/connect-expo-sqlite). Jest nutzt dieselbe Konfiguration.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [['inline-import', { extensions: ['.sql'] }]],
  };
};
