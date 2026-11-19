import { createBackend } from '../backend.ts';
import { readConfig } from '../config.ts';
import { openDatabase } from '../database.ts';
import { errorCodeForLog } from '../log.ts';
import type { ExpoPushPort } from '../notifications/expo-push.ts';
import type { MealVisionAnalyzer } from '../nutrition/meal-vision.ts';

// Administrativer Passwort-Reset (Spezifikation 0, Abschnitt 9): einziger Weg zu einem neuen Passwort
// ohne das alte; einen öffentlichen Reset-Ablauf gibt es nicht. Läuft auf dem Server, z. B.
//   docker compose exec backend npm run admin:reset-password --workspace @abnehm/backend -- anna@example.test
// Das neue Passwort erscheint genau einmal auf der Konsole und steht in keinem Log; alle Sitzungen
// des Kontos sind danach widerrufen.
const email = process.argv[2];
if (email === undefined || email === '') {
  console.error('Aufruf: admin:reset-password -- <E-Mail>');
  process.exit(2);
}

/**
 * Der Reset nutzt nur das Auth-Modul und beantwortet keine Anfragen. Er braucht deshalb weder den
 * API-Schlüssel der Fotoanalyse noch einen Analyzer; dieser hier wird nie aufgerufen.
 */
const withoutPhotoAnalysis: MealVisionAnalyzer = {
  analyze: () => Promise.reject(new Error('Der Passwort-Reset analysiert keine Fotos')),
};

/** Der Reset startet keine Jobs und sendet keine Pushes; dieser Port wird nie aufgerufen. */
const withoutPush: ExpoPushPort = {
  send: () => Promise.reject(new Error('Der Passwort-Reset sendet keine Pushes')),
  getReceipts: () => Promise.reject(new Error('Der Passwort-Reset sendet keine Pushes')),
};

const config = readConfig(process.env);
const database = openDatabase(config.database);
try {
  const backend = createBackend({
    database,
    authSettings: config.auth,
    invitationSettings: config.invitations,
    photoStorageDirectory: config.photoStorageDirectory,
    mealVisionAnalyzer: withoutPhotoAnalysis,
    expoPush: withoutPush,
  });
  const result = await backend.auth.admin.resetPassword(email);
  if (result.type === 'unknown_account') {
    console.error('[admin] Kein Konto mit dieser E-Mail');
    process.exitCode = 1;
  } else {
    console.log(`[admin] Neues Passwort (einmalig angezeigt): ${result.password}`);
    console.log('[admin] Alle Sitzungen des Kontos sind widerrufen.');
  }
} catch (error) {
  console.error('[admin] Fehlgeschlagen:', errorCodeForLog(error));
  process.exitCode = 1;
} finally {
  await database.close();
}
