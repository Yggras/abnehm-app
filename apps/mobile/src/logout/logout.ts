import type { AppAuth, SessionRevocation, SessionRevocations } from '../auth/app-auth';
import type { LocalDatabases } from '../local-db';
import { unsecuredOperationCount } from '../sync';
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
// Ein gespeicherter Stand gilt nur für die Sitzung seines Ausweises. Hat sich die Person inzwischen neu
// angemeldet, wird höchstens noch die alte Sitzung widerrufen; die neue Anmeldung bleibt unberührt.
//
// Die Datei kennt weder React Native noch Expo, damit Integrationstests sie gegen die echte Hono-App
// laufen lassen.

/** Dauerhafter Stand einer begonnenen Abmeldung; auf dem Gerät in SecureStore. */
export type LogoutRecord = Readonly<{ phase: 'logout_pending' | 'cleanup_pending'; revocation: SessionRevocation }>;

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

/** Ausgang eines Abmeldeversuchs (nicht zu verwechseln mit `LogoutResult` des Servers). */
export type LogoutOutcome =
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
  /**
   * Vollständiges Abmelden. Gleichzeitige Aufrufe teilen sich denselben Ablauf; läuft gerade `start`,
   * beginnt er danach.
   */
  logout(options?: { discardUnsecured?: boolean }): Promise<LogoutOutcome>;
  /**
   * Beim App-Start statt `auth.checkSession()`: setzt eine Bereinigung fort, bevor eine Kontodatenbank
   * öffnet, prüft sonst die Sitzung und setzt danach eine begonnene Abmeldung fort. `null` ohne Abmeldung.
   * Im Hintergrundfenster ohne Sync bleibt die begonnene Abmeldung für den nächsten Vordergrundstart
   * liegen (`resumeLogout: false`).
   */
  start(options?: { resumeLogout?: boolean }): Promise<LogoutOutcome | null>;
  /**
   * Ob eine begonnene Abmeldung dieser Sitzung offen ist, etwa nach `unreachable` oder weil der beim
   * Start fortgesetzte Ablauf eine Bestätigung braucht. Die Oberfläche unter „Konto“ bietet dann an, sie
   * mit `logout` abzuschließen.
   */
  pending(): Promise<boolean>;
  /** Meldet einen lokalen Bereinigungshaken unter eindeutigem Namen an; die Rückgabe meldet ihn ab. */
  onCleanup(hook: LogoutCleanupHook): () => void;
};

export type LogoutOptions = {
  auth: Pick<AppAuth, 'checkSession'>;
  revocations: SessionRevocations;
  databases: Pick<LocalDatabases, 'open' | 'lock' | 'current' | 'remove'>;
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

export function createLogout({ auth, revocations, databases, store, sync, newId, onError }: LogoutOptions): Logout {
  const hooks = new Set<LogoutCleanupHook>();
  // Abläufe laufen nacheinander; gleichzeitige `logout`-Aufrufe teilen sich einen.
  let queue: Promise<unknown> = Promise.resolve();
  let sharedLogout: Promise<LogoutOutcome> | null = null;

  function serialized<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.then(work, work);
    queue = next.catch(() => {});
    return next;
  }

  /** Alle Schritte laufen, auch wenn einer scheitert; erst wenn keiner scheitert, ist die Abmeldung fertig. */
  async function cleanup(accountId: string): Promise<LogoutOutcome> {
    const steps: (() => void | Promise<void>)[] = [
      ...[...hooks].map((hook) => () => hook.run(accountId)),
      () => revocations.forgetSession(),
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
   * Ungesicherte Operationen des Kontos. Nach `401` ist seine Datenbank geschlossen; sie öffnet dafür kurz,
   * ohne die Fachoberfläche, die nur dem Auth-Modul folgt.
   */
  async function unsecuredOf(accountId: string): Promise<number> {
    const open = databases.current();
    if (open?.accountId === accountId) return unsecuredOperationCount(open);
    const database = await databases.open(accountId);
    try {
      return unsecuredOperationCount(database);
    } finally {
      databases.lock();
    }
  }

  /** Ob ein gespeicherter Stand noch die Sitzung des Geräts betrifft. */
  async function isCurrent(record: LogoutRecord): Promise<boolean> {
    const status = await revocations.revocationStatus(record.revocation);
    // Nach `forgetSession` hat das Gerät keine Sitzung mehr; die Bereinigung gilt dann weiter.
    return status === 'aktuell' || (status === 'keine' && record.phase === 'cleanup_pending');
  }

  /**
   * Der gespeicherte Stand, solange er die Sitzung des Geräts betrifft. Gehört er zu einer früheren
   * Sitzung (erneute Anmeldung), widerruft der Server die alte, falls noch nicht geschehen; lokal bleibt
   * alles. `unreachable`, solange das nicht gelingt.
   */
  async function currentRecord(): Promise<LogoutRecord | null | 'unreachable'> {
    const record = await store.read();
    if (record === null || (await isCurrent(record))) return record;
    if (record.phase === 'logout_pending' && (await revocations.revokeSession(record.revocation)).type === 'unreachable') {
      return 'unreachable';
    }
    await store.clear();
    return null;
  }

  async function run(discardUnsecured: boolean): Promise<LogoutOutcome> {
    const record = await currentRecord();
    if (record === 'unreachable') return { type: 'unreachable' };
    if (record?.phase === 'cleanup_pending') return cleanup(record.revocation.accountId);
    const synced = await sync();
    if (synced.type === 'unreachable') return { type: 'unreachable' };
    // Bei `unauthorized` geht es ohne Sync weiter: Ist der Widerruf schon geschehen, liefert der Retry
    // sein Ergebnis; sonst fehlt ein Token und der Ablauf endet unten mit `unauthorized`. Ungesichert
    // kann dann nur sein, was vor dem `401` entstand; auch das löscht die Bereinigung nicht ungefragt.
    const unsecured =
      synced.type === 'unsecured' ? synced.operations : synced.type === 'unauthorized' && record !== null ? await unsecuredOf(record.revocation.accountId) : 0;
    if (unsecured > 0 && !discardUnsecured) return { type: 'confirmation_required', unsecuredOperations: unsecured };
    let revocation = record?.revocation ?? null;
    if (revocation === null) {
      revocation = await revocations.prepareRevocation(newId());
      if (revocation === null) return { type: 'unauthorized' };
      await store.write({ phase: 'logout_pending', revocation });
    }
    const revoked = await revocations.revokeSession(revocation);
    if (revoked.type === 'unreachable') return { type: 'unreachable' };
    if (revoked.type === 'unauthorized') {
      await store.clear();
      return { type: 'unauthorized' };
    }
    await store.write({ phase: 'cleanup_pending', revocation });
    return cleanup(revocation.accountId);
  }

  return {
    logout({ discardUnsecured = false } = {}) {
      sharedLogout ??= serialized(() => run(discardUnsecured)).finally(() => {
        sharedLogout = null;
      });
      return sharedLogout;
    },
    start: ({ resumeLogout = true } = {}) =>
      serialized(async () => {
        // Vor `checkSession`: Bei offener Bereinigung öffnet die Kontodatenbank erst gar nicht.
        const before = await store.read();
        if (before?.phase === 'cleanup_pending' && (await isCurrent(before))) return cleanup(before.revocation.accountId);
        await auth.checkSession();
        if (before === null || !resumeLogout) return null;
        const record = await currentRecord();
        if (record === null || record === 'unreachable') return null;
        return run(false);
      }),
    async pending() {
      const record = await store.read();
      return record !== null && (await isCurrent(record));
    },
    onCleanup(hook) {
      if ([...hooks].some((registered) => registered.name === hook.name)) throw new Error(`Bereinigungshaken ${hook.name} ist schon angemeldet`);
      hooks.add(hook);
      return () => hooks.delete(hook);
    },
  };
}
