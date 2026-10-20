import type { AppAuth, SessionRevocation } from '../auth/app-auth';
import type { LocalDatabases } from '../local-db/local-databases';
import type { SyncEngine } from '../sync/engine';

// Abmeldemodul (Spezifikation 0, Abschnitt 9; #111): die einzige Stelle, die vollständiges Abmelden
// orchestriert. Es ist ein Online-Ablauf auf den Primitiven des Auth-Moduls:
//
// 1. Sync. Ohne Netz meldet der Ablauf `unreachable` und lässt alles bestehen. Bleiben Operationen
//    ungesichert, braucht es den bestätigten Verzicht der Oberfläche.
// 2. `logout_pending` mit stabiler `requestId` (und dem Ausweis der Sitzung) dauerhaft speichern.
// 3. Serverabmeldung: Haken, Sicherheitslog, Widerruf. Antwortverlust heißt `unreachable`; der nächste
//    Versuch, auch beim nächsten Start, wiederholt sie identisch und erhält das gespeicherte Ergebnis.
// 4. Erst nach bestätigtem Widerruf dauerhaft `cleanup_pending`, dann die lokalen Bereinigungshaken:
//    die angemeldeten, danach SecureStore-Sitzung und kontogetrennte Datenbank samt Partnercache.
//    Bleibt die App dabei stehen, setzt `start` die Bereinigung fort, bevor Fachdaten erscheinen.
//
// Die Datei kennt weder React Native noch Expo, damit Integrationstests sie gegen die echte Hono-App
// laufen lassen.

/** Dauerhafter Stand einer begonnenen Abmeldung; auf dem Gerät in SecureStore. */
export type LogoutRecord =
  | Readonly<{ phase: 'logout_pending'; revocation: SessionRevocation }>
  | Readonly<{ phase: 'cleanup_pending'; accountId: string }>;

export type LogoutStore = {
  read(): Promise<LogoutRecord | null>;
  write(record: LogoutRecord): Promise<void>;
  clear(): Promise<void>;
};

/** Was der Sync vor dem Abmelden ergab. */
export type SyncBeforeLogout =
  | Readonly<{ type: 'secured' }>
  | Readonly<{ type: 'unsecured'; operations: number }>
  | Readonly<{ type: 'unreachable' }>
  /** Der Server lehnt die Sitzung ab oder keine Kontodatenbank ist offen; synchronisieren geht nicht. */
  | Readonly<{ type: 'unauthorized' }>;

/**
 * Lokaler Bereinigungshaken nach bestätigtem Widerruf, etwa das Abräumen der geplanten Tages-Check-ins
 * (Spezifikation 5). Ein Neustart wiederholt ihn, er muss also idempotent sein.
 */
export type LogoutCleanupHook = Readonly<{ name: string; run(accountId: string): void | Promise<void> }>;

export type LogoutResult =
  | Readonly<{ type: 'logged_out' }>
  /** Ungesicherte Operationen; die Oberfläche fragt nach und ruft mit `discardUnsecured` erneut auf. */
  | Readonly<{ type: 'confirmation_required'; unsecuredOperations: number }>
  /** Kein Netz oder keine Antwort: Eine abgeschlossene Serverabmeldung ist nicht bestätigt. */
  | Readonly<{ type: 'unreachable' }>
  /** Der Server kennt die Sitzung nicht mehr, ohne Abmeldeergebnis; das Auth-Modul ist gesperrt. */
  | Readonly<{ type: 'unauthorized' }>
  /** Der Server hat abgemeldet, die lokale Bereinigung ist unvollständig; der nächste Start setzt sie fort. */
  | Readonly<{ type: 'cleanup_pending' }>;

export type Logout = {
  /** Vollständiges Abmelden; gleichzeitige Aufrufe teilen sich denselben Ablauf. */
  logout(options?: { discardUnsecured?: boolean }): Promise<LogoutResult>;
  /**
   * Beim App-Start statt `auth.checkSession()`: setzt eine Bereinigung fort, bevor eine Kontodatenbank
   * öffnet, prüft sonst die Sitzung und setzt danach eine begonnene Abmeldung fort. `null` ohne Abmeldung.
   * Im Hintergrundfenster ohne Sync bleibt die begonnene Abmeldung für den nächsten Vordergrundstart
   * liegen (`resumeLogout: false`).
   */
  start(options?: { resumeLogout?: boolean }): Promise<LogoutResult | null>;
  /** Meldet einen lokalen Bereinigungshaken an; die Rückgabe meldet ihn ab. */
  onCleanup(hook: LogoutCleanupHook): () => void;
};

export type LogoutOptions = {
  auth: Pick<AppAuth, 'checkSession' | 'prepareRevocation' | 'isCurrentSession' | 'revokeCurrentSession' | 'forgetSession'>;
  databases: Pick<LocalDatabases, 'remove'>;
  store: LogoutStore;
  /** Ein Sync-Zyklus der geöffneten Kontodatenbank, etwa `syncBeforeLogout(engine)`. */
  sync(): Promise<SyncBeforeLogout>;
  /** Erzeugt die `requestId`. */
  newId(): string;
  /** Fehler einzelner Bereinigungshaken; die übrigen laufen trotzdem. */
  onError(error: unknown): void;
};

/** Der Sync vor dem Abmelden über die Engine der geöffneten Kontodatenbank, sofern es eine gibt. */
export async function syncBeforeLogout(engine: Pick<SyncEngine, 'sync' | 'unsecuredOperations'> | null): Promise<SyncBeforeLogout> {
  if (engine === null) return { type: 'unauthorized' };
  const { push, pull } = await engine.sync();
  if (push === 'unauthorized' || pull === 'unauthorized') return { type: 'unauthorized' };
  if (push === 'unavailable' || pull === 'unavailable') return { type: 'unreachable' };
  const operations = engine.unsecuredOperations();
  return operations === 0 ? { type: 'secured' } : { type: 'unsecured', operations };
}

export function createLogout({ auth, databases, store, sync, newId, onError }: LogoutOptions): Logout {
  const hooks = new Set<LogoutCleanupHook>();
  let running: Promise<LogoutResult | null> | null = null;

  /** Ein Ablauf zur Zeit; ein zweiter Aufruf erhält das Ergebnis des laufenden. */
  function exclusive<T extends LogoutResult | null>(work: () => Promise<T>): Promise<T> {
    if (running !== null) return running as Promise<T>;
    const promise = work().finally(() => {
      running = null;
    });
    running = promise;
    return promise;
  }

  /** Alle Schritte laufen, auch wenn einer scheitert; erst wenn keiner scheitert, ist die Abmeldung fertig. */
  async function cleanup(accountId: string): Promise<LogoutResult> {
    const steps: (() => void | Promise<void>)[] = [
      ...[...hooks].map((hook) => () => hook.run(accountId)),
      () => auth.forgetSession(),
      () => databases.remove(accountId),
    ];
    let failed = false;
    for (const step of steps) {
      try {
        await step();
      } catch (error) {
        failed = true;
        onError(error);
      }
    }
    if (failed) return { type: 'cleanup_pending' };
    await store.clear();
    return { type: 'logged_out' };
  }

  /**
   * Ein Ausweis aus einer Sitzung, die nicht mehr die des Geräts ist (erneute Anmeldung nach `401`):
   * Der Server widerruft die alte Sitzung, falls noch nicht geschehen; lokal bleibt alles.
   */
  async function settleStale(revocation: SessionRevocation): Promise<boolean> {
    const revoked = await auth.revokeCurrentSession(revocation);
    if (revoked.type === 'unreachable') return false;
    await store.clear();
    return true;
  }

  async function run(discardUnsecured: boolean): Promise<LogoutResult> {
    let record = await store.read();
    if (record?.phase === 'cleanup_pending') return cleanup(record.accountId);
    if (record !== null && !(await auth.isCurrentSession(record.revocation))) {
      if (!(await settleStale(record.revocation))) return { type: 'unreachable' };
      record = null;
    }
    const synced = await sync();
    if (synced.type === 'unreachable') return { type: 'unreachable' };
    if (synced.type === 'unsecured' && !discardUnsecured) return { type: 'confirmation_required', unsecuredOperations: synced.operations };
    let revocation = record?.revocation ?? null;
    if (revocation === null) {
      revocation = await auth.prepareRevocation(newId());
      if (revocation === null) return { type: 'unauthorized' };
      await store.write({ phase: 'logout_pending', revocation });
    }
    const revoked = await auth.revokeCurrentSession(revocation);
    if (revoked.type === 'unreachable') return { type: 'unreachable' };
    if (revoked.type === 'unauthorized') {
      await store.clear();
      return { type: 'unauthorized' };
    }
    await store.write({ phase: 'cleanup_pending', accountId: revocation.accountId });
    return cleanup(revocation.accountId);
  }

  return {
    logout: ({ discardUnsecured = false } = {}) => exclusive(() => run(discardUnsecured)),
    start: ({ resumeLogout = true } = {}) =>
      exclusive(async () => {
        const record = await store.read();
        // Vor `checkSession`: Die Kontodatenbank öffnet erst gar nicht.
        if (record?.phase === 'cleanup_pending') return cleanup(record.accountId);
        await auth.checkSession();
        if (record === null || !resumeLogout) return null;
        // Nach erneuter Anmeldung will die Person weitermachen; nur die alte Sitzung wird noch widerrufen.
        if (!(await auth.isCurrentSession(record.revocation))) {
          await settleStale(record.revocation);
          return null;
        }
        return run(false);
      }),
    onCleanup(hook) {
      hooks.add(hook);
      return () => hooks.delete(hook);
    },
  };
}
