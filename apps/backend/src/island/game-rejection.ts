import type { CanonicalChange } from '@abnehm/contracts/sync';
import type { BuildRefusal, PlaceDecision, UpgradeRefusal } from '@abnehm/game-rules/building';

import { CommandRejection } from '../sync/commands.ts';

// Fachliche Ablehnung eines Spielbefehls (Spezifikation 4, Abschnitt 4; Spezifikation 0, Abschnitt 10): Ein
// unbekannter Katalogschlüssel ist `unknown_catalog_key`, jeder andere Grund der Spielregeln `conflict`.
// Bauen (#191), Aufwerten und Platzieren (#194) lehnen gleich ab.

/** Was die Spielregeln beim Bauen, Aufwerten oder Platzieren ablehnen. */
export type GameRefusal = BuildRefusal | UpgradeRefusal | Exclude<PlaceDecision, { type: 'erlaubt' }>;

/** Die Ablehnung zum Grund der Spielregeln, auf Wunsch mit dem kanonischen Datensatz der betroffenen Entität. */
export function gameRejection(refusal: GameRefusal, canonical: CanonicalChange | null = null): CommandRejection {
  return new CommandRejection(refusal.reason === 'unbekannter_schluessel' ? 'unknown_catalog_key' : 'conflict', canonical);
}
