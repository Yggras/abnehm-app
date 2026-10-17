# Entwicklung

Wie die Codebasis aufgebaut ist und wie App, Backend und Datenbank lokal laufen. Grundlage sind das Projektgerüst ([#93](https://github.com/Yggras/abnehm-app/issues/93)) und Abschnitt 1–2 der [Spezifikation 0](https://github.com/Yggras/abnehm-app/issues/71). Bis zum [Produktiv-Gate](https://github.com/Yggras/abnehm-app/issues/115) gelten ausschließlich synthetische Daten.

## Voraussetzungen

- Node ≥ 26.5 mit npm 11 (Expo SDK 58 verlangt mindestens Node 22.13, [Expo-Versionen](https://docs.expo.dev/versions/latest/))
- Docker Desktop mit Docker Compose
- Xcode 27 mit iOS-Simulator; Android Studio mit Emulator und JDK 21

## Aufbau

Ein npm-Workspace mit zwei Anwendungen und zwei gemeinsamen Paketen:

| Ordner | Paket | Inhalt |
| --- | --- | --- |
| `apps/mobile` | `@abnehm/mobile` | Expo-App (SDK 58, Expo Router, TypeScript strict), Tests mit Jest 29, `jest-expo` 58 und React Native Testing Library 14 |
| `apps/backend` | `@abnehm/backend` | Hono und Drizzle auf Node, Postgres; Integrationstests mit Vitest gegen ein flüchtiges Postgres und die echte Hono-App |
| `packages/contracts` | `@abnehm/contracts` | Vertragsmodul: Zod-Schemas und Typen, die App und Backend teilen |
| `packages/clock` | `@abnehm/clock` | Uhr/Zeitzone: aktueller Zeitpunkt, IANA-Zeitzone, lokaler Tag |

Node führt die TypeScript-Quellen von Backend und Paketen direkt aus ([Type Stripping](https://nodejs.org/api/typescript.html)). Deshalb tragen relative Importe dort die Endung `.ts`, und es gibt keinen Build-Schritt.

### Grenzen, die Lint und Typprüfung erzwingen

- **Vertragsmodul:** nur Zod und eigene Dateien. Verboten sind React-, Drizzle-, Netzwerk- und Plattform-APIs, auch als Typimport oder dynamischer Import. Die tsconfig des Pakets kennt keine DOM- und Node-Typen. `fetch` oder `process` sind dort also schon Typfehler.
- **Uhr:** nur das Vertragsmodul sowie `Date` und `Intl` aus dem Sprachstandard.
- **App → Backend:** nur `import type` aus `@abnehm/backend/rpc`. Laufzeitcode des Backends gelangt nie ins App-Bundle.
- **Testuhr:** `@abnehm/clock/testing` und `@abnehm/clock/conformance` sind nur in Testdateien erlaubt.

### Uhr und lokaler Tag

Bereichscode liest „jetzt“ und „heute“ ausschließlich über die Schnittstelle `Clock` aus `@abnehm/clock`:

- `clock.read()` liefert `{ instant, timeZone, localDate }` aus einer einzigen Ablesung. Zeitpunkt und Tag passen dadurch auch um Mitternacht zusammen.
- In der App liefert `useClock()` die Geräteuhr: Systemzeit plus Gerätezone aus `expo-localization`.
- Im Backend liest `clock.read(personTimeZone)` in der `time_zone` der Person.
- `localDateAt(instant, timeZone)` ordnet einen gespeicherten Zeitpunkt seinem lokalen Tag zu.
- Tests nutzen `createTestClock()`. Das Konformitäts-Testkit (`clockConformanceCases`) läuft gegen Systemuhr, Geräteuhr und Testuhr. Es prüft Tageswechsel, Sommerzeit (23- und 25-Stunden-Tage, Südhalbkugel, ausfallende Mitternacht), Halbstundenzonen, Reisen und ungültige Zonen.

### Typisierte Endpunkte (Hono RPC)

Die App ruft das Backend über `hc<AppType>` auf ([Hono RPC](https://hono.dev/docs/guides/rpc)). Fachliche Pfade sind versioniert (`/v1/…`).

`apps/mobile/src/backend/status.ts` prüft beim Typecheck, dass die abgeleitete Antwort genau dem Vertrag aus `@abnehm/contracts/status` entspricht. Benennt das Backend ein Feld um, scheitert die Typprüfung der App.

## Befehle

Alle Befehle laufen im Repo-Root:

| Befehl | Wirkung |
| --- | --- |
| `npm install` | Abhängigkeiten aller Workspaces |
| `npm run backend` | Legt fehlende lokale Secrets an, baut und startet Backend und Postgres. Der Watch-Modus spielt Änderungen an `apps/backend/src` und `packages/*/src` ein. |
| `npm run backend:down` | Stoppt beide Container; die Datenbank bleibt im Volume erhalten |
| `npm run ios --workspace @abnehm/mobile` | Development Build im iOS-Simulator |
| `npm run android --workspace @abnehm/mobile` | Development Build im Android-Emulator |
| `npm run typecheck` | Typprüfung aller Workspaces |
| `npm run lint` | ESLint über das ganze Repo, einschließlich der Importgrenzen |
| `npm run test:app` | App-Tests (Jest) |
| `npm run test:node` | Backend- und Pakettests (Vitest). Startet dafür ein eigenes Postgres in Docker. |

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

1. **Gezielt im WLAN veröffentlichen.** Das Backend lauscht dann zusätzlich auf der LAN-Adresse des Rechners, Postgres bleibt unerreichbar:

   ```sh
   BACKEND_PUBLISH_ADDRESS=192.168.178.20 npm run backend
   EXPO_PUBLIC_API_URL=http://192.168.178.20:8787 npm start --workspace @abnehm/mobile
   ```

   Nach dem Test das Backend wieder ohne `BACKEND_PUBLISH_ADDRESS` starten.

2. **Entwicklungstunnel mit HTTPS**, z. B. `ngrok http 8787` ([ngrok](https://ngrok.com/docs/getting-started/)) oder `cloudflared tunnel --url http://localhost:8787` ([Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)). Die ausgegebene `https://`-Adresse kommt in `EXPO_PUBLIC_API_URL`. Über HTTPS braucht die App keine Netzwerkausnahme. Der Tunnel macht den Status-Endpunkt öffentlich erreichbar, solange er läuft.

### Netzwerkausnahmen nur im Development Build

Unverschlüsseltes HTTP zum Entwicklungsrechner ist nur im Development Build erlaubt:

- **iOS:** `app.config.ts` ersetzt das ATS-Wörterbuch der Expo-Vorlage.
  - Nur mit `APP_VARIANT=development` enthält es `NSAllowsLocalNetworking`. Der Schlüssel erlaubt Verbindungen zu „unqualified domains, .local domains, and IP addresses“ ([Apple: NSAllowsLocalNetworking](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking)).
  - Ohne die Variable entsteht der Produktionsbuild ohne Ausnahme.
  - Die npm-Skripte `start`, `ios` und `android` setzen die Variable selbst.
- **Android:** Klartext erlauben nur die Debug-Manifeste der Expo-Vorlage (`usesCleartextTraffic`). Release-Builds verbieten ihn, denn „Starting with Android 9 (API level 28), cleartext support is disabled by default“ ([Android: Network security configuration](https://developer.android.com/privacy-and-security/security-config)).
- **Variante wechseln:** Wer lokal zwischen den Varianten wechselt, erzeugt die nativen Ordner neu, etwa mit `APP_VARIANT=production npx expo prebuild --clean`. `expo run` übernimmt bestehende Ordner sonst unverändert.

Development- und Produktionsbuild haben verschiedene Bundle-IDs (`de.yggras.abnehmapp.dev` und `de.yggras.abnehmapp`) und lassen sich nebeneinander installieren.
