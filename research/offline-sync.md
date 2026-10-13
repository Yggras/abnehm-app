# Recherche: Offline-Sync zwischen expo-sqlite und eigenem Postgres-Backend

Ticket: [#34](https://github.com/Yggras/abnehm-app/issues/34) · Stand: 11.10.2026 · Versionen, Release-Daten, npm-Downloads (Woche 04.–10.10.2026) und GitHub-Daten am 11.10.2026 über die öffentlichen APIs von npm und GitHub abgerufen [35][36].

Quellen-Nummern in eckigen Klammern [n] verweisen auf die Liste am Ende. Mit *eigene Rechnung* oder *eigene Einschätzung* markierte Stellen sind nicht durch eine Quelle belegt. Rechtliche Fragen (u. a. Lizenzbedingungen im Detail) werden laut `AGENTS.md` vorerst nicht betrachtet. Lizenzen sind nur als Name genannt.

## Ausgangslage

- **Bereits festgelegt:** Expo (React Native, TypeScript strict) mit Expo Router und **expo-sqlite** [2]. Backend: eigenes TypeScript-Backend auf dem vorhandenen Hetzner-Server in Docker, Hono + Drizzle + Postgres, Better Auth, Expo Push [2].
- **Autorisierung:** Sie soll „deny by default“ sein, Partnerfreigaben inklusive, und serverseitig an einer zentralen Stelle liegen [1].
- **Expo Go ist ohnehin raus:** HealthKit/Health Connect und Push brauchen einen Development Build [3]. Native Sync-Bibliotheken sind deshalb kein Ausschlussgrund. Ein Ersatz von expo-sqlite würde aber eine getroffene Entscheidung berühren.
- **expo-sqlite in SDK 57:** Expo SDK 57 (`expo` 57.0.27) bündelt `expo-sqlite` ~57.0.4 [4]. Die Bibliothek ist laut Doku in Expo Go enthalten [5]. Einen eingebauten Sync zu Postgres hat sie nicht. Folgende Bausteine bringt sie mit [5]:
  - die SQLite-**Session-Extension** (`createSessionAsync`, Changesets als `Uint8Array`),
  - einen **Change-Listener** (`addDatabaseChangeListener`, wenn `enableChangeListener` gesetzt ist),
  - eine **libSQL-Option** (`syncLibSQL()`). Sie synchronisiert nur gegen einen libSQL-Server, nicht gegen Postgres.
- **Drizzle auf dem Gerät:** Drizzle hat einen eigenen Treiber für expo-sqlite [6]:
  - Migrationen werden in die App gebündelt (`useMigrations`, Babel-Plugin für `.sql`).
  - `useLiveQuery` rendert bei Datenänderungen neu (braucht `enableChangeListener`).
  - `drizzle-orm` steht aktuell bei 0.45.4 (08.10.2026), 1.0 ist als `rc` getaggt (1.0.0-rc.4) [35].

## Zusammenfassung

- **Keine fertige Engine passt ohne Abstriche.** Die zwei ernsthaften Kandidaten sind **PowerSync** (Open Edition, selbst gehostet) und **ElectricSQL + TanStack DB**. Beide brauchen auf Postgres `wal_level = logical` und einen zusätzlichen Docker-Dienst [11][24]. Beide definieren die Lese-Rechte in einer **eigenen Regel-Schicht** (Sync Streams bzw. Shape-Proxy) [13][22]. Damit hätte die Autorisierung eine zweite Stelle neben dem Hono-Backend.
- **PowerSync** ist am weitesten ausgebaut:
  - Expo-SDK, offizieller Drizzle-Treiber, dokumentierte Konfliktbehandlung (Standard: Last-Write-Wins pro Feld, Löschen gewinnt) [7][8][14].
  - Schreibzugriffe laufen über **das eigene Backend** (`uploadData`) [7][15].
  - Aber: Das SDK nutzt **op-sqlite statt expo-sqlite**. In Expo Go läuft es nur mit einem JS-Entwicklungsadapter [7].
  - Der Dienst steht unter der source-available-Lizenz FSL-1.1-ALv2 [17].
- **ElectricSQL** synchronisiert **nur den Lesepfad**. Schreiben ist ausdrücklich Sache der App [20].
  - Offline-Schreiben wäre erst mit TanStack DB möglich (`@tanstack/offline-transactions`, `@tanstack/expo-db-sqlite-persistence`). TanStack DB ist mit Version 0.13.0 noch vor 1.0 [25][35].
- **Ausgeschieden:**
  - **Zero:** kann offline nicht schreiben („Zero does not support offline writes“) [29].
  - **Replicache:** im Wartungsmodus [30].
  - **WatermelonDB:** letztes Release 0.28.0 vom 07.04.2025, keine offizielle Expo-Doku, eigene SQLite-Schicht statt expo-sqlite [27][35][36].
  - **TinyBase und Legend-State:** keine passende Postgres-Anbindung mit serverseitiger Rechteprüfung pro Zeile [31][32][33].
- **Selbst gebauter Sync ist für dieses Projekt überschaubar** (*eigene Einschätzung*). Gründe:
  - Es gibt 2 Nutzer.
  - Die Daten sind überwiegend eigene Einträge pro Person (Mahlzeiten, Wasser, Gewicht, Sport).
  - Partnerdaten sind meist nur zu lesen.
  - Das Pull/Push-Protokoll von WatermelonDB ist eine gut dokumentierte, erprobte Vorlage mit klaren MUST-Regeln für Zeitstempel, Tombstones, Konflikte und Rechteentzug [26].
- **Empfehlung (Vorschlag, Entscheidung beim Nutzer):**
  - **Selbst gebauter Sync** nach dem Vorbild des WatermelonDB-Protokolls.
  - Auf dem Gerät expo-sqlite + Drizzle mit einer Outbox-Tabelle.
  - Auf dem Server zwei Hono-Endpunkte (`/sync/pull`, `/sync/push`), die dieselbe zentrale Autorisierung nutzen wie die übrige API.
  - Konfliktregel: Last-Write-Wins pro Zeile in der Reihenfolge des Server-Eingangs, Löschen gewinnt.
  - **Plan B:** PowerSync Open Edition mit Postgres als Bucket-Speicher, falls Sync-Anforderungen deutlich wachsen (z. B. Veröffentlichung, Echtzeit, viele Geräte).

## Kandidaten im Detail

### 1. PowerSync (Open Edition, selbst gehostet)

- **Versionen und Lizenz:**
  - `@powersync/react-native` 2.3.1 vom 01.10.2026 (Apache-2.0), 49.018 Downloads pro Woche [35].
  - Dienst `powersync-service` v1.27.0 vom 06.10.2026, letzter Push am 08.10.2026 [36].
  - Lizenz des Dienstes: **FSL-1.1-ALv2** („Functional Source License … ALv2 Future License“). Sie erlaubt u. a. „internal use“ und schließt „Competing Use“ aus [17]. Rechtliche Bewertung: nicht betrachtet.
- **Expo:**
  - Installation per `npx expo install @powersync/react-native @op-engineering/op-sqlite` [7].
  - Der native Adapter ist „not compatible with Expo Go's sandbox environment“. Für Expo Go gibt es den JS-Adapter `@powersync/adapter-sql-js` [7], laut npm „A development DB adapter based on SQL.js“ [35].
  - expo-sqlite wird auf der SDK-Seite nicht erwähnt [7]. Die lokale Datenbank wäre also op-sqlite, **nicht expo-sqlite**.
- **Drizzle:**
  - Offizieller Treiber `@powersync/drizzle-driver` 0.8.0 [8][35]. `DrizzleAppSchema` leitet das PowerSync-Schema aus dem Drizzle-Schema ab, Watch-Queries werden unterstützt [8].
  - Einschränkungen: nur SQLite-Typen `text`, `integer` und `real`. „most Drizzle constraint features (such as cascading deletes, foreign checks, unique) are currently not supported“ [8].
- **Self-Hosting:**
  - Docker-Image `journeyapps/powersync-service`. Ein Dashboard gibt es beim Self-Hosting nicht [9].
  - Als Bucket-Speicher dienen MongoDB oder Postgres. Ab Postgres 14 darf der Bucket-Speicher auf demselben Server wie die Quell-DB liegen, kann aber „higher CPU usage“ verursachen [10].
  - Für die Quell-DB nötig [11]:
    - `wal_level = logical` (Neustart nötig),
    - eine Rolle mit `REPLICATION` und Leserechten,
    - eine Publication namens `powersync`.
  - Minimal-Setup laut Doku [12]:
    - 1 Container (API + Replikation) mit 512 MB RAM und 1 vCPU,
    - dazu MongoDB mit 2 GB RAM. Mit Postgres als Bucket-Speicher entfällt MongoDB [10][18].
  - Eine Demo mit Postgres als Quelle **und** als Bucket-Speicher liegt im offiziellen `self-host-demo` [18].
- **Kosten:** Die Open Edition ist laut Preisseite „free source-available“ [16]. Es fallen nur Serverressourcen an. Zum Vergleich PowerSync Cloud [16]:
  - Free: 0 $, wird nach Inaktivität deaktiviert. Die Seite nennt widersprüchlich 1 bzw. 2 Wochen.
  - Pro: ab 49 $/Monat.
- **Auth:** Der Client authentifiziert sich per JWT, empfohlen ist JWKS mit asymmetrischen Schlüsseln [10]. Better Auth hat ein JWT-Plugin mit JWKS-Endpunkt (`/jwks`, Standard EdDSA/Ed25519, Ablauf 15 Minuten) [19]. Die Kombination ist **nicht offiziell dokumentiert**. Die Bausteine passen laut den beiden Dokus aber zusammen (*eigene Einschätzung*).
- **Autorisierung:**
  - **Lesen:** Was ein Gerät bekommt, legen „Sync Streams“ in YAML fest, gefiltert über `auth.user_id()` (JWT-`sub`). Subqueries auf Freigabe-Tabellen sind ausdrücklich vorgesehen (Beispiel `list_shares … shared_with = auth.user_id()`) [13].
  - **Schreiben:** Schreibzugriffe gehen über das eigene Backend [7][15]. Dort greift die eigene Autorisierung.
  - **Folge (*eigene Einschätzung*):** Partnerfreigaben müssen in Sync Streams **und** im Hono-Backend abgebildet werden.
- **Konflikte:**
  - „By design PowerSync is unopinionated“. Im einfachsten Fall gilt „per-field Last-Write-Wins“, und „Deletes always win“ [14].
  - Validierungsfehler sollen mit `2xx` beantwortet werden, sonst blockiert die Upload-Queue. Der Schreib-Endpunkt muss synchron in die DB schreiben [15].
- **Doku:** umfangreich, mit `llms.txt`-Index für KI-Agenten [8]. Einzelne Seiten sind widersprüchlich, z. B. die Preisseite zur Inaktivitätsfrist [16].

### 2. ElectricSQL (+ TanStack DB)

- **Versionen:**
  - Sync-Dienst `@core/sync-service` 1.8.1 vom 07.09.2026 [36].
  - `@electric-sql/client` 1.5.28 vom 09.09.2026, 1.678.044 Downloads pro Woche [35].
  - Repo `electric-sql/electric`: Apache-2.0, 10.393 Sterne, letzter Push am 06.10.2026 [36].
- **Schreibpfad:** „Electric does not do write-path sync.“ Die Doku beschreibt vier Muster [20]:
  - Online-Writes,
  - optimistischer Zustand,
  - geteilter persistenter optimistischer Zustand,
  - „through-the-database sync“ mit PGlite.
- **Expo:**
  - `@electric-sql/react` mit `useShape`. Im Hintergrund pausieren die Streams über `AppState` [21].
  - „PGlite does not yet work in React Native“ [21]. Muster 4 fällt auf dem Handy also weg.
- **Offline-Persistenz über TanStack DB:**
  - `@tanstack/offline-transactions` 1.1.0 bietet eine dauerhafte Outbox mit Wiederholungen [25][35]. Der Server muss Idempotency-Keys akzeptieren [25].
  - `@tanstack/expo-db-sqlite-persistence` 0.2.33 nennt `expo-sqlite` `^55.0.10 || ^57.0.0` als Peer-Dependency [35]. Das Rezept in der Offline-Doku nutzt dagegen op-sqlite und AsyncStorage [25].
  - `@tanstack/db` steht bei 0.13.0 (10.10.2026), also vor 1.0 [35].
- **Self-Hosting:**
  - Image `electricsql/electric`, Postgres ab Version 14 mit logischer Replikation, Rolle mit `REPLICATION` [24].
  - Der Dienst braucht ein persistentes Dateisystem für den Shape-Cache. Den Speicherbedarf nennt die Doku nur als „highly application dependent“ [24].
  - RAM-Angaben: nicht belegt.
- **Autorisierung:**
  - Shapes sind HTTP-Ressourcen und werden über einen Proxy oder „Gatekeeper“-Tokens autorisiert [22].
  - Shapes umfassen nur eine Tabelle. Subqueries im `where` sind möglich [23].
  - Das Hono-Backend könnte damit der Proxy sein. Die Lese-Rechte stünden dann als Shape-Definitionen im Backend (*eigene Einschätzung*).
- **Konflikte:** Electric selbst löst keine Konflikte, weil es keine Schreibzugriffe synchronisiert [20]. Konflikte entscheidet der eigene Schreib-Endpunkt.

### 3. WatermelonDB-Sync

- **Stand:**
  - `@nozbe/watermelondb` 0.28.0 vom 07.04.2025 (MIT), `next` 0.28.1-0 vom 24.07.2025 [35].
  - Letzter Commit auf dem Hauptzweig am 11.08.2025, 303 offene Issues/PRs [36].
- **Expo:** Die Installationsdoku erwähnt Expo nicht. Sie beschreibt einen eigenen nativen SQLite-Adapter (JSI) [27]. Expo-Config-Plugins gibt es nur von Dritten auf npm (z. B. `@morrowdigital/watermelondb-expo-plugin` 2.3.3 von 05/2024) [35]. expo-sqlite wird nicht genutzt [27].
- **Protokoll (die eigentlich nützliche Quelle)** [26]:
  - **Pull** mit `lastPulledAt`. Antwort: `{ changes: { tabelle: { created, updated, deleted: ids } }, timestamp }`. „MUST provide a consistent view of changes“.
  - **Push** muss „fully transactional“ sein. Ein Konflikt liegt vor, wenn der Datensatz auf dem Server nach `lastPulledAt` geändert wurde. Dann gilt: „MUST abort push and return an error code“.
  - **Server-Empfehlungen:**
    - `last_modified` pro Tabelle, vom Server gesetzt (Client-Werte ignorieren),
    - monoton steigende Zeitstempel,
    - Löschmarkierung oder `deleted_xxx`-Tabelle.
  - **Rechteentzug:** entzogene Rechte als `deleted` melden, neue als `created`.

### 4. Zero / Replicache (Rocicorp)

- **Zero:**
  - `@rocicorp/zero` 1.10.0 vom 09.10.2026 (Apache-2.0) [35]. Unterstützt Expo mit `expoSQLiteStoreProvider` [28].
  - „Zero does not support offline writes“ und „is not designed for long periods offline“ [29]. Damit ist Zero für eine Offline-App ungeeignet.
- **Replicache:** „Replicache is now in maintenance mode“, ohne neue Features. Bestandsnutzer sollen zu Zero wechseln [30]. Letztes Release 15.3.0 vom 02.07.2025 [35].

### 5. TinyBase, Legend-State

- **TinyBase:**
  - 10.0.1 vom 24.09.2026 (MIT) [35].
  - Sync über `MergeableStore` und einen WebSocket-Server [31].
  - „WsServer and WsServerSimple do not authenticate or authorize channel Ids“ [31]. Rechte pro Zeile müsste man selbst bauen.
  - Es gibt Persister für expo-sqlite und Postgres [32]. Postgres-Persister speichern den Store aber als JSON oder als Tabellenabbild. Ein Sync-Protokoll mit Rechteprüfung ist das nicht [32].
- **Legend-State:**
  - Die stabile Version 2.1.15 stammt vom 30.08.2024. Die Sync-Funktionen von v3 sind als „Beta version“ gekennzeichnet (`3.0.0-beta.48` vom 12.07.2026) [33][35].
  - Funktionen: Offline-Retry, `changesSince: 'last-sync'` und ein CRUD-Plugin für eigene Backends.
  - Eine Konfliktstrategie ist nicht dokumentiert [33].

### 6. Selbst gebauter Sync (Drizzle auf beiden Seiten)

Skizze, *eigene Einschätzung*, angelehnt an [26] und [14]:

- **IDs:** UUIDv7 auf dem Gerät erzeugen, damit Einträge offline angelegt werden können. Postgres 18 bietet `uuidv7()` [34]. Auf dem Gerät erzeugt eine JS-Bibliothek die IDs (Auswahl offen).
- **Server-Tabellen (Drizzle `pg-core`):**
  - je Sync-Tabelle `owner_id`, `updated_at` und `version` (`bigint`, vom Server gesetzt),
  - `deleted_at` als Tombstone,
  - eine Freigabe-Tabelle für Partnerfreigaben.
- **Gerät (Drizzle `sqlite-core` auf expo-sqlite):**
  - gleiche Tabellen,
  - eine Outbox-Tabelle mit ausstehenden Änderungen und Idempotenz-Schlüssel,
  - der letzte Pull-Cursor.
  - Lokale Änderung und Outbox-Eintrag werden in einer Transaktion geschrieben.
- **Push (`POST /sync/push`):**
  - Batch aus der Outbox. Der Server prüft jede Zeile mit der zentralen Autorisierung, z. B. „nur eigene Zeilen schreiben“ [1].
  - Er schreibt transaktional und vergibt die `version`.
  - Last-Write-Wins in Eingangsreihenfolge, Löschen gewinnt (wie der PowerSync-Standard [14]).
  - Abgelehnte Zeilen meldet er im `2xx`-Body, damit die Outbox nicht blockiert (Muster aus [15]).
- **Pull (`GET /sync/pull?cursor=`):**
  - Liefert alle für den Nutzer sichtbaren Zeilen (eigene + freigegebene) mit `version > cursor`, inklusive Tombstones.
  - Bei Rechteentzug meldet er die betroffenen IDs als gelöscht [26].
- **Bekannte Stolperfalle:**
  - Werte aus einer Postgres-Sequenz werden in Vergabe-Reihenfolge vergeben. Die Transaktionen können aber in anderer Reihenfolge committen. Ein Pull könnte so eine Zeile überspringen (*eigene Einschätzung*, nicht durch Doku belegt).
  - Gegenmittel: Schreibzugriffe auf die Sync-Tabellen serialisieren (bei 2 Nutzern unkritisch), oder WatermelonDBs Hinweis folgen, den Zeitstempel *vor* der Abfrage zu nehmen [26].
- **Auslöser:** App-Start bzw. Rückkehr in den Vordergrund, nach lokalen Änderungen (gebündelt), optional ein Expo-Push als Anstoß für das Partnergerät [2].
- **Vorteile:**
  - expo-sqlite und Drizzle bleiben wie entschieden [2].
  - Die Autorisierung liegt an **einer** Stelle [1].
  - Kein zweiter Dienst, keine logische Replikation.
  - Nur eigener, testbarer TypeScript-Code.
- **Nachteile:**
  - Eigenverantwortung für Randfälle: Schema-Migrationen zwischen App-Versionen, Uhren, Wiederholungen.
  - Keine Echtzeit ohne Zusatzaufwand.
  - Keine fertige Doku. Die Spezifikation muss das Protokoll präzise festschreiben, damit KI-Agenten es korrekt umsetzen.

## Vergleichstabelle

| Kriterium | PowerSync (Open Edition) | Electric + TanStack DB | WatermelonDB | Zero | Selbst gebaut |
|---|---|---|---|---|---|
| Offline-Schreiben | ja, Upload-Queue [7] | nur mit TanStack-Outbox [20][25] | ja [26] | **nein** [29] | ja (Outbox) |
| Lokale DB | op-sqlite (nicht expo-sqlite) [7] | expo-sqlite möglich (Peer-Dependency) [35] | eigener JSI-Adapter [27] | expo-sqlite oder op-sqlite [28] | expo-sqlite [5] |
| Expo Go | nur mit JS-Dev-Adapter [7] | nicht belegt | nicht dokumentiert [27] | nicht belegt [28] | ja (expo-sqlite in Expo Go) [5] |
| Development Build (ohnehin nötig [3]) | ja [7] | nicht belegt | über Dritt-Plugins [35] | ja (op-sqlite) [28] | ja |
| Drizzle | offizieller Treiber, Einschränkungen bei Constraints [8] | nicht belegt | nein | nein | ja, beidseitig [6] |
| Self-Hosting Docker | ja, `journeyapps/powersync-service` + Bucket-DB [9][10] | ja, `electricsql/electric` [24] | nur Protokoll, Server selbst bauen [26] | nicht geprüft | Teil des Hono-Backends |
| Postgres-Voraussetzung | `wal_level=logical`, Publication [11] | logische Replikation, PG ≥ 14 [24] | keine | nicht geprüft | keine |
| Kosten | Open Edition kostenlos [16]; Ressourcen ab ~512 MB RAM [12] | Open Source (Apache-2.0) [36]; Ressourcen nicht belegt | kostenlos (MIT) [35] | – | keine Zusatzkosten (*eigene Einschätzung*) |
| Konflikte | LWW pro Feld, Löschen gewinnt, Backend entscheidet [14] | Backend entscheidet [20] | Push abbrechen und neu pullen [26] | – | frei wählbar (Vorschlag: LWW pro Zeile) |
| Autorisierung | Lesen: Sync Streams (YAML); Schreiben: eigenes Backend [13][15] | Lesen: Proxy/Gatekeeper; Schreiben: eigenes Backend [22] | im eigenen Server [26] | nicht geprüft | komplett im Hono-Backend |
| Pflegezustand | Release 06.10.2026 [36] | Release 07.09.2026 [36]; TanStack DB 0.x [35] | letztes Release 04/2025 [35] | Release 09.10.2026 [35] | – |
| Doku | umfangreich, `llms.txt` [8] | gut, Schreibpfad bewusst offen [20] | Protokoll präzise [26] | gut [29] | muss selbst geschrieben werden |

Replicache (Wartungsmodus [30]), TinyBase und Legend-State (keine Rechteprüfung pro Zeile bzw. Beta [31][33]) sind nicht in der Tabelle.

## Empfehlung (Vorschlag)

1. **Selbst gebauter Sync** nach dem Vorbild des WatermelonDB-Protokolls [26]:
   - expo-sqlite + Drizzle auf dem Gerät, Hono + Drizzle + Postgres auf dem Server.
   - Pull/Push über zwei Endpunkte, Outbox, serverseitige `version`, Tombstones, LWW pro Zeile, Löschen gewinnt.
   - Begründung (*eigene Einschätzung*):
     - Er erfüllt die Vorgabe „Autorisierung zentral im Backend“ [1] ohne eine zweite Regel-Schicht.
     - Er behält die Entscheidung für expo-sqlite bei [2].
     - Er braucht keine logische Replikation und keinen weiteren Dienst auf dem Server.
     - Er passt zum einfachen Datenmodell: Jede Person schreibt hauptsächlich ihre eigenen Einträge.
2. **Plan B: PowerSync Open Edition** mit Postgres als Bucket-Speicher [10][18], wenn später Echtzeit, viele Nutzer oder komplexe Teilmengen gebraucht werden. Folgen:
   - Wechsel von expo-sqlite zu op-sqlite [7],
   - zusätzlicher Container,
   - Partnerfreigaben zusätzlich in Sync Streams [13].
   - Weil PowerSync Schreibzugriffe ohnehin über das eigene Backend leitet [15], bleiben die Schreib-Endpunkte des Eigenbaus weiter nutzbar (*eigene Einschätzung*).
3. **Vor der Festlegung:** Im Ticket „Offline-Verhalten“ bzw. Datenmodell festlegen, welche Tabellen synchronisiert werden, welche Partnerdaten überhaupt beschreibbar sind und wie Schema-Migrationen zwischen App-Versionen gehandhabt werden.

## Offene bzw. nicht belegbare Punkte

- Ob `@tanstack/expo-db-sqlite-persistence` in Expo Go läuft und wie stabil es ist: nicht belegt (nur Peer-Dependency geprüft) [35].
- PowerSync mit Better-Auth-JWKS: nicht offiziell dokumentiert, nur aus beiden Dokus abgeleitet [10][19].
- PowerSync mit Postgres als Bucket-Speicher und Quell-DB auf demselben Server: Ressourcenbedarf nicht beziffert, nur „higher CPU usage“ [10].
- RAM-/CPU-Bedarf von Electric: nicht belegt [24].
- Freie Ressourcen auf Philipps Hetzner-Server: im Repo nicht dokumentiert.
- Postgres-Version auf dem Server: nicht festgelegt. `uuidv7()` ist in der Doku zu Postgres 18 belegt [34], die Einführungsversion nicht geprüft.
- Zero: Self-Hosting und Autorisierung nicht weiter geprüft, weil das Offline-Schreiben fehlt [29].
- Die Überspring-Gefahr bei sequenzbasierten Cursorn ist eine eigene Einschätzung. Eine Primärquelle wurde dazu nicht gesucht.
- Lizenzbedingungen (FSL-1.1-ALv2 bei PowerSync) im Hinblick auf eine spätere Veröffentlichung: rechtliche Bewertung bewusst ausgeklammert [17].

## Quellen

1. Ticket #34 (Fragestellung, Verweis auf Sicherheit der Gesundheitsdaten #22): https://github.com/Yggras/abnehm-app/issues/34 *(Repo)*
2. Wayfinder-Karte, Entscheidungen „Tech-Stack festlegen“ (#10) und „Backend festlegen“ (#11): https://github.com/Yggras/abnehm-app/issues/1 *(Repo)*
3. Recherche Tech-Stack (#2), „Expo Go reicht nicht“: https://github.com/Yggras/abnehm-app/blob/main/research/tech-stack.md *(Repo)*
4. Expo SDK 57, `bundledNativeModules.json` (`expo@57.0.27`): https://unpkg.com/expo@57.0.27/bundledNativeModules.json *(Expo/npm)*
5. Expo-Doku `expo-sqlite` (v57): https://docs.expo.dev/versions/latest/sdk/sqlite/ *(Doku)*
6. Drizzle ORM, Expo SQLite: https://orm.drizzle.team/docs/connect-expo-sqlite *(Doku)*
7. PowerSync, React Native & Expo SDK: https://docs.powersync.com/client-sdks/reference/react-native-and-expo *(Doku)*
8. PowerSync, Drizzle-Integration (mit `llms.txt`-Index): https://docs.powersync.com/client-sdks/orms/js/drizzle, https://docs.powersync.com/llms.txt *(Doku)*
9. PowerSync, Self-Hosting: https://docs.powersync.com/self-hosting/getting-started *(Doku)*
10. PowerSync, Self-Hosted Instance Configuration: https://docs.powersync.com/configuration/powersync-service/self-hosted-instances *(Doku)*
11. PowerSync, Source Database Setup (Postgres): https://docs.powersync.com/configuration/source-db/setup *(Doku)*
12. PowerSync, Deployment Architecture: https://docs.powersync.com/maintenance-ops/self-hosting/deployment-architecture *(Doku)*
13. PowerSync, Sync Streams – Writing Queries: https://docs.powersync.com/sync/streams/queries *(Doku)*
14. PowerSync, Handling Update Conflicts: https://docs.powersync.com/handling-writes/handling-update-conflicts *(Doku)*
15. PowerSync, Writing Client Changes: https://docs.powersync.com/handling-writes/writing-client-changes *(Doku)*
16. PowerSync, Pricing: https://www.powersync.com/pricing *(Hersteller)*
17. PowerSync Service, LICENSE (FSL-1.1-ALv2): https://github.com/powersync-ja/powersync-service/blob/main/LICENSE *(GitHub)*
18. PowerSync `self-host-demo`: https://github.com/powersync-ja/self-host-demo *(GitHub)*
19. Better Auth, JWT-Plugin: https://www.better-auth.com/docs/plugins/jwt *(Doku)*
20. ElectricSQL, Writes Guide: https://electric.ax/docs/guides/writes *(Doku)*
21. ElectricSQL, Expo-Integration: https://electric.ax/docs/sync/integrations/expo *(Doku)*
22. ElectricSQL, Auth Guide: https://electric.ax/docs/sync/guides/auth *(Doku)*
23. ElectricSQL, Shapes Guide: https://electric.ax/docs/sync/guides/shapes *(Doku)*
24. ElectricSQL, Deployment Guide: https://electric.ax/docs/sync/guides/deployment *(Doku)*
25. TanStack DB, Offline Transactions: https://tanstack.com/db/latest/docs/guides/offline-transactions *(Doku)*
26. WatermelonDB, Sync – Backend: https://watermelondb.dev/docs/Sync/Backend *(Doku)*
27. WatermelonDB, Installation: https://watermelondb.dev/docs/Installation *(Doku)*
28. Zero, React Native: https://zero.rocicorp.dev/docs/react-native *(Doku)*
29. Zero, Connection Status / Offline: https://zero.rocicorp.dev/docs/offline *(Doku)*
30. Replicache, Startseite (Status): https://replicache.dev/ *(Hersteller)*
31. TinyBase, Synchronization und Using A Synchronizer: https://tinybase.org/guides/synchronization/, https://tinybase.org/guides/synchronization/using-a-synchronizer/ *(Doku)*
32. TinyBase, Database Persistence: https://tinybase.org/guides/persistence/database-persistence/ *(Doku)*
33. Legend-State v3, Persist and Sync: https://legendapp.com/open-source/state/v3/sync/persist-sync/ *(Doku)*
34. PostgreSQL 18, UUID Functions: https://www.postgresql.org/docs/18/functions-uuid.html *(Doku)*
35. npm-Registry und npm-Downloads-API (abgerufen 11.10.2026), z. B. https://registry.npmjs.org/@powersync/react-native, https://registry.npmjs.org/@powersync/drizzle-driver, https://registry.npmjs.org/@powersync/adapter-sql-js, https://registry.npmjs.org/@electric-sql/client, https://registry.npmjs.org/@tanstack/db, https://registry.npmjs.org/@tanstack/offline-transactions, https://registry.npmjs.org/@tanstack/expo-db-sqlite-persistence, https://registry.npmjs.org/@nozbe/watermelondb, https://registry.npmjs.org/@morrowdigital/watermelondb-expo-plugin, https://registry.npmjs.org/@rocicorp/zero, https://registry.npmjs.org/replicache, https://registry.npmjs.org/tinybase, https://registry.npmjs.org/@legendapp/state, https://registry.npmjs.org/drizzle-orm, https://api.npmjs.org/downloads/point/last-week/@powersync/react-native *(npm)*
36. GitHub-REST-API (abgerufen 11.10.2026), z. B. https://api.github.com/repos/powersync-ja/powersync-service, https://api.github.com/repos/powersync-ja/powersync-service/releases, https://api.github.com/repos/electric-sql/electric/releases, https://api.github.com/repos/Nozbe/WatermelonDB/commits, https://api.github.com/repos/rocicorp/mono *(GitHub)*
