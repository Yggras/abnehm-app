// Vollständiges V1-Schema der lokalen Kontodatenbank (Spezifikation 0, Abschnitt 8). Neue Tabellen
// nur hier eintragen; `drizzle.config.ts` und die Datenbank-Handles lesen diese Datei.
export * from './accounts';
export * from './plan';
export * from './nutrition';
export * from './trackers';
export * from './game';
export * from './notifications';
export * from './projections';
export * from './device';

/**
 * Spalten, die auch den Partner nennen können. Lokal liegt nur die eigene Person, deshalb haben sie
 * hier – anders als in Postgres – keinen Fremdschlüssel auf `person`.
 */
export const partnerPersonColumns = [
  'coupling.person_low_id',
  'coupling.person_high_id',
  'coupling_member.person_id',
  'shared_action.requester_person_id',
  'island_field.owner_person_id',
  'island_object.owner_person_id',
  'island_event.responsible_person_id',
  'challenge.proposer_person_id',
  'encouragement.sender_person_id',
  'encouragement.recipient_person_id',
  'partner_summary.owner_person_id',
  'partner_daily_goal_status.owner_person_id',
] as const;
