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
- **Testuhr:** `@abnehm/clock/testing` und `@abnehm/clock/conformance` erlaubt Lint nur in Testdateien. Ins Backend-Image kommen sie nicht (`.dockerignore`). Development-Artefakte wie Seeds registrieren Testfähigkeiten später zentral ([#112](https://github.com/Yggras/abnehm-app/issues/112)).

### Vertragsmodul

`@abnehm/contracts` ist die einzige Quelle für Zod-Schemas und Typen, die App und Backend teilen ([#94](https://github.com/Yggras/abnehm-app/issues/94)).

- **Zuschnitt:** je Fachbereich eine Datei und ein Teilpfad, etwa `@abnehm/contracts/daily-goals` oder `@abnehm/contracts/today`. Ein Paket-Barrel und weitergereichte Exporte gibt es nicht. Bereiche importieren sich nicht im Kreis. `packages/contracts/test/struktur.test.ts` prüft das.
- **Zeit im Vertragsmodul:** Es liest nie die aktuelle Zeit oder Gerätezone. `Date.UTC` dient nur der zonenfreien Kalenderrechnung auf lokalen Tagen, `Intl` nur der Prüfung, ob eine IANA-Zone existiert.
- **Regeln für Schemas:** Diskriminierte Unions unterscheiden über `type`. Objekte sind strikt (`z.strictObject`), Optionales steht als `optional()` bzw. `nullable()` im Schema. Ungültige Kombinationen scheitern am Schema, etwa ein falsches Vorzeichen einer Energiebuchung. Sichtbaren Text gibt es im Transport nicht, nur `messageKey` und typisierte Werte.
- **Fixtures:** Jedes exportierte Schema hat unter `packages/contracts/fixtures/` mindestens ein gültiges und ein ungültiges Beispiel, eingetragen im Register `fixtures/index.ts`. Fehlt ein Eintrag, scheitert `fixtures.test.ts`. Dieselben Fixtures laufen automatisch durch drei Vertragstests: im Paket, in der App (`apps/mobile/src/contracts/fixtures.test.ts`, Jest) und im Backend über die Hono-Validierung `jsonBody` (`apps/backend/test/contract-validation.test.ts`). `@abnehm/contracts/fixtures` ist nur in Testdateien erlaubt.
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
- **Bildschirm liefern:** Eine Routendatei enthält `export default placeholderRoute('capture.food')`. Ein Bereich ersetzt das durch `export default routeScreen('capture.food', SeinBildschirm)`. `routeScreen` prüft die Parameter mit dem Schema der Route; unbekannte Ziele und ungültige Parameter öffnen „Heute“. Den Rahmen mit „Zurück“ bzw. „Fertig“ gibt `ScreenFrame` aus `src/shell/ScreenFrame.tsx`.
- **Platzhalter:** Development Builds zeigen für fehlende Bildschirme einen deutschen Platzhalter mit dem liefernden Bereich. In Release-Builds wirft er `MissingContributionError`; ein fehlender Beitrag ist dort ein Integrationsfehler.
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

- **Je Konto eine Datei** (`konto-<konto-id>.db`). `LocalDatabases.open(kontoId)` öffnet und migriert sie, `lock()` schließt sie bei `401`. Wer ein anderes Konto öffnet oder sperrt, beendet alle Handles und Beobachtungen des bisherigen; sie werfen danach `LocalDatabaseClosedError`.
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

### Ports zwischen Bereichen

`PlanReader`, `WeightTrendReader`, `IntakeReader`, `WeightRecorder` und der optionale `IslandCheckInHintReader` (Schnittstellen in `@abnehm/contracts/ports`) sind keine Registry. Ein Modul, das einen Port braucht, nimmt ihn als Pflichtparameter entgegen.

- **Zusammensetzen:** `composeAreaPorts(database, providers)` aus `apps/mobile/src/area-ports/` ruft je Port die Fabrik des liefernden Bereichs auf.
  - Lese-Ports bekommen nur `read`, also Lesetransaktionen. Der `WeightRecorder` bekommt zusätzlich `transaction` für seine eigene Transaktion.
  - Fehlende Pflichtports und Methoden meldet `IncompleteAreaPortsError` auf einmal. Ohne Insel-Hinweis ist `islandCheckInHintReader` `null`.
- **Validieren:** Jede Rückgabe wird gegen ihr Vertragsschema geprüft. Ein Verstoß wirft `PortContractError`. Eine ungültige Eingabe an `recordManualWeight` beantwortet die Prüfung mit `invalid_payload`, ohne den Port aufzurufen.
- **Fake-Ports für Tests** in `area-ports/testing/fakes.ts`: `fakePlanReader` (Fassungen nach `validFrom` und Wochentag), `fakeWeightTrendReader`, `fakeIntakeReader` (jeder Tag, sonst 0), `fakeWeightRecorder` (idempotent je `entryId`) und `fakeIslandCheckInHintReader`. `fakeAreaPorts(overrides)` setzt sie geprüft zusammen.

### Typisierte Endpunkte (Hono RPC)

Die App ruft das Backend über `hc<AppType>` auf ([Hono RPC](https://hono.dev/docs/guides/rpc)). Fachliche Pfade sind versioniert (`/v1/…`).

`apps/mobile/src/backend/status.ts` prüft beim Typecheck, dass die abgeleitete Antwort genau dem Vertrag aus `@abnehm/contracts/status` entspricht. `test/rpc-typisierung.test.ts` belegt das: Ein umbenanntes oder zusätzliches Feld im Backend lässt die Typprüfung der App scheitern.

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

Der CI-Workflow `.github/workflows/ci.yml` führt bei jedem Pull Request Typprüfung, Lint und beide Testsuiten aus.

## Secrets

- Das Datenbankpasswort liegt in `secrets/postgres_password`. `scripts/dev-secrets` erzeugt es zufällig, und `npm run backend` ruft das Skript selbst auf.
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
