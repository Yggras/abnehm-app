import { createSystemClock, type Clock } from '@abnehm/clock';
import type { PlanReader } from '@abnehm/contracts/ports';

import { createApp } from './app.ts';
import { createAuthModule, type AuthSettings } from './auth/auth-module.ts';
import { bundledPasswordBlocklist } from './auth/password-blocklist.ts';
import { createAuthorization, policies } from './authorization/authorization.ts';
import { couplingSyncEntities } from './coupling/coupling-entities.ts';
import { createInvitationLimiter } from './coupling/invitation-limiter.ts';
import { invitationRoutes } from './coupling/invitations.ts';
import { createInviteCodes, type InvitationSettings } from './coupling/invite-codes.ts';
import { createSharedActions } from './coupling/shared-actions.ts';
import { createUncoupling } from './coupling/uncoupling.ts';
import { dailyGoalCommands, dailyGoalCompletionEntity } from './daily-goals/completions.ts';
import { energyBookingEntity } from './energy/bookings.ts';
import { buildObjectCommand } from './island/build-object.ts';
import { challengeSyncEntities, createChallenges } from './island/challenges.ts';
import { contributeToProjectCommand } from './island/community-projects.ts';
import { placeObjectCommand, upgradeObjectCommand } from './island/object-commands.ts';
import { islandSyncEntities } from './island/island-entities.ts';
import { generateIslandEvents, islandEventCommands } from './island/island-events.ts';
import { roleChoiceKind } from './island/role-choice.ts';
import type { Database } from './database.ts';
import { createJobRegistry } from './jobs/job-registry.ts';
import { createLogout } from './logout/logout.ts';
import { nutritionEntryEntity } from './nutrition/entry-entity.ts';
import { foodFavoriteEntity } from './nutrition/food-favorite-entity.ts';
import type { MealVisionAnalyzer } from './nutrition/meal-vision.ts';
import { createMealPhotos } from './nutrition/meal-photos.ts';
import { encouragementEntity, sendEncouragementCommand, writeBackEncouragementPushStatus } from './notifications/encouragement.ts';
import type { ExpoPushPort } from './notifications/expo-push.ts';
import { createPushDelivery } from './notifications/push-delivery.ts';
import { notificationSettingEntity } from './notifications/notification-setting-entity.ts';
import { createPushInstallations } from './notifications/push-installations.ts';
import { ownFoodEntity } from './nutrition/own-food-entity.ts';
import { createPhotoDrafts } from './nutrition/photo-drafts.ts';
import { createPhotoStorage } from './nutrition/photo-storage.ts';
import { partnerProjectionEntities } from './partner-projections/entities.ts';
import { invalidatingPartnerSummaries } from './partner-projections/invalidations.ts';
import { createPartnerProjections } from './partner-projections/projections.ts';
import type { AnyPartnerSummaryProjector, ReaderPort } from './partner-projections/projector.ts';
import { sharingSyncEntities } from './partner-projections/sharing-entities.ts';
import { personTimeZoneCommand } from './person/time-zone.ts';
import { budgetSuggestionEntity } from './plan/budget-suggestion-entity.ts';
import { createGoalVersionCommand, goalVersionEntity } from './plan/goal-versions.ts';
import { postgresPlanReader } from './plan/plan-reader.ts';
import { createWeeklyPlanVersionCommand, weeklyPlanVersionEntity } from './plan/weekly-plan-versions.ts';
import { createSecurityLog } from './security-log/security-log.ts';
import { personEntity } from './sync/person-entity.ts';
import { createSync } from './sync/sync.ts';
import { trackerPartnerSummaryProjectors } from './trackers/partner-summaries.ts';
import { sportEntryEntity } from './trackers/sport-entity.ts';
import { waterEntryEntity } from './trackers/water-entity.ts';
import { weightEntryEntity } from './trackers/weight-entity.ts';

/** Systemuhr des Servers: Ohne Argument liest er in UTC, lokale Tage einer Person in ihrer Zone. */
export function serverSystemClock(): Clock {
  return createSystemClock({ timeZone: () => 'UTC' });
}

/**
 * Setzt die Module des Backends über einer Datenbank zusammen; gemeinsam genutzt von `main.ts`, den
 * Server-Kommandos und den Integrationstests. Weitere Bereiche melden ihre Jobs hier an, ohne die
 * Registry zu ändern.
 */
export function createBackend({
  database,
  authSettings,
  invitationSettings,
  clock = serverSystemClock(),
  syncPullPageSize,
  photoStorageDirectory,
  mealVisionAnalyzer,
  expoPush,
  planReader = postgresPlanReader,
  partnerSummaryProjectors = Object.values(trackerPartnerSummaryProjectors({ planReader })),
}: {
  database: Database;
  authSettings: AuthSettings;
  invitationSettings: InvitationSettings;
  /** Verzeichnis der Fotoentwürfe und der Fotoablage (`PHOTO_STORAGE_DIR`, Aufbau in `photo-storage.ts`). */
  photoStorageDirectory: string;
  /**
   * KI-Bildanalyse: produktiv der Claude-Adapter (`productionMealVisionAnalyzer`), in Tests und im
   * Development-Backend der Fake der Testfähigkeit `fake-fotoanalyse`.
   */
  mealVisionAnalyzer: MealVisionAnalyzer;
  /**
   * Expo-Push-Port des Zustellers: produktiv und im Development-Backend der HTTP-Adapter
   * (`createExpoPushClient`), in Tests der Fake der Testfähigkeit `fake-expo-push`.
   */
  expoPush: ExpoPushPort;
  /** Der Server rechnet in UTC; lokale Tage einer Person liest er mit `clock.read(person.timeZone)`. */
  clock?: Clock;
  /** Einträge je Pull-Seite; Tests wählen wenige, um mehrere Seiten zu erzwingen. */
  syncPullPageSize?: number;
  /**
   * `PlanReader` von Spezifikation 1 in der Transaktion des Aufrufers, standardmäßig über Postgres. Tests
   * der Challenge-Anteile (#210) geben den Fake mit hinterlegten Wochenplänen.
   */
  planReader?: ReaderPort<PlanReader>;
  /**
   * Partner-Projectors der Bereiche, standardmäßig die echten über Postgres. Nur Tests des
   * Projektionsmechanismus (#106) geben eigene, etwa mit dem `PlanReader`-Fake aus #104.
   */
  partnerSummaryProjectors?: readonly AnyPartnerSummaryProjector[];
}) {
  const securityLog = createSecurityLog({ database, clock });
  const auth = createAuthModule({ database, clock, securityLog, passwordBlocklist: bundledPasswordBlocklist(), settings: authSettings });
  const authorization = createAuthorization({ database, sessions: auth.sessions, clock, securityLog });
  // Fachbefehle melden hier ihre Policy an, Bereiche ebenso wie der Betrieb.
  authorization.registerCommand('passwort_reset', policies.adminCommand('passwort_reset'));
  // Sync-Entitäten und Vor-Pull-Schritte melden die Bereiche hier an, ohne den Sync-Kern zu ändern.
  const sync = createSync({ database, clock, authorization, pullPageSize: syncPullPageSize });
  sync.registerEntity(personEntity);
  sync.registerCommand(personTimeZoneCommand);
  for (const entity of couplingSyncEntities) sync.registerEntity(entity);
  // Gemeinsame Aktionen: Spezifikation 4 meldet ihre Arten an `sharedActions` an.
  const sharedActions = createSharedActions();
  for (const command of sharedActions.commands) sync.registerCommand(command);
  // Momo, Insel & Challenges (Spezifikation 4): Rollenwahl (#180), deren Annahme das Schlüpfen ist,
  // die Inselinhalte im Sync (#184), Bauen (#191), Aufwerten und Platzieren (#194) sowie Insel-Ereignisse (#202).
  sharedActions.registerKind(roleChoiceKind);
  for (const entity of islandSyncEntities) sync.registerEntity(entity);
  sync.registerCommand(buildObjectCommand);
  sync.registerCommand(upgradeObjectCommand);
  sync.registerCommand(placeObjectCommand);
  // Gemeinschaftsprojekte (#208): Einzahlen samt Projektabschluss im selben Befehl.
  sync.registerCommand(contributeToProjectCommand);
  // Insel-Ereignisse (#202): der Ereignisgenerator vor jedem Pull, Ansehen und Abholen.
  for (const command of islandEventCommands) sync.registerCommand(command);
  sync.registerPrePullStep('island_events', generateIslandEvents);
  // Entkopplungs-Kern: Spezifikation 4 meldet ihre Beobachter an, Spezifikation 5 ruft ihn aus `requestUncoupling` auf.
  const uncoupling = createUncoupling();
  // Gemeinsame Challenges (#210): Vorschlag, Annahme mit den Anteilen aus dem Wochenplan und der Verfall nach
  // 48 Stunden vor jedem Pull; beim Entkoppeln enden offene Vorschläge neutral.
  const challenges = createChallenges({ planReader });
  for (const entity of challengeSyncEntities) sync.registerEntity(entity);
  for (const command of challenges.commands) sync.registerCommand(command);
  sync.registerPrePullStep('challenge_proposals', challenges.expireProposals);
  uncoupling.registerObserver('challenges', challenges.withdrawOnUncoupling);
  // Ziele und Wochenplan (Spezifikation 1): Fassungen nur über ihre Fachbefehle; der Budgetvorschlag als
  // Upsert innerhalb der eigenen Eigentumsgrenze (#150).
  sync.registerEntity(goalVersionEntity);
  sync.registerEntity(weeklyPlanVersionEntity);
  sync.registerEntity(budgetSuggestionEntity);
  sync.registerCommand(createGoalVersionCommand);
  sync.registerCommand(createWeeklyPlanVersionCommand);
  sync.registerEntity(dailyGoalCompletionEntity);
  sync.registerEntity(energyBookingEntity);
  for (const command of dailyGoalCommands) sync.registerCommand(command);
  // Ernährung (Spezifikation 2): Einträge, eigene Lebensmittel, Lebensmittelfavoriten, Fotoentwürfe und Mahlzeitenfotos samt Fotoablage.
  const nutritionEntries = nutritionEntryEntity({ clock });
  sync.registerEntity(nutritionEntries);
  sync.registerEntity(ownFoodEntity);
  sync.registerEntity(foodFavoriteEntity);
  const photoStorage = createPhotoStorage({ directory: photoStorageDirectory });
  const photoDrafts = createPhotoDrafts({ database, clock, analyzer: mealVisionAnalyzer, storage: photoStorage });
  const mealPhotos = createMealPhotos({ database, clock, storage: photoStorage, entries: nutritionEntries });
  sync.registerEntity(mealPhotos.entity);
  sync.registerCommand(mealPhotos.confirmCommand);
  // Wasser, Sport und Gewicht (Spezifikation 3); jede Push-Annahme invalidiert die Zusammenfassung ihres Bereichs (#181).
  sync.registerEntity(invalidatingPartnerSummaries('wasser', waterEntryEntity));
  sync.registerEntity(invalidatingPartnerSummaries('gewicht', weightEntryEntity));
  sync.registerEntity(invalidatingPartnerSummaries('sport', sportEntryEntity));
  // Partner-Projektionen: Die Bereiche melden ihre Projectors an `partnerProjections` an, Spezifikation 3
  // die für Wasser, Sport und Gewicht (#181).
  const partnerProjections = createPartnerProjections({ clock });
  for (const projector of partnerSummaryProjectors) partnerProjections.registerProjector(projector);
  for (const entity of [...partnerProjectionEntities, ...sharingSyncEntities({ clock, securityLog })]) sync.registerEntity(entity);
  sync.registerPrePullStep('partner_projections', partnerProjections.prePullStep);
  // Partner & Benachrichtigungen (Spezifikation 5): die Benachrichtigungseinstellung je Person (#132) und Anfeuern (#123).
  sync.registerEntity(notificationSettingEntity);
  sync.registerEntity(encouragementEntity);
  sync.registerCommand(sendEncouragementCommand);
  // Einladungscodes unter dem Einladungs-Secret; der Seeder des Development-Backends bildet damit die HMACs geseedeter Codes (#120).
  const inviteCodes = createInviteCodes(invitationSettings.codeSecret);
  const invitations = invitationRoutes({
    database,
    clock,
    codes: inviteCodes,
    limiter: createInvitationLimiter({ clock }),
    securityLog,
    ipAddressOf: auth.ipAddressOf,
  });
  // Serverseitige Abmelde-Haken melden die Bereiche hier an.
  const logout = createLogout({ database, clock, auth, securityLog });
  // Push-Installation (Spezifikation 5, Abschnitt 9; #139): eigener Endpunkt, das Abmelden deaktiviert sie.
  const pushInstallations = createPushInstallations({ database, clock });
  logout.registerHook(pushInstallations.logoutHook);
  // Push-Zusteller (#142): stellt die Intents aller Bereiche zu; Anfeuern erhält seinen Endstatus zurück.
  const pushDelivery = createPushDelivery({ database, clock, port: expoPush, sessions: auth.sessions });
  pushDelivery.onFinalStatus('anfeuern', writeBackEncouragementPushStatus);
  const jobs = createJobRegistry({ clock });
  jobs.register(securityLog.cleanupJob);
  jobs.register(photoDrafts.cleanupJob);
  jobs.register(mealPhotos.storageCleanupJob);
  jobs.register(mealPhotos.orphanCleanupJob);
  for (const job of pushDelivery.jobs) jobs.register(job);
  return {
    app: createApp({ database, clock, auth, authorization, sync, invitations, logout, photoDrafts, mealPhotos, pushInstallations }),
    clock,
    photoStorage,
    securityLog,
    auth,
    authorization,
    sync,
    logout,
    partnerProjections,
    sharedActions,
    uncoupling,
    inviteCodes,
    jobs,
    pushDelivery,
  };
}

export type Backend = ReturnType<typeof createBackend>;
