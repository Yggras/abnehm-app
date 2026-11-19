import type { Clock } from '@abnehm/clock';
import type { DisplayName, EntityId, Instant } from '@abnehm/contracts/base';

import type { AppAuth, RegisterResult, SignInResult } from '../auth';
import type { LocalDatabase } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import type { Plan } from '../plan';
import { updateOwnPerson, type SyncCycleResult, type SyncWriter } from '../sync';
import { checkBodyData, type BodyDataCheck, type BodyDataProblem } from './body-data';
import { readOnboardingDraft, updateOnboardingDraft, type OnboardingDraft, type OnboardingDraftChange } from './draft';
import { keepsManualBudget } from './goals';
import { initialPlanDraftOf } from './week';

// Onboarding-Modul (Spezifikation 1, Abschnitte 1 und 9): der Weg vom Willkommen bis „Heute“. Vor dem
// Konto führt es durch Schritt 1 und 2 der Route `sitzung`: Es registriert bzw. meldet an und richtet
// das Konto ein, bis die Person mit dem Pull auf dem Gerät ist. Die Bestätigung aus Schritt 1 schreibt
// es dann über den Person-Upsert (#110) als `disclaimer_accepted_at`. Ab der Route `onboarding` liefert
// es den Stand der Person und den lokalen Entwurf. Fachdaten schreibt es nur über den Person-Upsert
// bzw. in Schritt 8 über „Erstplan speichern“ des Plan-Moduls; Registrieren, Anmelden und Bootstrap
// gehören dem Auth-Modul (#97).

export type OnboardingAuth = Pick<AppAuth, 'register' | 'signIn' | 'bootstrapPerson'>;

/** Stand der eigenen Person für die Route `onboarding`. */
export type OnboardingProgress =
  /** Keine Kontodatenbank geöffnet oder die Person ist noch nicht per Pull angekommen. */
  | Readonly<{ type: 'laedt' }>
  | Readonly<{ type: 'bereit'; disclaimerAccepted: boolean }>;

/** Ausgang der Einrichtung im Zustand `bootstrap_ausstehend`. */
export type AccountSetupResult =
  /** Die Person ist auf dem Gerät; die Sitzungs-Weiche führt weiter. */
  | Readonly<{ type: 'eingerichtet' }>
  /** Server nicht erreicht: „Für dein Konto brauchst du kurz Internet“. */
  | Readonly<{ type: 'offline' }>
  /** Der Server kennt keine Person zum Konto, und der Anzeigename ist nicht mehr bekannt. */
  | Readonly<{ type: 'name_fehlt' }>
  /** Die Sitzung wurde abgelehnt; das Auth-Modul sperrt bereits. */
  | Readonly<{ type: 'gesperrt' }>;

/** Ausgang von „Weiter“ in Schritt 3 „Körperdaten“. */
export type BodyDataResult =
  /** Vollständig und in den Grenzen; die `entryId` des Startgewichts liegt im Entwurf. */
  | Readonly<{ type: 'bestaetigt' }>
  /** Unter 18 Jahren: freundlicher Sperrbildschirm. */
  | Readonly<{ type: 'minderjaehrig' }>
  | Readonly<{ type: 'ungueltig'; errors: BodyDataProblem[] }>;

/** Ausgang von „Plan speichern“ in Schritt 8. */
export type PlanSaveResult =
  /** Startgewicht, Personenfelder, Fassungen und die heutigen Tagesziele liegen vor; weiter zu Schritt 9. */
  | Readonly<{ type: 'gespeichert' }>
  /** Der Entwurf trägt keine bestätigten Körperdaten oder passt nicht mehr zum Zielrechner; zurück in die Schritte davor. */
  | Readonly<{ type: 'unvollstaendig' }>
  /** Startgewicht oder lokale Transaktion sind gescheitert; Wiederholen erzeugt keine Dublette. */
  | Readonly<{ type: 'fehlgeschlagen' }>;

/** Was das Onboarding vom Plan-Modul der geöffneten Kontodatenbank braucht. */
export type OnboardingPlan = Pick<Plan, 'saveInitialPlan'>;

export type Onboarding = {
  /** Schritt 2: legt das Konto samt Person an; die Bestätigung aus Schritt 1 folgt mit der Person. */
  register(input: { email: string; password: string; displayName: DisplayName; disclaimerAcceptedAt: Instant }): Promise<RegisterResult>;
  /** Schritt 2, „Ich habe schon ein Konto“. Eine schon bestätigte Person bleibt unverändert. */
  signIn(input: { email: string; password: string; disclaimerAcceptedAt: Instant }): Promise<SignInResult>;
  /**
   * Zustand `bootstrap_ausstehend`: wiederholt einen ausstehenden Bootstrap und zieht die Person.
   * `displayName` braucht es nur nach `name_fehlt`.
   */
  setUpAccount(input?: { displayName: DisplayName }): Promise<AccountSetupResult>;
  progress(): OnboardingProgress;
  subscribe(listener: () => void): () => void;
  /** Schritt 1 mit Konto, etwa nach einer Anmeldung ohne Bestätigung: setzt `disclaimer_accepted_at` auf jetzt. */
  acceptDisclaimer(): void;
  readDraft(): OnboardingDraft;
  /**
   * Übernimmt eine Eingabe in den Entwurf. Liegt ein eigenes Budget aus Schritt 7 danach außerhalb des
   * erlaubten Bereichs, etwa nach einer anderen Aktivitätsstufe, entfällt es, und es gilt wieder das
   * berechnete (`keepsManualBudget`).
   */
  updateDraft(change: OnboardingDraftChange): OnboardingDraft;
  /**
   * „Weiter“ in Schritt 3: prüft die Körperdaten des Entwurfs mit den Grenzen des Zielrechners und dem
   * Alter am heutigen Tag. Sind sie gültig, legt es beim ersten Mal die `entryId` für das Startgewicht
   * im Entwurf ab; mit ihr speichert Schritt 8 es ohne Dublette.
   */
  confirmBodyData(): BodyDataResult;
  /** Stand der Körperdaten im Entwurf am heutigen Tag, etwa für den Sperrbildschirm nach einem Neustart. */
  bodyData(): BodyDataCheck;
  /**
   * „Plan speichern“ in Schritt 8: ruft „Erstplan speichern“ des Plan-Moduls mit dem Entwurf am heutigen
   * Tag samt der `entryId` aus Schritt 3 auf; Sporttage und Wiegetag ohne Wahl übernehmen die Vorauswahl.
   * Erneutes Speichern nach „Zurück“ oder einem Fehler trifft dasselbe Startgewicht. Ein Fehler des
   * Plan-Moduls geht an `onError` und endet als `fehlgeschlagen`.
   */
  savePlan(): Promise<PlanSaveResult>;
  /** Für `onAccountOpened` der App-Sitzung mit dem Plan-Modul dieser Datenbank; die Rückgabe löst die Beobachtung beim Sperren. */
  opened(database: LocalDatabase, plan: OnboardingPlan): () => void;
};

export type OnboardingOptions = {
  auth: OnboardingAuth;
  clock: Clock;
  writer: SyncWriter;
  /** Sync-Zyklus der geöffneten Kontodatenbank; `undefined` ohne geöffnete. */
  sync: () => Promise<SyncCycleResult> | undefined;
  onError: (error: unknown) => void;
  /** Erzeugt die `entryId` des Startgewichts. */
  newId: () => EntityId;
};

/** Was Schritt 2 an die Person des neuen Kontos weitergibt, bis sie angekommen ist. */
type Handover = { accountId: string; disclaimerAcceptedAt: Instant; displayName: DisplayName | null; personPending: boolean };

type OwnPerson = { accountId: string; disclaimerAccepted: boolean };

const loading: OnboardingProgress = { type: 'laedt' };

export function createOnboarding({ auth, clock, writer, sync, onError, newId }: OnboardingOptions): Onboarding {
  let handover: Handover | null = null;
  let current: { database: LocalDatabase; plan: OnboardingPlan; own: OwnPerson | null } | null = null;
  let snapshot: OnboardingProgress = loading;
  const listeners = new Set<() => void>();

  function publish() {
    const own = current?.own ?? null;
    const next: OnboardingProgress = own === null ? loading : { type: 'bereit', disclaimerAccepted: own.disclaimerAccepted };
    if (next.type === snapshot.type && (next.type === 'laedt' || (snapshot.type === 'bereit' && snapshot.disclaimerAccepted === next.disclaimerAccepted))) return;
    snapshot = next;
    for (const listener of [...listeners]) listener();
  }

  function requireDatabase(): LocalDatabase {
    if (current === null) throw new Error('Onboarding ohne geöffnete Kontodatenbank');
    return current.database;
  }

  function writeDisclaimer(database: LocalDatabase, acceptedAt: Instant) {
    database.transaction((tx) => updateOwnPerson(tx, writer, { disclaimerAcceptedAt: acceptedAt }, clock.read().instant));
  }

  /** Bestätigung aus Schritt 1 an die angekommene Person des neuen Kontos, genau einmal. */
  function handOver(database: LocalDatabase, own: OwnPerson): boolean {
    if (handover === null || handover.accountId !== own.accountId) return false;
    const { disclaimerAcceptedAt } = handover;
    handover = null;
    if (own.disclaimerAccepted) return false;
    try {
      writeDisclaimer(database, disclaimerAcceptedAt);
      return true;
    } catch (error) {
      onError(error);
      return false;
    }
  }

  function personArrived(): boolean {
    return current !== null && current.database.read((tx) => readOwnPerson(tx) !== undefined);
  }

  return {
    async register({ disclaimerAcceptedAt, displayName, ...credentials }) {
      const result = await auth.register({ ...credentials, displayName, timeZone: clock.read().timeZone });
      if (result.type === 'registered' || result.type === 'person_pending') {
        handover = { accountId: result.accountId, disclaimerAcceptedAt, displayName, personPending: result.type === 'person_pending' };
      }
      return result;
    },

    async signIn({ disclaimerAcceptedAt, ...credentials }) {
      const result = await auth.signIn(credentials);
      if (result.type === 'signed_in') handover = { accountId: result.accountId, disclaimerAcceptedAt, displayName: null, personPending: false };
      return result;
    },

    async setUpAccount(input) {
      const displayName = input?.displayName ?? (handover?.personPending === true ? handover.displayName : null);
      if (displayName !== null) {
        const bootstrapped = await auth.bootstrapPerson({ displayName, timeZone: clock.read().timeZone });
        if (bootstrapped.type === 'unreachable') return { type: 'offline' };
        if (bootstrapped.type === 'unauthorized') return { type: 'gesperrt' };
        if (handover !== null) handover = { ...handover, personPending: false };
      }
      const cycle = await sync();
      if (cycle?.pull === 'unauthorized') return { type: 'gesperrt' };
      if (cycle === undefined || (cycle.pull !== 'done' && cycle.pull !== 'nothing_to_do')) return { type: 'offline' };
      return personArrived() ? { type: 'eingerichtet' } : { type: 'name_fehlt' };
    },

    progress: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    acceptDisclaimer() {
      writeDisclaimer(requireDatabase(), clock.read().instant);
    },

    readDraft: () => requireDatabase().read(readOnboardingDraft),

    updateDraft(change) {
      const { instant, localDate } = clock.read();
      return requireDatabase().transaction((tx) => {
        const after = updateOnboardingDraft(tx, change, instant);
        if ('manualBudgetKcal' in change || keepsManualBudget(after, localDate)) return after;
        return updateOnboardingDraft(tx, { manualBudgetKcal: undefined }, instant);
      });
    },

    bodyData: () => requireDatabase().read((tx) => checkBodyData(readOnboardingDraft(tx), clock.read().localDate)),

    confirmBodyData() {
      const { instant, localDate } = clock.read();
      return requireDatabase().transaction((tx): BodyDataResult => {
        const draft = readOnboardingDraft(tx);
        const check = checkBodyData(draft, localDate);
        if (check.type !== 'vollstaendig') return check;
        if (draft.startWeightEntryId === undefined) updateOnboardingDraft(tx, { startWeightEntryId: newId() }, instant);
        return { type: 'bestaetigt' };
      });
    },

    async savePlan() {
      if (current === null) throw new Error('Onboarding ohne geöffnete Kontodatenbank');
      const { database, plan } = current;
      const draft = initialPlanDraftOf(database.read(readOnboardingDraft), clock.read().localDate);
      if (draft === null) return { type: 'unvollstaendig' };
      try {
        const saved = await plan.saveInitialPlan(draft);
        if (saved.type === 'gespeichert') return { type: 'gespeichert' };
        if (saved.type === 'ungueltig') return { type: 'unvollstaendig' };
        onError(saved.error);
        return { type: 'fehlgeschlagen' };
      } catch (error) {
        onError(error);
        return { type: 'fehlgeschlagen' };
      }
    },

    opened(database, plan) {
      const entry: { database: LocalDatabase; plan: OnboardingPlan; own: OwnPerson | null } = { database, plan, own: null };
      current = entry;
      publish();
      const stop = database.observe(
        (tx) => {
          const row = readOwnPerson(tx);
          return row === undefined ? null : { accountId: row.accountId, disclaimerAccepted: row.disclaimerAcceptedAt !== null };
        },
        (person) => {
          // Der Upsert löst eine neue Meldung aus; erst sie zeigt die bestätigte Person, so dass die Route
          // `onboarding` Schritt 1 nicht kurz aufblitzen lässt.
          if (person !== null && handOver(database, person)) return;
          entry.own = person;
          if (current === entry) publish();
        },
      );
      return () => {
        stop();
        if (current !== entry) return;
        current = null;
        publish();
      };
    },
  };
}
