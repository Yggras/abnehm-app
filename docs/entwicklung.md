# Entwicklung

Wie die Codebasis aufgebaut ist und wie App, Backend und Datenbank lokal laufen. Grundlage sind das Projektgerüst ([#93](https://github.com/Yggras/abnehm-app/issues/93)) und Abschnitt 1–2 der [Spezifikation 0](https://github.com/Yggras/abnehm-app/issues/71). Bis zum [Produktiv-Gate](https://github.com/Yggras/abnehm-app/issues/115) gelten ausschließlich synthetische Daten.

## Voraussetzungen

- Node ≥ 26.5 mit npm 11 (Expo SDK 58 verlangt mindestens Node 22.13, [Expo-Versionen](https://docs.expo.dev/versions/latest/))
- Docker Desktop mit Docker Compose
- Xcode mit iOS-Simulator sowie Android Studio mit Emulator. Geprüft ist das Gerüst mit Xcode 27 und JDK 21 (`JAVA_HOME` beim Android-Build); andere Versionen sind nicht geprüft.

## Aufbau

Ein npm-Workspace mit zwei Anwendungen und zwei gemeinsamen Paketen:

| Ordner | Paket | Inhalt |
| --- | --- | --- |
| `apps/mobile` | `@abnehm/mobile` | Expo-App (SDK 58, Expo Router, TypeScript strict), Tests mit Jest 30, `jest-expo` 58 und React Native Testing Library 14 |
| `apps/backend` | `@abnehm/backend` | Hono und Drizzle auf Node, Postgres; Integrationstests mit Vitest gegen ein flüchtiges Postgres und die echte Hono-App |
| `packages/contracts` | `@abnehm/contracts` | Vertragsmodul: Zod-Schemas und Typen, die App und Backend teilen |
| `packages/clock` | `@abnehm/clock` | Uhr/Zeitzone: aktueller Zeitpunkt, IANA-Zeitzone, lokaler Tag |

Node führt die TypeScript-Quellen von Backend und Paketen direkt aus ([Type Stripping](https://nodejs.org/api/typescript.html)). Deshalb tragen relative Importe dort die Endung `.ts`, und es gibt keinen Build-Schritt.

### Grenzen, die Lint und Typprüfung erzwingen

`test/lint-grenzen.test.ts` belegt jede dieser Regeln mit verbotenen und erlaubten Beispielen.

- **Vertragsmodul:** nur Zod und eigene Dateien. Verboten sind React-, Drizzle-, Netzwerk- und Plattform-APIs, auch als Typimport oder dynamischer Import. Die tsconfig des Pakets kennt keine DOM- und Node-Typen. `fetch` oder `process` sind dort also schon Typfehler.
- **Uhr:** nur das Vertragsmodul sowie `Date` und `Intl` aus dem Sprachstandard.
- **Zeit im Bereichscode:** In `apps/*/src` sind `Date.now()`, `new Date()`, `Date()` und `Intl…resolvedOptions()` verboten, in der App außerdem `expo-localization`. Ausgenommen sind nur der Geräteadapter `apps/mobile/src/clock/` und Tests.
- **App → Backend:** nur `import type` aus `@abnehm/backend/rpc`. Laufzeitcode des Backends gelangt nie ins App-Bundle.
- **Farben:** In `apps/mobile/src` stehen Farben nur als Design-Token aus `apps/mobile/src/design/tokens.ts`. Rohe Hex-, `rgb()`- oder `hsl()`-Werte und Farbnamen in Farbeigenschaften verbietet die Regel `abnehm/token-farben`; ausgenommen sind die Token-Datei und Tests.
- **Plattformbibliotheken:** `expo-haptics` nur in `apps/mobile/src/haptics/`, `@expo/ui` nur in den Hüllen unter `apps/mobile/src/design/native/`, `expo-font` und `@expo-google-fonts/*` nur in `apps/mobile/src/design/fonts.ts` (Regel `abnehm/bibliotheksgrenzen`).
- **Testuhr:** `@abnehm/clock/testing` und `@abnehm/clock/conformance` erlaubt Lint nur in Testdateien und in den Testfähigkeiten der App (`apps/mobile/src/test-capabilities/`). Ins Backend-Image kommen sie nicht (`.dockerignore`).
- **Testfähigkeiten:** `@abnehm/contracts/seeds` erlaubt Lint nur in Tests, `apps/backend/dev/` und `apps/mobile/src/test-capabilities/`. App-Code erreicht `src/test-capabilities/` nur über `src/build-capabilities.ts`, Backend-Code aus `src/` importiert nie `apps/backend/dev/` (siehe „Seeds und Testfähigkeiten“).

### Vertragsmodul

`@abnehm/contracts` ist die einzige Quelle für Zod-Schemas und Typen, die App und Backend teilen ([#94](https://github.com/Yggras/abnehm-app/issues/94)).

- **Zuschnitt:** je Fachbereich eine Datei und ein Teilpfad, etwa `@abnehm/contracts/daily-goals` oder `@abnehm/contracts/today`. Ein Paket-Barrel und weitergereichte Exporte gibt es nicht. Bereiche importieren sich nicht im Kreis. `packages/contracts/test/struktur.test.ts` prüft das.
- **Zeit im Vertragsmodul:** Es liest nie die aktuelle Zeit oder Gerätezone. `Date.UTC` dient nur der zonenfreien Kalenderrechnung auf lokalen Tagen, `Intl` nur der Prüfung, ob eine IANA-Zone existiert.
- **Regeln für Schemas:** Diskriminierte Unions unterscheiden über `type`. Objekte sind strikt (`z.strictObject`), Optionales steht als `optional()` bzw. `nullable()` im Schema. Ungültige Kombinationen scheitern am Schema, etwa ein falsches Vorzeichen einer Energiebuchung. Sichtbaren Text gibt es im Transport nicht, nur `messageKey` und typisierte Werte.
- **Fixtures:** Jedes exportierte Schema hat unter `packages/contracts/fixtures/` mindestens ein gültiges und ein ungültiges Beispiel, eingetragen im Register `fixtures/index.ts`. Fehlt ein Eintrag, scheitert `fixtures.test.ts`. Dieselben Fixtures laufen automatisch durch drei Vertragstests: im Paket, in der App (`apps/mobile/src/contracts/fixtures.test.ts`, Jest) und im Backend über die Hono-Validierung `jsonBody` (`apps/backend/test/contract-validation.test.ts`). `@abnehm/contracts/fixtures` ist nur in Testdateien erlaubt, in der App außerdem in Test-Helfern unter `testing/`, die App-Code nie importiert.
- **Neue Endpunkte** validieren ihren Body mit `jsonBody(schema)` aus `apps/backend/src/contract-validation.ts`. Ungültige Nutzlasten beantwortet er mit `400` und dem `ContractError` `invalid_payload`.

### Uhr und lokaler Tag

Bereichscode liest Zeitpunkt, Zeitzone und lokalen Tag ausschließlich über die Schnittstelle `Clock` aus `@abnehm/clock`:

- `clock.read()` liefert `{ instant, timeZone, localDate }` aus einer einzigen Ablesung. Zeitpunkt und Tag passen dadurch auch um Mitternacht zusammen.
- In der App liefert `useClock()` die Geräteuhr: Systemzeit plus Gerätezone aus `expo-localization`.
- `clock.read(timeZone)` liest in einer anderen Zone, im Backend etwa in der `time_zone` der Person.
- Tests nutzen `createTestClock()`. Das Konformitäts-Testkit (`clockConformanceCases`) läuft gegen Systemuhr, Geräteuhr und Testuhr. Es prüft Tageswechsel, Sommerzeit (23- und 25-Stunden-Tage, Südhalbkugel, ausfallende Mitternacht), Halbstundenzonen, Reisen und ungültige Zonen.

### Design-System

Oberflächen entstehen nur aus den Tokens und Primitiven in `apps/mobile/src/design/` ([#95](https://github.com/Yggras/abnehm-app/issues/95)), Import über `../design`.

- **Tokens:** `tokens.ts` übernimmt `research/design-system.md` vollständig; `tokens.test.ts` prüft das gegen die Tabellen dort. Ändert sich das Design-System, schlägt der Test fehl, bis die Tokens nachgezogen sind.
- **Primitiven:** `Text`, `Icon`, `Button`, `Chip`, `Card`, `Notice`, `ListRow`, `Toast`, `ProgressBar`, `Skeleton`; native Elemente nur über die Hüllen `Sheet`, `Switch`, `DateTimePicker` und `ContextMenu`.
- **Komponentenkatalog:** nur im Development Build, erreichbar über „Komponentenkatalog“ auf „Heute“ oder `abnehmapp-dev://katalog`. Er zeigt alle Primitiven in ihren Zuständen und ist die Grundlage für Gerätesmoke und Impeccable-Prüfung.

### App-Shell und Navigation

Die Navigationshülle liefert [#101](https://github.com/Yggras/abnehm-app/issues/101) nach Abschnitt 6 der [Spezifikation 0](https://github.com/Yggras/abnehm-app/issues/71).

- **Tabs:** Heute · Protokoll · ＋ · Momo · Wir unter `apps/mobile/src/app/(tabs)/`. Die eigene Tab-Leiste (`src/shell/TabBar.tsx`) hat das mittige ＋, das das ＋-Sheet öffnet. Den Punkt am Tab „Momo“ liefert `useMomoTabBadge` in `src/shell/tab-badge.ts`; die Quelle setzt Spezifikation 4 ein. Ob eine Route Tab, Seite oder modaler Ablauf ist und welcher Bereich sie liefert, steht in `src/navigation/route-catalog.ts`.
- **Routen:** Jede Route aus `@abnehm/contracts/routes` hat eine Datei unter `src/app/` an ihrem Pfad: `today` ist `/`, sonst wird aus dem Namen ein Pfad (`capture.food` → `/capture/food`). Parameter stehen in der Abfrage. Einzige Ausnahme sind die Einstellungsseiten (`/settings/goals`).
- **Navigieren:** Bereiche öffnen Ziele nur über `openTarget(target)` und schließen mit `closeRoute()` aus `src/navigation`; Links baut `hrefFor(target)`. Eigene Pfade setzt niemand von Hand zusammen; Ausnahme sind die Entwicklerwerkzeuge `/katalog` und `/technik`, die nicht im Routenkatalog stehen.
- **Bildschirm liefern:** Eine Routendatei enthält `export default placeholderRoute('capture.food')`. Ein Bereich ersetzt das durch `export default routeScreen('capture.food', SeinBildschirm)`. `routeScreen` prüft die Parameter mit dem Schema der Route; unbekannte Ziele und ungültige Parameter öffnen „Heute“ mit der Meldung „Das gibt es nicht mehr.“ Den Rahmen mit „Zurück“ bzw. „Fertig“ gibt `ScreenFrame` aus `src/shell/ScreenFrame.tsx`.
- **Platzhalter:** Development Builds zeigen für fehlende Bildschirme einen deutschen Platzhalter mit dem liefernden Bereich. In Release-Builds wirft er `MissingContributionError`; ein fehlender Beitrag ist dort ein Integrationsfehler.
- **Meldungen:** Es gibt genau einen Meldungs-Host ([#108](https://github.com/Yggras/abnehm-app/issues/108)). Bereiche zeigen Meldungen und „Rückgängig“ nur über `useMessageHost().showMessage({ messageKey, values, undo? })` aus `src/shell/MessageHost.tsx`. `undo` ist `{ run, expire? }`: `run` ruft der Host höchstens einmal auf, `expire`, sobald die Meldung ihr „Rückgängig“ ungenutzt verliert. Die sichtbare Zeile entsteht aus `messageKey` und Werten. Bereiche tragen ihre Texte mit Werte-Schema in `src/shell/message-texts.ts` ein. Ein fehlender Text zeigt im Development Build „Text fehlt: …“, im Release ist er ein Integrationsfehler. Die Meldung steht über der Tab-Leiste, auf Seiten und in modalen Abläufen am unteren Rand von `ScreenFrame`, 5 s lang, mit Screenreader 10 s; auf Android gilt eine längere Systemeinstellung „Zeit zum Reagieren“. Jede neue Zeile wird einmal angesagt. Unbekannte Ziele öffnen „Heute“ mit „Das gibt es nicht mehr.“
- **Quick-Commands:** Ein Bereich registriert je `commandKey` aus `QuickCommandKey` einen Handler in `src/shell/app-quick-commands.ts`, typisiert mit `quickCommandHandler`. `execute(tx, params)` liefert Meldung und `undoData`, `undo(tx, undoData)` nimmt die Buchung zurück. Beide laufen in der Transaktion, die die Registry öffnet, und reichen den Kontext an die Repositories des Bereichs weiter. Der Undo-Token bleibt in der Registry: Er wird höchstens einmal eingelöst und gehört zur Kontodatenbank, in der er entstand. Ausgelöst wird ein Quick-Command über `useQuickCommand()` aus `src/shell/use-quick-command.ts`, das die Meldung samt „Rückgängig“ zeigt. Die geöffnete Kontodatenbank reicht das Auth-Modul ([#97](https://github.com/Yggras/abnehm-app/issues/97)) in `appQuickCommands` herein.
- **Sitzungs-Weiche ([#110](https://github.com/Yggras/abnehm-app/issues/110)):** Der Zustandsautomat `sessionGate` in `src/session/session-gate.ts` kennt `ohne_sitzung | bootstrap_ausstehend | gesperrt | onboarding | today`. Er folgt dem Auth-Modul und der eigenen Person in der geöffneten Kontodatenbank; ohne kanonische Person bleibt er bei `bootstrap_ausstehend`. Beim Start prüft das Auth-Modul die gespeicherte Sitzung, bis dahin bleibt der Startbildschirm stehen.
  - Das Wurzel-Layout gibt je Zustand mit `Stack.Protected` nur dessen Bildschirme frei (`src/shell/session-routes.ts`). Jeder andere Bildschirm führt zum Ziel der Weiche, auch per Deep Link, und beim Sperren verschwindet sein Verlauf ([Expo Router: Protected routes](https://docs.expo.dev/router/advanced/protected/)).
  - Im Onboarding sind nur `onboarding` und die Modale `partner.invite`, `partner.redeem` und `notifications.permission` erreichbar; „Fertig“ und System-Zurück kehren ins Onboarding zurück.
  - Die drei Zustände ohne Fachoberfläche zeigen die Shell-Route `sitzung` (nicht im Routenkatalog). Spezifikation 1 ersetzt ihren Platzhalter in `src/app/sitzung.tsx` (#138, #140). Der Development-Platzhalter führt zu Komponentenkatalog und technischer Prüfung; in die Fachoberfläche gelangt man bis dahin über einen Seed.
  - Neue Routendateien gehören in genau eine Gruppe von `screenAccess`, sonst schlägt `SessionGate.test.tsx` fehl.
  - Tests mit dem echten `src/app` ersetzen die Weiche mit `jest.mock('../session/use-session-gate', () => jest.requireActual('../session/testing/test-gate'))`. Sie steht dann auf `today`, `setTestGate` stellt andere Zustände.
- **Onboarding-Registry:** Die Schritte 9–11 (`health`, `notifications`, `partner`) sind Steckplätze in `src/shell/onboarding-registry.ts`.
  - Ein Bereich registriert seine Bildschirmkomponente mit `appOnboardingRegistry.register(owner, stepKey, Schritt)`. Sie erhält ausschließlich `complete(outcome)`.
  - Spezifikation 1 zeichnet den Schritt mit `<OnboardingStep stepKey onComplete />`. Die Shell prüft das Ergebnis gegen `onboardingStepOutcomes[stepKey]`.
  - Fehlt ein Beitrag, zeigt der Development Build einen überspringbaren Platzhalter. Im Release ist das ein Integrationsfehler (`MissingOnboardingStepError`).
- **Tests:** `renderRouter('src/app', { initialUrl })` aus `expo-router/testing-library` rendert die echte App. Inhalte des nativen `Sheet` erreichen Tipps im Test nur über den Test-Adapter `src/design/testing/inline-sheet.tsx` (siehe `src/shell/AppShell.test.tsx`).

### Datenmodell und Migrationen

Das vollständige V1-Schema ([#96](https://github.com/Yggras/abnehm-app/issues/96), Abschnitt 8 der Spezifikation 0) liegt zweimal vor, als Drizzle-Schema je Dialekt:

| Dialekt | Schema | Migrationen | erzeugen |
| --- | --- | --- | --- |
| Postgres (Backend) | `apps/backend/src/db/schema/` | `apps/backend/drizzle/` | `npm run db:generate --workspace @abnehm/backend` |
| SQLite (App) | `apps/mobile/src/local-db/schema/` | `apps/mobile/src/local-db/migrations/` | `npx drizzle-kit generate` in `apps/mobile` |

- **Gleiche Namen, gleiche Constraints:** Tabellen, Spalten, Unique-Keys, partielle Indizes, CHECKs und Fremdschlüssel heißen in beiden Schemas gleich. `test/schema-paritaet.test.ts` vergleicht sie. Erlaubte Abweichungen stehen dort mit Grund, etwa reine Server- und Gerätetabellen oder die Partnerspalten ohne Fremdschlüssel in SQLite (`partnerPersonColumns`).
- **Typabbildung:** UUIDs in Postgres als `uuid`, in SQLite als TEXT. Lokale Tage sind `date` bzw. `YYYY-MM-DD`, Zeitpunkte `timestamptz` bzw. UTC-ISO-8601. Messwerte sind Ganzzahlen (`milli_kcal`, mg, ml, g, Minuten). `server_version` ist in Postgres `bigint NOT NULL`, lokal eine Dezimalzeichenfolge, die bei unbestätigten Creates leer ist.
- **Schema ändern:** beide Schemas anpassen, in beiden Workspaces `drizzle-kit generate` ausführen und die erzeugten Dateien einchecken. `test/schema-migrationen.test.ts` scheitert, solange eine Migration fehlt. Migrationen auf `main` ändern sich nie mehr; jede Änderung kommt als neue Migration. Wer eine noch unveröffentlichte SQLite-Migration auf dem eigenen Branch neu erzeugt, leert danach die Babel-Caches (`npx jest --clearCache`, `npx expo start --clear`). Babel bündelt die SQL-Datei in `migrations.js` und erkennt nicht, wenn sich nur die SQL-Datei ändert.
- **Personenbezug:** Jede Tabelle führt Konto, Person oder Kopplung in einer eigenen Spalte, keine außerhalb der Better-Auth-Tabellen eine E-Mail (`test/schema-personenbezug.test.ts`).
- **Unveränderliche Entitäten** (Tagesziel, Tageszielerfüllung, Energiebuchung, Projekteinzahlung, Freischaltungen, Inselfeld, Momo-Accessoire, Revocation-Notice): In Postgres verhindern Trigger jedes Update und Delete (Migration `0001_immutable_entities`), Fremdschlüssel darauf sind `ON DELETE RESTRICT`. Lokal ersetzt der Sync ein Duplikat durch den kanonischen Datensatz, deshalb gibt es dort keine Trigger.
- **Weitere Invarianten per Trigger** (nur Postgres, Migration `0003_integrity_triggers`): Eine Kopplung hat genau die beiden Personen ihres Paars als Mitglieder (am Transaktionsende geprüft), `person.account_id` und der Inhalt eines Notification-Intents ändern sich nie, und ein manueller Sporteintrag wird nur durch einen Import ersetzt.
- **Ausführen:** Das Backend migriert beim Start (`src/main.ts`) und per `npm run db:migrate --workspace @abnehm/backend`. Die App bündelt ihre Migrationen (`migrations.js` mit babel-plugin-inline-import, `metro.config.js` kennt `.sql`) und migriert beim Öffnen einer Kontodatenbank.

### Lokale Datenbank der App

`apps/mobile/src/local-db/` kapselt expo-sqlite und Drizzle. Bereichscode kennt nur die Schnittstelle aus `local-db/index.ts`:

- **Je Konto eine Datei** (`konto-<konto-id>.db`). `LocalDatabases.open(kontoId)` öffnet und migriert sie, `lock()` schließt sie bei `401`. `remove(kontoId)` löscht sie beim vollständigen Abmelden endgültig, schließt sie vorher und ist idempotent. Wer ein anderes Konto öffnet oder sperrt, beendet alle Handles und Beobachtungen des bisherigen; sie werfen danach `LocalDatabaseClosedError`.
- **Transaktionen:** `LocalDatabase.transaction(work)` reicht einen opaken `TransactionContext` an fachliche Repositories und Befehle; `read(work)` einen `ReadContext`, in dem Schreiben scheitert. `work` ist synchron, Verschachteln ist verboten. `tx.afterCommit(callback)` läuft nur nach erfolgreichem Commit; Fehler darin gehen an `onError` und rollen nichts zurück.
- **Repositories** öffnen den Kontext mit `sqliteOf(tx)` aus `local-db/sqlite.ts` und bauen ihre Abfragen mit Drizzle über `local-db/schema`. Nur sie sehen Drizzle-Typen.
- **Beobachten:** `observe(read, listener)` liest sofort und nach jedem Commit dieser Datenbank erneut. Drizzles `useLiveQuery` wird nicht verwendet: Es hört auf den globalen Change-Listener von expo-sqlite und vergleicht nur den Tabellennamen, nicht die Datei ([Quelltext](https://unpkg.com/drizzle-orm@0.45.4/expo-sqlite/query.js)). Vom Kontowechsel wüsste es nichts.
- **Tests** nutzen `local-db/testing/better-sqlite.ts`: echte SQLite-Dateien über better-sqlite3 mit denselben gebündelten Migrationen, in Jest mit `@jest-environment node`. `expo-sqlite`, `drizzle-orm/expo-sqlite` und better-sqlite3 erlaubt Lint nur in `local-db/` (Regel `abnehm/bibliotheksgrenzen`).

### Tagesziel-Auswertung und Tages-Check-in

`apps/mobile/src/daily-goals/` ist die Registry aus Abschnitt 3 der Spezifikation 0 ([#104](https://github.com/Yggras/abnehm-app/issues/104)). Die Bereichsregeln liefern die Spezifikationen 2 und 3.

- **Registrieren:** Ein Bereich liefert je Baustein einen `BausteinEvaluator` und je Tracker einen `CheckInEvaluator`. Beide bestehen aus `readFacts(tx, personId, localDate)` und `evaluate`.
  - `readFacts` ist der Bereichsreader. Er liest nur die Tabellen des eigenen Bereichs.
  - `evaluate` ist rein: Es liest weder Uhr noch Datenbank. Tag und Tagesende nimmt es nur aus dem Snapshot, `isDayClosed(snapshot, at)` setzt diese Regel um.
  - Der Composition Root übergibt alle Evaluatoren an `createDailyGoalRegistry({ bausteine, checkIns })`. Doppelte Schlüssel und das Kalorienbudget als Tracker werfen schon dort.
- **Auswerten:** `evaluateDailyGoal(tx, snapshot, at)` bzw. `evaluateCheckIn(tx, input)` laufen in der Lese- oder Schreibtransaktion des Aufrufers.
  - Das Fundament prüft jedes Ergebnis gegen den Vertrag, den Snapshot (Schwelle, Tagesende) und den Plan (Wasserziel, Sporttag, Wiegetag).
  - `completion` ergänzt das Fundament aus der persistierten Tageszielerfüllung.
  - Ein fehlender Evaluator (`unknown_catalog_key`), ein ungültiger Snapshot (`invalid_snapshot`) und ein vertragswidriges Ergebnis (`invalid_payload` mit `issue`) ergeben einen `contract_error`, keine Ausnahme.
- **Konformitäts-Testkit** unter `daily-goals/testing/`, in Tests mit `test(case.name, case.run)` registriert:
  - `bausteinConformanceCases` und `checkInConformanceCases` nehmen die Wahrheitstabelle des Bereichs. Sie prüfen Ergebnisform, Zustandsregeln, Determinismus und die Abdeckung der Schwellen (knapp unter, exakt auf, darüber). Tagesverlauf, Reise, 23- und 25-Stunden-Tag, Check-ins ohne Momo-Platz und die Unabhängigkeit vom Kalorienbudget leitet das Kit selbst ab.
  - `completionConformanceCases` wertet über den echten Orchestrator gegen SQLite aus: noch nicht erfüllt, erstmals erfüllt, nach Erfüllung korrigiert, erneute Auswertung. Es braucht `@jest-environment node`.
  - Die Test-Evaluatoren in `testing/test-evaluators.ts` belegen Registry und Kit. Sie lesen ihre Fakten aus einem Speicher im Test.

### Persistenzdienst, `onDaysChanged` und Energie

Den Persistenzdienst aus Abschnitt 3 und die Energiebuchungen aus Abschnitt 4 der [Spezifikation 0](https://github.com/Yggras/abnehm-app/issues/71) liefert [#105](https://github.com/Yggras/abnehm-app/issues/105).

- **Tage melden:** Wer Einträge ändert, ruft in derselben `LocalDatabase.transaction` `persistence.reevaluateDailyGoals(tx, personId, localDates, cause)` auf. Der Dienst kommt aus `createDailyGoalPersistence({ registry, clock, writer, dispatcher })` in `apps/mobile/src/daily-goals/`.
  - Für Tage bis heute legt er beim ersten `erfuellt` genau eine Tageszielerfüllung samt `+1` an, über den Fachbefehl `completeDailyGoal`.
  - Bestehen alle drei Erfüllungen, legt er genau einmal den Tagesbonus an (`grantDailyBonus`).
  - Eine spätere Korrektur nimmt nichts zurück. Tage nach heute bekommen nur das Signal.
  - Beide Befehle erzeugt nur der Dienst. `dailyGoalCommands` meldet sie in der lokalen Befehls-Registry nur für die Reconciliation an.
- **IDs:** Erfüllung und Gutschrift tragen deterministische UUIDv5 aus ihrem Schlüssel `tagesziel:<person>:<tag>:<platz>` bzw. `tagesbonus:<person>:<tag>`, berechnet mit `dailyGoalCompletionId` und `energyBookingId` aus dem Vertragsmodul (`uuidV5` in `@abnehm/contracts/ids`). Zwei Geräte erzeugen dieselbe Erfüllung also mit derselben ID. Der Server antwortet dem zweiten Gerät mit dem gespeicherten kanonischen Datensatz, und das Gerät überschreibt sein Duplikat.
- **Fehlende Tage:** Spezifikation 1 meldet mit `persistence.registerMissingDaysHook(hook)` die Materialisierung ihres Nachholfensters an. Der Haken läuft vor der Auswertung in derselben Transaktion und bekommt die gemeldeten Tage bis heute.
- **Pull:** `persistence.onCanonicalChanges` gehört als `onCanonicalChanges` in die Sync-Engine. Ein Entitätsadapter meldet mit `affectedDays(tx, entityId)`, welchen Tag (`{ type: 'tag' }`) bzw. welche Gültigkeit (`{ type: 'plan', validFrom }`) seine Zeile betrifft. Die Engine liest das vor und nach jeder Übernahme. Tagesbezogene Tage gehen mit `pull` an den Dienst, Plan-Fassungen mit `planaenderung` und den Tagen aus `planChangeDays(validFrom, heute)` (`@abnehm/contracts/daily-goals`). Dieselbe Funktion nutzt Spezifikation 1 beim lokalen Anlegen.
- **`onDaysChanged`:** Der Dienst schreibt Dirty-Day-Marker (`dirty_day`) in derselben Transaktion. `createDaysChangedDispatcher({ database, observers, onError })` stellt sie nach dem Commit gebündelt je Person und Auslöser zu.
  - Die Zustellung erfolgt mindestens einmal; bestätigt wird nur die zugestellte Revision eines Markers. Beobachter müssen idempotent sein.
  - Beim App-Start ruft der Composition Root `dispatcher.deliver()` auf, damit offene Marker nach einem Neustart weiterlaufen.
  - Ein begrenztes Hintergrundfenster wartet mit `dispatcher.drain(ms)`.
- **Energie:** `apps/mobile/src/energy/` legt Buchungen nur an (`appendBooking`) und liest sie. `readEnergy` liefert Bestand und Levelhälfte, `bookingByKey` die Buchung zu einem Schlüssel. Die Regeln (`summarizeEnergy`, `shownEnergy`) stehen im Vertragsmodul. Auf dem Server legt `insertBooking` in `apps/backend/src/energy/bookings.ts` Buchungen samt Änderungsprotokoll an, `bookCounterBooking` die einzige zulässige Korrektur.
- **Tests:** `daily-goals/persistence.test.ts` und `days-changed.test.ts` (App), `apps/backend/test/daily-goal-commands.test.ts` (Server, samt Negativtest-Szenarien in `test/support/daily-goals.ts`) und `daily-goals-app.test.ts` (zwei Installationen gegen die echte Hono-App). Tagesziele legen Tests bis zu Spezifikation 1 direkt an (`insertDailyGoals`, `insertDailyGoalForTest`).

### Ports zwischen Bereichen

`PlanReader`, `WeightTrendReader`, `IntakeReader`, `WeightRecorder` und der optionale `IslandCheckInHintReader` (Schnittstellen in `@abnehm/contracts/ports`) sind keine Registry. Ein Modul, das einen Port braucht, nimmt ihn als Pflichtparameter entgegen.

- **Zusammensetzen:** `composeAreaPorts(database, providers)` aus `apps/mobile/src/area-ports/` ruft je Port die Fabrik des liefernden Bereichs auf.
  - Lese-Ports bekommen nur `read`, also Lesetransaktionen. Der `WeightRecorder` bekommt zusätzlich `transaction` für seine eigene Transaktion.
  - Fehlende Pflichtports und Methoden meldet `IncompleteAreaPortsError` auf einmal. Ohne Insel-Hinweis ist `islandCheckInHintReader` `null`.
- **Validieren:** Jede Rückgabe wird gegen ihr Vertragsschema geprüft. Ein Verstoß wirft `PortContractError`. Eine ungültige Eingabe an `recordManualWeight` beantwortet die Prüfung mit `invalid_payload`, ohne den Port aufzurufen.
- **Fake-Ports für Tests** in `area-ports/testing/fakes.ts`: `fakePlanReader` (Fassungen nach `validFrom` und Wochentag), `fakeWeightTrendReader`, `fakeIntakeReader` (jeder Tag, sonst 0), `fakeWeightRecorder(localDateOf)` (idempotent je `entryId`; den lokalen Tag liefert der Test, etwa über die Testuhr) und `fakeIslandCheckInHintReader`. `fakeAreaPorts(overrides)` setzt sie geprüft zusammen.

### Typisierte Endpunkte (Hono RPC)

Die App ruft das Backend über `hc<AppType>` auf ([Hono RPC](https://hono.dev/docs/guides/rpc)). Fachliche Pfade sind versioniert (`/v1/…`).

`apps/mobile/src/backend/status.ts` prüft beim Typecheck, dass die abgeleitete Antwort genau dem Vertrag aus `@abnehm/contracts/status` entspricht. `test/rpc-typisierung.test.ts` belegt das: Ein umbenanntes oder zusätzliches Feld im Backend lässt die Typprüfung der App scheitern.

Fach-Endpunkte ruft die App mit `createBackendClient({ fetch: auth.fetch })` auf. Das `fetch` des Auth-Moduls hängt die Sitzung an und sperrt bei `401`.

### Konto, Sitzung und Sicherheitslog

Konto und Sitzung verwaltet [Better Auth](https://www.better-auth.com/docs) hinter einem eigenen Auth-Modul ([#97](https://github.com/Yggras/abnehm-app/issues/97), Abschnitt 9 der [Spezifikation 0](https://github.com/Yggras/abnehm-app/issues/71)). Bereichscode kennt Better Auth nicht, sondern nur das Interface seiner Rolle:

| Rolle | Interface | Ort |
| --- | --- | --- |
| App | `AppAuth`: `register`, `signIn`, `checkSession`, `changePassword`, dazu `bootstrapPerson`, Sperrzustand (`state`, `subscribe`), `onUnauthorized` und `fetch` | `apps/mobile/src/auth/` |
| Abmeldemodul der App | `SessionRevocations` (`AppSession.revocations`): `revokeSession` mit dem Ausweis aus `prepareRevocation`, dazu `revocationStatus` und `forgetSession` | `apps/mobile/src/auth/` |
| Backend-Endpunkte | `SessionAuthenticator.authenticate(headers)`; Endpunkte erhalten die Sitzung über den Guard der Autorisierung (unten) | `apps/backend/src/auth/` |
| Betrieb | `AdminPasswordReset`, aufgerufen über das Kommando unten | `apps/backend/src/auth/admin-reset-command.ts` |

- **Endpunkte:** Better Auth liegt unter `/v1/auth`. Freigegeben sind nur `sign-up/email`, `sign-in/email`, `get-session` und `change-password`, alles andere dort antwortet mit `404`. Dazu kommen `POST /v1/session/logout` (Serverteil des vollständigen Abmeldens, unten) und `POST /v1/person/bootstrap` (die eine Person des Kontos).
- **Sitzung:** Die App sendet das Sitzungstoken als `Authorization: Bearer …` ([Bearer-Plugin](https://www.better-auth.com/docs/plugins/bearer)) und hält es nur in SecureStore. Sitzungen liegen in Postgres, ohne Cookie-Cache. Sie laufen nach 30 Tagen ohne Nutzung ab und verlängern sich bei Nutzung höchstens einmal täglich.
- **Begrenzung:** Fehlversuche bei der Anmeldung sind pro E-Mail (5 in 15 Minuten) und pro IP (20 je Stunde) begrenzt (`login-limiter.ts`). Zusätzlich gilt die eingebaute Begrenzung von Better Auth: 3 Anfragen in 10 Sekunden pro IP und Pfad ([Quelltext v1.7.10](https://github.com/better-auth/better-auth/blob/v1.7.10/packages/better-auth/src/api/rate-limiter/index.ts)). Die IP kommt aus `X-Forwarded-For`. Hinter einem Reverse Proxy gehört dessen Adresse in `AUTH_TRUSTED_PROXIES`; ohne erkennbare Adresse greift nur die Begrenzung pro E-Mail. Lokal ohne Proxy warnt Better Auth bei Aufrufen ohne diesen Header, dass es keine Client-IP erkennt (beobachtet im Containerlauf für #97). Ohne vorgeschalteten Proxy kann ein Client `X-Forwarded-For` selbst setzen; die Einrichtung des Proxys gehört zum [Produktiv-Gate](https://github.com/Yggras/abnehm-app/issues/115).
- **Passwörter:** 10 bis 128 Zeichen (`passwordPolicy` in `@abnehm/contracts/auth`), dazu eine Blocklist häufiger Passwörter (`apps/backend/src/auth/password-blocklist.txt`, Quelle im Dateikopf).
- **Admin-Reset:** Es gibt keinen öffentlichen Reset. Auf dem Server setzt dieses Kommando ein zufälliges neues Passwort, gibt es einmal aus und widerruft alle Sitzungen des Kontos:

  ```sh
  docker compose exec backend npm run admin:reset-password --workspace @abnehm/backend --silent -- anna@example.test
  ```

- **Sicherheitslog:** Geschrieben wird nur über `createSecurityLog` aus `apps/backend/src/security-log/`. Es nimmt ausschließlich die geschlossene Union `SecurityEvent` mit den Ereignistypen aus [#22](https://github.com/Yggras/abnehm-app/issues/22) an. Ihre Felder sind UUIDs, Katalogwerte, Wahrheitswerte oder IP-Adressen; unbekannte Felder werden abgewiesen. Mit `record(event, tx)` schreibt ein Modul in seiner eigenen Transaktion.
- **Serverjobs:** Ein Job meldet Namen, Intervall und eine idempotente Funktion bei der Registry an (`apps/backend/src/jobs/job-registry.ts`). Angemeldet wird in `createBackend` (`apps/backend/src/backend.ts`), ohne die Registry zu ändern. Der Backend-Prozess prüft jede Minute, welche Jobs fällig sind; Tests lösen sie mit der Testuhr über `runDue()` aus. Erster Job ist `sicherheitslog_aufraeumen`, der Einträge nach 90 Tagen löscht.
- **Tests:** `apps/backend/test/auth.test.ts` prüft die Abläufe über HTTP. `apps/backend/test/app-auth.test.ts` prüft das App-Modul `AppAuth` gegen die echte Hono-App. Dieser Test importiert App-Code und hat deshalb eine eigene tsconfig (`tsconfig.app-auth.json`, Bundler-Auflösung wie in der App).

### Vollständiges Abmelden

Vollständiges Abmelden ist ein Online-Ablauf ([#111](https://github.com/Yggras/abnehm-app/issues/111), Abschnitt 9 der [Spezifikation 0](https://github.com/Yggras/abnehm-app/issues/71)). Orchestriert wird er nur im Abmeldemodul der App (`apps/mobile/src/logout/`, `createLogout`); die Oberfläche unter „Konto“ liefert Spezifikation 5 und ruft `deviceLogout()` aus `apps/mobile/src/session/device-session.ts`.

1. **Sync.** Ohne Netz liefert `logout()` `unreachable` und lässt alles bestehen. Bleiben Operationen ungesichert, liefert es `confirmation_required`; nach dem bestätigten Verzicht ruft die Oberfläche `logout({ discardUnsecured: true })`.
2. **`logout_pending`.** Vor dem Serveraufruf speichert das Modul die `requestId` samt Ausweis der Sitzung (`SessionRevocation` mit Token) in SecureStore (`secureLogoutStore` in `apps/mobile/src/auth/secure-session-store.ts`).
3. **Serverabmeldung** (`POST /v1/session/logout`, `apps/backend/src/logout/`): In einer Transaktion laufen die angemeldeten Server-Haken in Anmeldereihenfolge (`backend.logout.registerHook`, etwa die Push-Deaktivierung aus Spezifikation 5), dann Sicherheitslog (`abmeldung`, `sitzungswiderruf`) und Widerruf. Das Ergebnis liegt in `online_request` unter der `requestId`, mit einem Hash, dessen Schlüssel aus dem Sitzungstoken stammt. Ein identischer Retry erhält es auch nach dem Widerruf, mit diesem Token aber nichts anderes. Antwortverlust und `5xx` ergeben `unreachable`; der nächste Versuch wiederholt die Anfrage identisch.
4. **`cleanup_pending`.** Erst nach bestätigtem Ergebnis laufen die lokalen Bereinigungshaken (`logout.onCleanup`, etwa die Tages-Check-ins aus Spezifikation 5), danach `forgetSession` und `LocalDatabases.remove`. Die kontogetrennte Datenbank enthält auch den Partnercache. Jeder Haken muss idempotent sein.
5. **Neustart.** Statt `checkSession` ruft die App `logout.start()`. Eine offene Bereinigung läuft so, bevor eine Kontodatenbank öffnet; eine begonnene Abmeldung wird danach fortgesetzt und kann erneut eine Bestätigung verlangen. Ob eine Abmeldung offen ist, liefert `logout.pending()`. Lehnt der Server die Sitzung inzwischen ab, zählt das Modul die Outbox der geschlossenen Kontodatenbank; vor dem `401` entstandene Operationen verlangen ebenfalls den bestätigten Verzicht. Jeder gespeicherte Stand gilt nur für die Sitzung seines Ausweises: Hat sich die Person inzwischen neu angemeldet, widerruft das Modul höchstens noch die alte Sitzung und lässt die neue Anmeldung samt Daten stehen.

Antwortet der Server mit `401` ohne gespeichertes Ergebnis (etwa nach einer Passwortänderung auf einem anderen Gerät), liefert `logout()` `unauthorized`: Das Auth-Modul ist gesperrt, lokale Daten bleiben bis zur nächsten Anmeldung. Die Tests stehen in `apps/backend/test/logout.test.ts` (HTTP) und `apps/backend/test/logout-app.test.ts` (App-Modul gegen die echte Hono-App).

### Autorisierung

Jeder Zugriff läuft durch das zentrale Modul `apps/backend/src/authorization/` ([#98](https://github.com/Yggras/abnehm-app/issues/98), Abschnitt 11 der [Spezifikation 0](https://github.com/Yggras/abnehm-app/issues/71)). Es arbeitet nach „deny by default“, vor Body-Validierung, Datenzugriff und Fachlogik. Importiert wird aus `authorization/authorization.ts`.

- **Policy je Route:** Jede Route beginnt mit `guard(policy)`. Die Policy kommt aus `policies`:
  - `public()` nur für Status und Auth-Abläufe ohne Sitzung (Registrieren, Anmelden, „Sitzung prüfen“);
  - `authenticated()`, wenn eine Sitzung genügt, etwa beim Bootstrap und Passwort ändern;
  - `logout()` nur für `POST /v1/session/logout`: Ohne gültige Sitzung erhält die Route `actor = null` und liefert ausschließlich ihr an das vorgelegte Token gebundenes Ergebnis, sonst `401`;
  - `resource(entity, operation)` mit Fundstelle, z. B. `guard(policies.resource('partner_summary', 'lesen'), (c) => ({ id: c.req.param('id') }))`;
  - `adminCommand(command)` nur für Server-Kommandos, nie über HTTP.

  Ohne Sitzung antwortet der Guard mit `401` ohne Body, bei verweigertem Zugriff mit `403` und genau `{ code: 'forbidden', retryable: false }`. Ob es die Ressource gibt, verrät die Antwort nicht. Danach stehen `c.var.actor` (Konto, Sitzung, Person) und bei Ressourcen `c.var.resource` bereit. Beides stammt nur aus Sitzung und Postgres.
- **Sperre für Routen ohne Policy:** `createApp` setzt `authorization.enforce` vor alle Routen. Eine Route, die nicht mit einem Guard beginnt, lehnt sie zur Laufzeit mit `forbidden` ab; ihr Handler läuft nicht. `findIncompletePolicies(app)` listet solche Routen und Fachbefehle. Der Test in `authorization-module.test.ts` erwartet an der echten App eine leere Liste.
- **Ressourcen und Matrix:** `resources.ts` ordnet jede Tabelle des Schemas genau einer Ressourcenklasse der Matrix zu und enthält deren Regel. Eigentum, Mitgliedschaft und Freigaben liest die Regel aus Postgres. IDs aus dem Client finden eine Ressource nur. Weicht ein Eigentumsfeld der Nutzlast (`claimedOwnerPersonId`) von der Person der Sitzung ab, ist die Operation verboten. Welche Operationen eine Klasse kennt, steht in `operationMatrix` (`policy.ts`). Eine neue Tabelle braucht einen Eintrag in `resourceEntities`, sonst scheitert der Katalogtest.
- **Fachbefehle:** Ein Befehl meldet seine Policy in `createBackend` mit `authorization.registerCommand(name, policy)` an und wird mit `authorizeCommand(executor, actor, name, target)` geprüft, auf Wunsch in der Transaktion des Aufrufers. Einen nicht angemeldeten Befehl lehnt das Modul ab. Generisches Upsert und Löschen prüft `authorize(executor, actor, policies.resource(entity, operation), target)`. Den `actor` liefert auf Routen der Guard, außerhalb einer Route `actorOf(headers)`.
- **Partnerantworten:** Was eine Person über ihren Partner erhält, geht vor dem Senden durch `partnerResponse(kind, value)`. Die geschlossenen Schemas aus `@abnehm/contracts` sind die einzige Positivliste; bei einem Verstoß wirft die Funktion `PartnerResponseRejected`, ohne Daten zu nennen.
- **Sicherheitslog:** Verweigerte Fotozugriffe (Fotoliste, Bildabruf) schreibt die Regel selbst als `fotozugriff_verweigert`.
- **Negativtests:** `apps/backend/test/support/authorization.ts` erzeugt aus den Schutzdimensionen einer Policy die anwendbaren Fälle, jeweils mit positiver Gegenprobe. Die Dimensionen sind ohne Sitzung, fremde Person, manipulierte ID, Entkopplung, Freigabeentzug und verbotene Operation. Eine öffentliche Route erwartet Erfolg ohne Sitzung. Welche Varianten ein Szenario liefern muss, prüft schon die Typprüfung:

  ```ts
  const cases = authorizationCases({
    policy: policies.resource('partner_summary', 'lesen'),
    route: { method: 'GET', path: '/v1/partner/summary' },
    arrange: async () => …, // Welt mit `backend` und dem Gerät `actor` der berechtigten Person
    attempt: async (world, device) => httpOutcome(await call(world.backend, 'GET', …, device)),
    manipulierte_id: …,
    entkopplung: …,
    freigabeentzug: …,
    verbotene_operation: …,
  });
  for (const { name, run } of cases) it(name, run);
  ```

  `test/support/coupled-world.ts` liefert dafür eine gekoppelte Welt mit Anna und Philipp. Bis Endpunkte da sind, prüft `resourceProbe` eine Policy über eine Test-Route.

### Sync: Outbox, Push und Pull

Der eigene Push/Pull-Sync ([#99](https://github.com/Yggras/abnehm-app/issues/99), Abschnitt 10 der [Spezifikation 0](https://github.com/Yggras/abnehm-app/issues/71)) lehnt sich an das [Backend-Protokoll von WatermelonDB](https://watermelondb.dev/docs/Sync/Backend) an. Die Hüllen stehen in `@abnehm/contracts/sync`. Fachbefehle und kanonische Duplikate ergänzt [#100](https://github.com/Yggras/abnehm-app/issues/100); Auslöser, Status, Schemaversionen und `pushNow` folgen mit [#102](https://github.com/Yggras/abnehm-app/issues/102).

- **Entität anmelden:** Ein Bereich meldet jede synchronisierte Entität zweimal an, ohne den Sync-Kern zu ändern.
  - Backend: `backend.sync.registerEntity(entity)` in `createBackend`. Für eigene Einträge mit `person_id` baut `ownedEntity({ entityType, resource, table, upsert, deletable, columns, record })` aus `apps/backend/src/sync/registry.ts` die Speicheroperationen. `resource` ist die Ressource der Autorisierung; ihre Regel entscheidet über Eigentum, Lesen, Upsert und Löschen.
  - App: ein `SyncEntityAdapter` mit Transport-Schemas (`upsert`, `record`), Eigentumsregel (`ownerField`) und den Operationen `applyCanonical`, `applyTombstone` und `reconcileRejected`, die nur den opaken `TransactionContext` sehen. Für eine Entität, die genau eine Zeile ist, baut `sqliteEntity(…)` aus `apps/mobile/src/sync/` sie samt Versionsprüfung und Reconciliation. Der Composition Root übergibt alle an `createSyncRegistry([...foundationSyncEntities, …])`.
- **Lokal ändern:** Das Repository schreibt seine Zeile und ruft in derselben Transaktion `SyncWriter.upsert` bzw. `delete` auf (`createSyncWriter`). Die Nutzlast ist vollständig und enthält keine Eigentums-, Server- oder abgeleiteten Felder; ein Rollback hinterlässt weder Änderung noch Operation.
- **Auslöser und Status (#102):** `src/session/device-session.ts` öffnet beim Konto-Start dieselbe Sync-Engine für Vordergrund, Outbox-Beobachtung (2 s), 60-s-Takt im Vordergrund, Pull-to-Refresh und Netzrückkehr mit offener Outbox. Die Installation-ID liegt dauerhaft im kontolokalen `device_state`; `SyncEngine.status()` meldet `not_secured_since` nach über 24 Stunden oder einen Outbox-Migrationsfehler. Der `ScreenFrame` zeigt den Hinweis auf den Fachseiten. `pushDeviceNow({ deadline })` öffnet ohne React-Baum bei Bedarf Sitzung und Datenbank und führt über die gemeinsame Engine genau einen Push ohne Pull aus. Kein allgemeiner Hintergrund-Sync.
- **Schema-Update (#102):** Sync-Hülle aktuell V3, Server akzeptiert Hüllen V3/V2. Beim Öffnen transformiert die App noch nie gesendete V1/V2-Operationen verlustfrei; V1–V3 haben identische Drahtnutzlasten. Bereits gesendete Operationen bleiben bytegleich, einschließlich Operationsversion. **Vor** dem HTTP-Aufruf markiert die Engine sie als versendet, auch für Absturz/Antwortverlust. Nur in aktueller Hülle darf der Server historische V1/V2-Outbox-Operationen verarbeiten oder idempotent beantworten ([Nutzerentscheidung in #102](https://github.com/Yggras/abnehm-app/issues/102#issuecomment-6277236681)); alte Client-Hüllen bleiben abgewiesen. Bei zukünftigen Formänderungen sind dafür explizite versionierte Decoder/Transformationen nötig; eine nicht sicher transformierbare Operation bleibt mit Diagnose erhalten.
- **Ablauf:** `createSyncEngine(…).sync()` pusht erst, dann pullt es. Der Server verarbeitet einen Push in einer Transaktion. Jedes terminale Ergebnis (`applied`, `already_applied`, `permanently_rejected`) hält er unter der Operations-ID fest, ein vorübergehender Fehler rollt alles zurück (`503`). Der Pull liefert Seiten bis zu einer festen Obergrenze. Die App übernimmt jede Antwort in einer SQLite-Transaktion und speichert den Cursor erst mit der letzten Seite. Eine Zeile mit offener Operation überschreibt sie nie.
- **Haken:** `onCanonicalChanges(tx, changes)` der Engine läuft in derselben Transaktion wie jede Übernahme; dort dockt der Persistenzdienst der Tagesziele an (#105). Jede gemeldete Übernahme trägt die Tage, die ihre Zeile davor und danach betraf (`affectedDays` des Adapters). Serverseitige Vor-Pull-Schritte meldet ein Bereich mit `backend.sync.registerPrePullStep(name, step)` an. Sie laufen vor jeder Pull-Antwort in eigener Transaktion und müssen idempotent sein.
- **Fachbefehle (#100):** `CommandType` in `@abnehm/contracts/sync` ist der geschlossene Katalog. Lokal registriert ein Bereich `LocalCommand` bei `createLocalCommandRegistry`: `apply` und die Outbox entstehen in **einer** `LocalDatabase.transaction`; `reconcileRejected` nimmt dauerhaft abgelehnte Änderungen samt Ableitungen zurück. Die Engine ruft dies innerhalb ihrer Ergebnistransaktion auf. Auf dem Server registriert der Bereich `ServerCommand` mit Ressourcen-Policy (`befehl`), Payload-Schema, kanonischer Request-Nutzlast für den **fachlichen** Hash, Identitätsart (`mapped` für lokal erzeugte Entitäten) und `duplicate`-Zuordnung; der **vollständige** Request-Hash schützt unabhängig davon dieselbe Operations-ID. `execute` schreibt Fachänderung, Ableitungen und Änderungslog im Savepoint. Fachlich ungültige Befehle werfen `CommandRejection`; Infrastrukturfehler rollen den ganzen Push zurück. Benachrichtigungen schreibt nur `insertNotificationIntent(tx, raw)` über das Vertragsschema innerhalb dieses Savepoints. Die lokal gemeldeten `affectedRefs` eines Fachbefehls schützen optimistische Fachzeilen vor Pull-Übernahme. Kanonische ID-Zuordnungen rufen den Bereichsadapter `replaceCanonicalId` auf und schreiben noch nicht versendete Outbox-Nutzlasten, betroffene IDs und fachliche Schlüssel atomar um: Nur mit `referencePaths` deklarierte UUID-Felder werden geändert, keine freien Texte. Jeder lokale Befehl deklariert seine Referenzpfade, Entitätsadapter ihre Upsert-Referenzen bei Bedarf. Bereits versendete Operationen bleiben bytegleich für einen sicheren Retry; ein Push-Batch endet beim ersten Fachbefehl, damit spätere Änderungen erst nach dessen ID-Zuordnung versendet werden. Neuere lokale Änderungen bleiben bis zur Bestätigung erhalten. Ein fehlender Adapter bricht die lokale Übernahme ab und erhält die Outbox.
- **Aufbewahrung:** Änderungsprotokoll, Löschmarkierungen und verarbeitete Operationen bleiben dauerhaft erhalten; es gibt keinen Job, der sie bereinigt.
- **Person und Zeitzone ([#110](https://github.com/Yggras/abnehm-app/issues/110)):** Bereiche ändern Felder der eigenen Person nur mit `updateOwnPerson(tx, writer, change, at)` aus `src/sync`. Das betrifft Spezifikation 1 (Körperdaten, Onboarding-Stand) und Spezifikation 5 (Anzeigename). Die Funktion schreibt die Zeile und den vollständigen Person-Upsert (Last-Write-Wins) in derselben Transaktion. Konto-Verweis, Zeitzone und Serverfelder gehören nicht dazu. Ändert sich der Anzeigename, zieht der Server ihn in derselben Transaktion am Kopplungsmitglied nach.
  - `time_zone` ändert ausschließlich der Fachbefehl `updatePersonTimeZone` (`apps/backend/src/person/time-zone.ts`, App-Seite `src/sync/person-time-zone.ts`).
  - Jeder Wechsel trägt einen eigenen fachlichen Schlüssel (`personTimeZoneKey`). Der Befehl ändert lokal nichts vorab, die Zone kommt mit dem kanonischen Ergebnis.
  - Auslöser ist `followPersonTimeZone` in `src/session/`. Er reagiert, sobald die Person auf dem Gerät ist (beim Start oder mit dem ersten Pull), , bei jeder Rückkehr in den Vordergrund und bei offener App jede Minute. Eine Zone, die ein Pull von einem anderen Gerät bringt, löst nichts aus.
  - `apps/backend/test/person-sync-app.test.ts` prüft das mit zwei Installationen auf echtem SQLite.
- **Tests:** `apps/backend/test/sync-push.test.ts`, `sync-pull.test.ts` und `sync-authorization.test.ts` prüfen das Protokoll über HTTP. `sync-app.test.ts` lässt Engine, Outbox und Adapter der App auf echtem SQLite gegen die echte Hono-App laufen. Deshalb gehört er wie `app-auth.test.ts` zu `tsconfig.app-auth.json`, und `vitest.config.ts` lädt die `.sql`-Migrationen der App als Text. `apps/mobile/src/sync/engine.test.ts` steuert den Transport selbst und prüft Transaktionen, Reconciliation und atomare Seiten. Als Entität dient beiden die Test-Entität auf `water_entry` (`TestWaterUpsert` aus `@abnehm/contracts/fixtures`, App-Seite in `src/sync/testing/`). Der Fachbefehl-Testadapter wird ausschließlich unter `test/` beziehungsweise `src/sync/testing/` angemeldet, nicht im produktiven Composition Root. Den echten Wassereintrag meldet Spezifikation 3 an.

### Kopplung: Einladung, Code prüfen und Annahme

Die drei Online-Abläufe zum Koppeln ([#103](https://github.com/Yggras/abnehm-app/issues/103), Abschnitt 9 der [Spezifikation 0](https://github.com/Yggras/abnehm-app/issues/71)) liegen in `apps/backend/src/coupling/`. Verträge, Fehlercodes und die kanonischen Datensätze stehen in `@abnehm/contracts/coupling`.

- **Endpunkte:** `POST /v1/invitations` (Code erzeugen), `/v1/invitations/check` (Code prüfen, ohne ihn zu verbrauchen) und `/v1/invitations/accept` (annehmen). Alle verlangen eine Sitzung und eine Person.
  - Fachliche Ablehnungen kommen mit `422` und einem Code aus `InvitationErrorCode`, die Begrenzung mit `429` und `invite_rate_limited`.
  - Eine wiederverwendete `requestId` mit anderem Inhalt ergibt `409` mit `operation_conflict`, eine fremde `403` mit `forbidden`.
- **Code:** sechs Ziffern, 24 Stunden gültig, einmal verwendbar. Gespeichert wird nur ein HMAC mit eigenem Secret (`secrets/invite_code_secret`). Der Code ist eine HMAC-Ableitung der zufälligen Einladungs-ID (`invite-codes.ts`). So liefert ein Retry derselben Erzeugung denselben Code, ohne dass der Klartext gespeichert wird.
- **Aufbewahrung der Einladungen:** Verbrauchte Einladungen bleiben erhalten. Eine abgelaufene, nie verbrauchte Einladung ist ein technischer Rest ohne fachlichen Zweck, sperrt aber über den Unique-Index offener Codes ihren Wert. Braucht eine neue Einladung genau diesen HMAC, löscht das Erzeugen sie in derselben Transaktion. Das ist die Aufbewahrungsregel, nach der Abschnitt 8 der Spezifikation 0 technische Daten physisch löschen lässt.
- **Idempotenz:** Erzeugen und Annehmen tragen eine clientseitige `requestId`. Das Ergebnis eines Erfolgs liegt in `online_request`, gebunden an Konto, Ablaufart und einen HMAC der Anfrage, und kommt bei identischem Retry unverändert zurück. Ablehnungen werden nicht gespeichert, ein Retry rechnet sie neu.
- **Begrenzung** (`invitation-limiter.ts`): fünf Fehlversuche je Konto bzw. je Code in 15 Minuten, 20 Versuche je IP in der Stunde, für Prüfen und Annehmen. Die IP bestimmt das Auth-Modul (`ipAddressOf`) wie bei der Anmeldung. Die Zähler liegen wie dort im Speicher des Prozesses.
  - Ein Versuch zählt schon zu Beginn als Fehlversuch und wird bei einem anderen Ausgang wieder freigegeben. So kommen auch gleichzeitige Anfragen nicht an der Sperre vorbei.
  - `already_coupled` gilt nur für die eigene Kopplung und wird vor dem Code geprüft. Ist die einladende Person inzwischen gekoppelt, antwortet der Server mit `invite_invalid`, damit die Antwort nicht verrät, dass es den Code gibt.
- **Annahme** in einer Transaktion: zuerst die Sync-Clock wie beim Push, dann die Einladung, dann beide Personen in ID-Reihenfolge. Unique-Verletzungen, Deadlocks und Serialisierungsfehler wiederholt der Ablauf und kommt so zu einem stabilen Ausgang, etwa `already_coupled`.
  - Für dasselbe Paar reaktiviert `couple.ts` die archivierte Kopplung samt Insel, Rollen und Freigaben, sonst legt es alles neu an.
  - Jede Zeile bekommt eine Serverversion und einen Eintrag im Änderungsprotokoll. Kopplung, Mitglieder und Insel sieht jedes aktive Mitglied, die Freigaben nur ihre Eigentümerin.
  - Die Annahme schreibt den Sicherheitslog-Eintrag `kopplung`.
- **Anzeigename:** Ändert der Person-Upsert den Namen, zieht `followDisplayName` ihn in derselben Transaktion bei allen Kopplungsmitgliedern der Person nach.
- **Sync:** Kopplung, Mitglieder, Insel und Freigaben sind auf beiden Seiten angemeldet (`coupling-entities.ts`), ohne generisches Upsert oder Löschen. In der App übernimmt das Mitglied seinen `coupling_status` aus der lokalen Kopplung.
- **App-Modul** `apps/mobile/src/online/`:
  - Bildschirme nutzen nur `useCreateInvitationCode`, `useCheckInvitationCode` und `useAcceptInvitation` unter `OnlineFlowsProvider`. TanStack Query v5 ist dort reine flüchtige Orchestrierung (`gcTime: 0`, keine stillen Wiederholungen) und nur in diesem Modul erlaubt (Regel `abnehm/bibliotheksgrenzen`).
  - Bis zum Erfolg trägt jede Wiederholung derselben Absicht dieselbe `requestId`. Nach der Annahme stößt das Modul einen Sync an; die Kopplung liest der Bildschirm aus SQLite.
  - Den Provider bindet ein, wer die Bildschirme liefert ([#120](https://github.com/Yggras/abnehm-app/issues/120)), mit `createDeviceInvitationFlows({ fetch: auth.fetch, sync })`.
- **Tests:**
  - `apps/backend/test/invitations.test.ts` prüft die Abläufe über HTTP, einschließlich Konkurrenz und Reaktivierung.
  - `online-app.test.ts` lässt Modul und App-Sync gegen die echte Hono-App laufen.
  - Komponententests nutzen den Online-Test-Adapter `online/testing/fake-invitation-flows.ts` (`respond`, `hold`, `calls`).

### Seeds und Testfähigkeiten

Synthetische Szenarien, steuerbare Test-Adapter und Release-Sperren nach Abschnitt 12 der [Spezifikation 0](https://github.com/Yggras/abnehm-app/issues/71) ([#112](https://github.com/Yggras/abnehm-app/issues/112)). Es gibt sie nur in Development- und Testartefakten.

- **Registry:** `test/test-capabilities.ts` führt jede Testfähigkeit mit Modulen, Einstiegen (Routen, Deep Links, Kommandos) und Markern: `seed`, `testuhr`, `fehler-adapter`, `testgeruest`. Jede Datei unter `apps/backend/dev/`, `apps/mobile/src/test-capabilities/` und `packages/contracts/seeds/` muss genau einer Fähigkeit gehören. Eine neue Testfähigkeit trägt sich dort ein und erhält damit ihre eigenen negativen Produktionsartefakt-Tests.
- **Release-Sperren:** `test/release-sperren.test.ts` prüft je Fähigkeit das Produktions-Image des Backends (COPY-Anweisungen der Stage `production` abzüglich `.dockerignore`) und das mit `expo export` erzeugte Produktions-Bundle der App (Source Maps und Bundle-Text). Die Gegenprobe an den Development-Artefakten zeigt, dass die Prüfung anschlagen würde. `apps/backend/test/release-sperren.test.ts` ergänzt, dass das laufende produktive Backend jede registrierte Route mit `404` beantwortet. Der App-Teil exportiert beide Bundles und dauert deshalb einige zehn Sekunden.
- **Manifeste:** `@abnehm/contracts/seeds` (Ordner `packages/contracts/seeds/`, außerhalb von `src/`) enthält Format (`SeedManifest`), gemeinsame IDs (`seedIds`, Konten, Installationen, feste Uhr `2026-10-14T12:00:00Z` in `Europe/Berlin`) und die Szenarien. Ein Manifest nennt Konten, Installationen, Katalogversion, Ausgangszustand (`initial`: Zeilen in Postgres, je Installation lokale Zeilen, Cursor und Outbox), die benannten Schritte und den Sollzustand (`target`). Zeilen stehen in kanonischer JSON-Form unter ihren SQL-Namen. E-Mails stehen nur in `accounts`, ausschließlich `.test`-Adressen.
- **Bereiche ergänzen Szenarien:** Ein Szenario setzt sich aus Beiträgen je Bereich zusammen (`soloParts` in `seeds/solo.ts`). `buildSeedState` vergibt die Serverversionen in Beitragsreihenfolge, schreibt Änderungsprotokoll und Sync-Clock und spiegelt die eigenen Entitäten auf die Installationen. Einträge im Änderungsprotokoll entstehen nur für Entitäten mit `entityType`, also solche, die beim Sync angemeldet sind; ein Bereich ergänzt `entityType`, sobald er seine Entität anmeldet. Eine schon belegte ID lehnt der Baukasten ab.
- **Seed-Strategie:** Seeden setzt die ganze Datenbank auf den Ausgangszustand zurück, in Postgres per `TRUNCATE` aller Tabellen in einer Transaktion (die Zeilen-Trigger unveränderlicher Entitäten feuern dabei nicht), lokal durch Leeren aller Tabellen der Kontodatenbank. Konten entstehen mit fester ID und gesalzenem Passwort-Hash, ohne Sitzung. Wiederholtes Seeden ergibt für Fach- und Sync-Daten exakt denselben kanonischen Stand (`dumpServer`, `dumpLocalDatabase`). Better-Auth-Tabellen prüfen die Tests semantisch (ID, E-Mail, Hash passt zum Testpasswort). Das Sicherheitslog vergleichen sie nicht, denn jede Anmeldung schreibt dort. Nach dem Einfügen prüft der Seeder, dass außerhalb der Better-Auth-Tabellen keine Spalte eine E-Mail enthält (`tablesWithEmail`), sonst rollt er zurück.
- **Uhr:** In Tests steuern `createTestClock` (Backend: `createTestBackend({ clock })`) und `createAppTestClock` (App) die Zeit. Das laufende Development-Backend nutzt die Systemuhr; nach einem Seed steht nur die App auf der Uhr des Manifests. Für `solo` genügt das, weil kein Serverschritt einen lokalen Tag braucht. Eine steuerbare Serveruhr im Development-Backend trägt das Szenario-Ticket nach, das sie braucht (#113, #116), samt Eintrag in der Registry.
- **Grenze für E2E-Builds:** `src/build-capabilities.ts` hängt an `__DEV__`. Die E2E-Builds aus #114 sind Release-Binaries (`__DEV__` ist dort `false`); #114 erweitert die Bedingung um eine eigene Build-Variante und registriert seinen Transport-Fehlermodus. Der Release-Test prüft weiter das Produktions-Bundle.
- **Development-Backend:** `apps/backend/dev/` bettet die App des Backends in die Testfähigkeiten ein (`POST /dev/seed` mit `{ "scenario": "solo" }`). Das Dockerfile hat die Stages `development` (mit `apps/backend/dev/` und den Manifesten, von `compose.yaml` genutzt) und `production` (Standard, ohne beides). Seeden von der Kommandozeile: `scripts/dev-seed solo`.
- **Seed-Deep-Link (App, nur Development Build):** `abnehmapp-dev://seed?szenario=solo` seedet das Development-Backend, stellt die Testuhr auf die Uhr des Manifests, meldet das Testkonto über das Auth-Modul an, seedet die lokale Datenbank der Installation und öffnet „Heute“. Optional `installation=<schlüssel>` und `ziel=<pfad>`, etwa `ziel=/capture/water`. Testkonto von `solo`: `philipp@example.test`, Passwort `momo-insel-testpasswort`. Im Simulator etwa `xcrun simctl openurl booted 'abnehmapp-dev://seed?szenario=solo'` bzw. `adb shell am start -a android.intent.action.VIEW -d 'abnehmapp-dev://seed?szenario=solo'`.
- **Fehler-Adapter (App, nur Development Build):** `abnehmapp-dev://fehler?transport=offline|response_lost&server=unavailable&auth=session_rejected&storage=unavailable` stellt die Adapter um `fetch` und SessionStore der App-Sitzung; `abnehmapp-dev://fehler` ohne Parameter stellt alles auf `ok`. In Tests steuern `createFaultController`, `faultyFetch` und `faultySessionStore` aus `src/test-capabilities/faults.ts` dasselbe, die Zeit `createAppTestClock` bzw. `createTestClock`.
- **App-Sitzung:** `src/session/` setzt Auth-Modul, kontogetrennte Datenbanken und Uhr zusammen (`createAppSession`, auf dem Gerät `deviceSession()`). Der Kopf von „Heute“ ist ab dem Start registriert und folgt der jeweils geöffneten Kontodatenbank (`followTodayPerson`). Das Root-Layout stellt `appClock` bereit: die Geräteuhr, im Development Build die Testuhr. Weil die App-Sitzung SecureStore schon beim Start lädt, braucht ein Development Build von vor #97 einen Neubau (`npm run ios` bzw. `npm run android`), sonst fehlt das native Modul `ExpoSecureStore`.
- **Cookies:** Das Auth-Modul der App schickt jede Anfrage mit `credentials: 'omit'`. Expo ersetzt das globale `fetch` durch `expo/fetch`, das Cookies sonst speichert und mitsendet (Standard `include`); Better Auth verlangt bei einem Cookie einen Origin-Header und lehnte die zweite Anmeldung auf einem Gerät ab (im Simulator beobachtet).

## Befehle

Alle Befehle laufen im Repo-Root:

| Befehl | Wirkung |
| --- | --- |
| `npm install` | Abhängigkeiten aller Workspaces |
| `npm run backend` | Legt fehlende lokale Secrets an, baut und startet Backend und Postgres. Der Watch-Modus spielt Änderungen an `apps/backend/src` und `packages/*/src` ein. |
| `npm run backend:lan` | Wie `backend`, gibt das Backend zusätzlich auf der LAN-Adresse frei (siehe „Echte Geräte“) |
| `npm run backend:down` | Stoppt beide Container; die Datenbank bleibt im Volume erhalten |
| `npm run ios --workspace @abnehm/mobile` | Development Build im iOS-Simulator |
| `npm run android --workspace @abnehm/mobile` | Development Build im Android-Emulator |
| `npm run typecheck` | Typprüfung aller Workspaces |
| `npm run lint` | ESLint über das ganze Repo, einschließlich der Importgrenzen |
| `npm run test:app` | App-Tests (Jest) |
| `npm run test:node` | Backend-, Paket- und repoweite Tests (Vitest, `test/`). Startet dafür ein eigenes Postgres in Docker. |

Native Abhängigkeiten der App kommen immer per `npx expo install <paket>` aus `apps/mobile`, damit die Version zum SDK passt ([Expo CLI](https://docs.expo.dev/more/expo-cli/#install)). Die Ordner `ios/` und `android/` erzeugt Expo bei Bedarf (Continuous Native Generation). Sie stehen nicht in Git und werden nicht von Hand bearbeitet.

Der CI-Workflow `.github/workflows/ci.yml` führt bei jedem Pull Request Typprüfung, Lint und beide Testsuiten aus. Die Runner des privaten Repos haben nur 2 vCPUs, Vitest arbeitet dort die Dateien nacheinander ab. Deshalb laufen die Tests in parallelen Jobs: Typprüfung, Lint und App-Tests in einem, die Vitest-Suite ohne Release-Sperren in zwei Teilen (`--project '!release' --shard 1/2` bzw. `2/2`) und die Release-Sperren als eigenes Vitest-Projekt `release` (`--project release`).

## Secrets

- Das Datenbankpasswort liegt in `secrets/postgres_password`, das Better-Auth-Secret in `secrets/better_auth_secret` und das Secret für die HMACs der Einladungscodes in `secrets/invite_code_secret`. Die beiden letzten haben mindestens 32 Zeichen, nur das Backend erhält sie. `scripts/dev-secrets` erzeugt alle zufällig, und `npm run backend` ruft das Skript selbst auf.
- `secrets/` ist von Git und vom Docker-Build-Kontext ausgeschlossen.
- Docker Compose bindet die Datei zur Laufzeit als Secret unter `/run/secrets/` ein. Das Backend liest Geheimnisse nur aus Dateien (`*_FILE`), nie aus Umgebungsvariablen, Git oder dem Image ([#22](https://github.com/Yggras/abnehm-app/issues/22)).
- Die Integrationstests erzeugen für jeden Lauf ein eigenes Zufallspasswort.

## Netzwerk

- **Postgres** veröffentlicht keinen Port. Die Datenbank ist nur im Docker-Netz erreichbar, weder vom Host noch aus dem WLAN.
- **Backend** lauscht standardmäßig nur auf `127.0.0.1:8787`. Docker veröffentlicht Ports sonst auf allen Adressen des Hosts ([Docker: Port publishing](https://docs.docker.com/engine/network/port-publishing/)).

### Simulator und Emulator

Ohne weitere Angabe nutzt ein Development Build den Entwicklungsrechner:

- iOS-Simulator: `http://localhost:8787`
- Android-Emulator: `http://10.0.2.2:8787`. Die Adresse ist dort der „Special alias to your host loopback interface“ ([Android: Emulator networking](https://developer.android.com/studio/run/emulator-networking-address)).

Eine andere Adresse setzt `EXPO_PUBLIC_API_URL` beim Start von Metro, etwa `EXPO_PUBLIC_API_URL=http://192.168.178.20:8787 npm start --workspace @abnehm/mobile`. Expo setzt `EXPO_PUBLIC_`-Variablen beim Bündeln ein ([Expo: Environment variables](https://docs.expo.dev/guides/environment-variables/)). Persönliche Werte gehören in `apps/mobile/.env.local`; die Datei ist von Git ausgeschlossen.

### Echte Geräte

Zwei Wege, beide nur mit Development Builds:

1. **Gezielt im WLAN veröffentlichen.** `compose.lan.yaml` gibt das Backend zusätzlich zu `127.0.0.1` auf der LAN-Adresse des Rechners frei. Simulatoren erreichen es weiter wie gewohnt, Postgres bleibt unerreichbar:

   ```sh
   BACKEND_PUBLISH_ADDRESS=192.168.178.20 npm run backend:lan
   EXPO_PUBLIC_API_URL=http://192.168.178.20:8787 npm start --workspace @abnehm/mobile
   ```

   Nach dem Test das Backend wieder mit `npm run backend` starten. „Verbindung und Uhr prüfen“ auf „Heute“ (nur Development Build, `abnehmapp-dev://technik`) zeigt, welche Adresse die App nutzt.

2. **Entwicklungstunnel mit HTTPS**, z. B. `ngrok http 8787` ([ngrok](https://ngrok.com/docs/getting-started/)) oder `cloudflared tunnel --url http://localhost:8787` ([Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)). Die ausgegebene `https://`-Adresse kommt in `EXPO_PUBLIC_API_URL`. Über HTTPS braucht die App keine Netzwerkausnahme. Der Tunnel macht den Status-Endpunkt öffentlich erreichbar, solange er läuft.

### Netzwerkausnahmen nur im Development Build

Unverschlüsseltes HTTP zum Entwicklungsrechner ist nur im Development Build erlaubt:

- **iOS:** `app.config.ts` ersetzt das ATS-Wörterbuch der Expo-Vorlage.
  - Nur mit `APP_VARIANT=development` enthält es `NSAllowsLocalNetworking`. Der Schlüssel erlaubt Verbindungen zu „unqualified domains, .local domains, and IP addresses“ ([Apple: NSAllowsLocalNetworking](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking)).
  - Ohne die Variable entsteht der Produktionsbuild ohne Ausnahme.
  - Die npm-Skripte `start`, `ios` und `android` setzen die Variable selbst.
- **Android:** Klartext erlauben nur die Debug-Manifeste der Expo-Vorlage, `android/app/src/debug/` und `debugOptimized/` mit `usesCleartextTraffic` ([Vorlage SDK 58](https://unpkg.com/expo-template-bare-minimum@58.0.23/android/app/src/debug/AndroidManifest.xml)). Release-Builds verbieten ihn, denn „Starting with Android 9 (API level 28), cleartext support is disabled by default“ ([Android: Network security configuration](https://developer.android.com/privacy-and-security/security-config)).
- **Variante wechseln:** Die Variante wirkt beim Erzeugen der nativen Ordner. Wer lokal wechselt, erzeugt sie neu, etwa mit `APP_VARIANT=production npx expo prebuild --clean`. So bleibt keine Einstellung der anderen Variante zurück.

Development- und Produktionsbuild haben verschiedene Bundle-IDs (`de.yggras.abnehmapp.dev` und `de.yggras.abnehmapp`) und lassen sich nebeneinander installieren.
