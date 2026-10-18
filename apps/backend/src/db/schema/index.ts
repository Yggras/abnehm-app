// Vollständiges V1-Schema des Servers (Spezifikation 0, Abschnitt 8). Die Better-Auth-Tabellen
// ergänzt das Auth-Modul. Neue Tabellen nur hier eintragen; `drizzle.config.ts` liest diese Datei.
export * from './accounts.ts';
export * from './plan.ts';
export * from './nutrition.ts';
export * from './trackers.ts';
export * from './game.ts';
export * from './notifications.ts';
export * from './projections.ts';
export * from './sync.ts';
