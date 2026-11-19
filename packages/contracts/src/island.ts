import { z } from 'zod';

import { CatalogKey, EntityId, Instant, LocalDate, ServerVersion, TimeZone } from './base.ts';

// Momo, Insel und gemeinsame Aktionen (Spezifikation 0, Abschnitte 5, 6 und 9). Die Spielregeln
// selbst liefert Spezifikation 4; hier stehen nur die geteilten Formen.

/** Rolle einer Person auf der Insel. */
export const IslandRole = z.enum(['bauen', 'natur']);
export type IslandRole = z.infer<typeof IslandRole>;

/** Gemeinsame Stufe von Gemeinschaftsprojekt und Challenge; exakte Partneranteile gibt es nie. */
export const CommonStage = z.enum(['gestartet', 'gut_unterwegs', 'fast_geschafft', 'geschafft']);
export type CommonStage = z.infer<typeof CommonStage>;

/** Status einer gemeinsamen Challenge (Spezifikation 0, Abschnitt 8). */
export const ChallengeStatus = z.enum([
  'vorgeschlagen',
  'aktiv',
  'geschafft',
  'abgelaufen',
  'beendet',
  'abgelehnt',
  'zurueckgezogen',
  'verfallen',
]);
export type ChallengeStatus = z.infer<typeof ChallengeStatus>;

/** Art eines Insel-Ereignisses (Spezifikation 4, Abschnitt 9). */
export const IslandEventKind = z.enum(['besuch', 'momos_wunsch', 'inselwetter', 'entdeckung']);
export type IslandEventKind = z.infer<typeof IslandEventKind>;

const IslandMemberProgress = z
  .strictObject({
    personId: EntityId,
    /** Anteil der eigenen Levelhälfte, abgerundet; bei voller Hälfte 100. */
    halfPercent: z.int().min(0).max(100),
    halfFull: z.boolean(),
  })
  .refine((member) => member.halfFull === (member.halfPercent === 100), {
    message: '`halfFull` gilt genau bei 100 %',
    path: ['halfFull'],
  });

/** Aus den Buchungen beider Personen jederzeit neu berechenbarer Fortschritt einer Insel; ohne Energiemengen. */
export const IslandProgress = z
  .strictObject({
    islandId: EntityId,
    couplingId: EntityId,
    level: z.int().positive(),
    /** Energiebedarf je Levelhälfte im aktuellen Level. */
    levelNeed: z.int().positive(),
    members: z.tuple([IslandMemberProgress, IslandMemberProgress]),
    activeProject: z.strictObject({
      projectId: EntityId,
      templateKey: CatalogKey,
      sequenceNumber: z.int().positive(),
      stage: CommonStage,
    }),
    dataAsOf: Instant,
    serverVersion: ServerVersion,
  })
  .refine(({ members: [a, b] }) => a.personId !== b.personId, {
    message: 'Zwei verschiedene Mitglieder',
    path: ['members'],
  });
export type IslandProgress = z.infer<typeof IslandProgress>;

/** Zustand einer Insel: bis zum Schlüpfen wartet sie auf Rollen, nach dem Entkoppeln ist sie archiviert. */
export const IslandState = z.enum(['wartet_auf_rollen', 'aktiv', 'archiviert']);
export type IslandState = z.infer<typeof IslandState>;

/**
 * Kanonischer Datensatz einer Insel (`island`) im Sync. Schlüpfzeitpunkt und Zeitzone kommen
 * gemeinsam mit dem Schlüpfen (Spezifikation 4); eine wartende Insel hat keines von beiden.
 */
export const IslandRecord = z
  .strictObject({
    couplingId: EntityId,
    state: IslandState,
    hatchedAt: Instant.nullable(),
    timeZone: TimeZone.nullable(),
    createdAt: Instant,
    updatedAt: Instant,
  })
  .refine((record) => (record.hatchedAt === null) === (record.timeZone === null), {
    message: 'Schlüpfzeitpunkt und Zeitzone nur gemeinsam',
    path: ['timeZone'],
  })
  .refine((record) => (record.state === 'aktiv' ? record.hatchedAt !== null : record.state !== 'wartet_auf_rollen' || record.hatchedAt === null), {
    message: 'Aktiv erst nach dem Schlüpfen, wartend nur davor',
    path: ['hatchedAt'],
  });
export type IslandRecord = z.infer<typeof IslandRecord>;

const sharedActionBase = {
  id: EntityId,
  couplingId: EntityId,
  requesterPersonId: EntityId,
  status: z.enum(['offen', 'angenommen', 'abgelehnt', 'zurueckgezogen']),
  createdAt: Instant,
  /** Gesetzt genau dann, wenn die Aktion nicht mehr offen ist. */
  decidedAt: Instant.nullable(),
};

/** Nutzlast je Art; dieselben Schemas gelten für die Aktion und für ihren Antrag. */
const sharedActionPayloads = {
  rollenwahl: z.strictObject({ proposerRole: IslandRole }),
  rollentausch: z.strictObject({}),
  deko_schenken: z.strictObject({ islandObjectId: EntityId, decoKey: CatalogKey }),
  entkoppeln: z.strictObject({}),
};

/**
 * Gemeinsame Aktion einer Person (Art im Feld `type`). Rollenwahl, Rollentausch und Deko schenken
 * entscheidet der Partner; Entkoppeln nimmt der Server einseitig an.
 */
export const SharedAction = z
  .discriminatedUnion('type', [
    z.strictObject({ type: z.literal('rollenwahl'), ...sharedActionBase, payload: sharedActionPayloads.rollenwahl }),
    z.strictObject({ type: z.literal('rollentausch'), ...sharedActionBase, payload: sharedActionPayloads.rollentausch }),
    z.strictObject({ type: z.literal('deko_schenken'), ...sharedActionBase, payload: sharedActionPayloads.deko_schenken }),
    z.strictObject({ type: z.literal('entkoppeln'), ...sharedActionBase, payload: sharedActionPayloads.entkoppeln }),
  ])
  .refine((action) => (action.status === 'offen') === (action.decidedAt === null), {
    message: '`decidedAt` ist genau bei entschiedenen Aktionen gesetzt',
    path: ['decidedAt'],
  });
export type SharedAction = z.infer<typeof SharedAction>;

/** Arten, die `requestSharedAction` beantragt; Entkoppeln läuft einseitig über `requestUncoupling`. */
export const RequestedSharedActionType = z.enum(['rollenwahl', 'rollentausch', 'deko_schenken']);
export type RequestedSharedActionType = z.infer<typeof RequestedSharedActionType>;

/** Nutzlast des Fachbefehls `requestSharedAction`; die ID vergibt das Gerät. */
export const RequestSharedAction = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('rollenwahl'), actionId: EntityId, payload: sharedActionPayloads.rollenwahl }),
  z.strictObject({ type: z.literal('rollentausch'), actionId: EntityId, payload: sharedActionPayloads.rollentausch }),
  z.strictObject({ type: z.literal('deko_schenken'), actionId: EntityId, payload: sharedActionPayloads.deko_schenken }),
]);
export type RequestSharedAction = z.infer<typeof RequestSharedAction>;

/** Annehmen und Ablehnen darf nur der Partner, Zurückziehen nur der Antragsteller. */
export const SharedActionDecision = z.enum(['annehmen', 'ablehnen', 'zurueckziehen']);
export type SharedActionDecision = z.infer<typeof SharedActionDecision>;

/**
 * Nutzlast des Fachbefehls `decideSharedAction`. `timeZone` ist die Zone des entscheidenden Geräts;
 * mit der angenommenen Rollenwahl wird sie die Zeitzone der Insel (Spezifikation 0, Abschnitt 8).
 */
export const DecideSharedAction = z.strictObject({ actionId: EntityId, decision: SharedActionDecision, timeZone: TimeZone });
export type DecideSharedAction = z.infer<typeof DecideSharedAction>;

/** Fachlicher Schlüssel von `requestSharedAction`: je Aktion genau ein Antrag. */
export function sharedActionRequestKey(actionId: EntityId): string {
  return `shared_action:${actionId}:antrag`;
}

/**
 * Fachlicher Schlüssel von `decideSharedAction`: je Aktion und Person eine Entscheidung. Eine zweite,
 * andere Entscheidung derselben Person ist damit ein `operation_conflict`.
 */
export function sharedActionDecisionKey(actionId: EntityId): string {
  return `shared_action:${actionId}:entscheidung`;
}

/**
 * Nutzlast des Fachbefehls `buildObject` (Spezifikation 4, Abschnitte 2.5 und 7): ein Bauplan auf ein
 * eigenes freies Feld. Objekt, Feldbelegung und `build_debit` entstehen in einem Befehl; den Preis
 * berechnen App und Server mit den Spielregeln aus dem Bauplan, nie aus der Nutzlast. Person und Insel
 * kommen aus der Sitzung und dem Feld. Alle IDs vergibt das Gerät.
 */
export const BuildObject = z.strictObject({
  /** ID des Spielbefehls; zugleich Buchungsschlüssel der `build_debit` (Spezifikation 0, Abschnitt 4). */
  commandId: EntityId,
  islandObjectId: EntityId,
  fieldId: EntityId,
  blueprintKey: CatalogKey,
  /** Lokaler Tag der Ausgabe auf dem Gerät; Tag der Buchung. */
  localDate: LocalDate,
});
export type BuildObject = z.infer<typeof BuildObject>;

/** Fachlicher Schlüssel von `buildObject`: je Spielbefehl genau ein Bau. */
export function buildObjectKey(commandId: EntityId): string {
  return `bauen:${commandId}`;
}

/**
 * Nutzlast des Fachbefehls `upgradeObject` (Spezifikation 4, Abschnitte 2.5, 3 und 7; #194): ein eigenes
 * gebautes Objekt genau eine Stufe weiter. Stufe und `upgrade_debit` entstehen in einem Befehl; den Preis
 * (2- bzw. 3-Facher Grundpreis) berechnen App und Server mit den Spielregeln, nie aus der Nutzlast. Die
 * Zielstufe steht in der Nutzlast, damit dieselbe Aufwertung auf zwei eigenen Geräten nicht zweimal kostet:
 * Steht das Objekt schon darauf, lehnt der Server ab.
 */
export const UpgradeObject = z.strictObject({
  /** ID des Spielbefehls; zugleich Buchungsschlüssel der `upgrade_debit` (Spezifikation 0, Abschnitt 4). */
  commandId: EntityId,
  islandObjectId: EntityId,
  toLevel: z.union([z.literal(2), z.literal(3)]),
  /** Lokaler Tag der Ausgabe auf dem Gerät; Tag der Buchung. */
  localDate: LocalDate,
});
export type UpgradeObject = z.infer<typeof UpgradeObject>;

/** Fachlicher Schlüssel von `upgradeObject`: je Spielbefehl genau eine Aufwertung. */
export function upgradeObjectKey(commandId: EntityId): string {
  return `aufwerten:${commandId}`;
}

/** Ziel einer Platzierung: ein Inselfeld oder das persönliche Lager. */
export const PlacementTarget = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('feld'), fieldId: EntityId }),
  z.strictObject({ type: z.literal('lager') }),
]);
export type PlacementTarget = z.infer<typeof PlacementTarget>;

/**
 * Nutzlast des Fachbefehls `placeObject` (Spezifikation 4, Abschnitte 2.5, 7 und 11; #194): ein eigenes
 * Objekt auf ein eigenes Feld stellen oder ins Lager legen; Einlagern ist Platzieren im Lager. Platzieren
 * ist kostenlos. Feldbelegung läuft ausschließlich über diesen Befehl; ist das Feld auf dem Server belegt,
 * wechselt das ältere Objekt atomar ins Lager (Spezifikation 0, Abschnitt 10).
 */
export const PlaceObject = z.strictObject({
  commandId: EntityId,
  islandObjectId: EntityId,
  /**
   * Feld des Objekts vor der Platzierung, wie das Gerät es kannte; `null` im Lager. Nur für die lokale
   * Bereinigung einer Ablehnung ohne kanonischen Datensatz (Spezifikation 4, Abschnitt 11); der Server
   * entscheidet nicht danach.
   */
  fromFieldId: EntityId.nullable(),
  target: PlacementTarget,
});
export type PlaceObject = z.infer<typeof PlaceObject>;

/** Fachlicher Schlüssel von `placeObject`: je Spielbefehl genau eine Platzierung. */
export function placeObjectKey(commandId: EntityId): string {
  return `platzieren:${commandId}`;
}

/**
 * Nutzlast des Fachbefehls `markEventsSeen` (Spezifikation 4, Abschnitt 9; #202): Die Person hat ein für
 * sie neues Ereignis angesehen. Je Ereignis eine Operation, weil die Autorisierung genau einen eigenen
 * Ereignisstand prüft. Ansehen kostet keine Energie.
 */
export const MarkEventsSeen = z.strictObject({ islandEventStateId: EntityId });
export type MarkEventsSeen = z.infer<typeof MarkEventsSeen>;

/** Fachlicher Schlüssel von `markEventsSeen`: je Ereignisstand einmal; ein zweites Gerät ist ein Retry. */
export function markEventsSeenKey(islandEventStateId: EntityId): string {
  return `ereignis_gesehen:${islandEventStateId}`;
}

/**
 * Nutzlast des Fachbefehls `claimEventReward` (Spezifikation 4, Abschnitt 9; #202): die Belohnung eines
 * erfüllbaren Wunschs abholen. Offline möglich mit lokal vorläufiger Belohnung; der Server prüft die
 * Bedingung und bestimmt die Belohnung kanonisch. Die IDs der Belohnung leiten Gerät und Server aus dem
 * Ereignisstand ab (`eventRewardId`), die Nutzlast nennt deshalb keine.
 */
export const ClaimEventReward = z.strictObject({ islandEventStateId: EntityId });
export type ClaimEventReward = z.infer<typeof ClaimEventReward>;

/** Fachlicher Schlüssel von `claimEventReward`: je Ereignis und Person genau eine Belohnung. */
export function claimEventRewardKey(islandEventStateId: EntityId): string {
  return `ereignis_belohnung:${islandEventStateId}`;
}

/** Entwicklungsform zum Level (Kaulquappe ab Level 1 … Lagunendrache ab Level 43). */
export const MomoForm = z.enum([
  'kaulquappe',
  'huepfer',
  'krabbler',
  'aufrechter',
  'springer',
  'spirale',
  'fluegling',
  'lagunendrache',
]);
export type MomoForm = z.infer<typeof MomoForm>;

/** Stimmung; „wartet im Ei“ ist keine Stimmung, sondern die Stufe `laichkugel`. */
export const MomoMood = z.enum(['zufrieden', 'freut_sich', 'begeistert', 'neugierig', 'doest', 'schlaeft']);
export type MomoMood = z.infer<typeof MomoMood>;

/**
 * Wie Momo aussieht. Als Laichkugel hat Momo weder Form noch Stimmung noch Accessoires;
 * geschlüpft hat es immer eine Form und eine Stimmung und höchstens ein Accessoire je Stelle.
 */
export const MomoAppearance = z
  .strictObject({
    stage: z.enum(['laichkugel', 'geschluepft']),
    formKey: MomoForm.nullable(),
    moodKey: MomoMood.nullable(),
    accessories: z.strictObject({ kopf: CatalogKey.nullable(), hals: CatalogKey.nullable() }),
  })
  .refine(
    (appearance) =>
      appearance.stage === 'geschluepft'
        ? appearance.formKey !== null && appearance.moodKey !== null
        : appearance.formKey === null &&
          appearance.moodKey === null &&
          appearance.accessories.kopf === null &&
          appearance.accessories.hals === null,
    { message: 'Form, Stimmung und Accessoires passen nicht zur Stufe' },
  );
export type MomoAppearance = z.infer<typeof MomoAppearance>;
