# Produktivbetrieb (Laptop)

Wie das Backend mit echten Gesundheitsdaten auf diesem Laptop läuft, wie jeder Produktiv-Build freigegeben wird und wie die Infrastruktur nachgewiesen ist. Grundlage sind das [Produktiv-Gate](https://github.com/Yggras/abnehm-app/issues/115), Abschnitt 11 der [Spezifikation 0](https://github.com/Yggras/abnehm-app/issues/71) und die Sicherheitsentscheidung [#22](https://github.com/Yggras/abnehm-app/issues/22). Das Backend läuft vorerst auf dem Laptop statt auf einem Server ([#21](https://github.com/Yggras/abnehm-app/issues/21)).

**Echte Gesundheitsdaten erst, wenn #115 geschlossen ist.** Zieht das Backend auf einen Server um, braucht es dort ein neues, gleichwertiges Gate.

Lokale Entwicklung, E2E-Läufe und Gerätetests stehen in [`entwicklung.md`](entwicklung.md).

Die Skripte teilen Pfade und Helfer über `scripts/prod-umgebung`. `scripts/test-prod` ist ein hermetischer Smoke-Test für `scripts/prod` und `scripts/prod-secrets` (Docker, Tailscale und curl gemockt); er läuft nach Änderungen an diesen Skripten von Hand.

## Überblick

```
iPhone / Android-Handy (Tailscale verbunden)
   │  HTTPS, Zertifikat von Let's Encrypt für <maschine>.<tailnet>.ts.net
   ▼
Tailscale auf dem Laptop: `tailscale serve` beendet TLS
   │  http://127.0.0.1:8790 (nur Loopback)
   ▼
Docker-Stack `abnehm-prod` (compose.prod.yaml)
   backend (Image-Stage production) ──Netz `intern`──▶ postgres (ohne Port)
   Volumes: abnehm-prod_postgres-data, abnehm-prod_photo-data
```

| Kriterium aus #115 | Umsetzung | Nachweis |
| --- | --- | --- |
| TLS | `tailscale serve` beendet HTTPS auf dem Laptop. Der Produktionsbuild der App kennt nur `https://` und hat keine Ausnahme für Klartext. | `scripts/app-artefakt-pruefen` in jedem Produktions-Build (Gegenprobe: das E2E-Binary fällt durch); Test in `apps/mobile/src/app-config.test.ts` |
| Keine offenen Ports | Postgres ohne `ports`. Das Backend nur auf `127.0.0.1:8790`, von außen nur über Tailscale. | `test/produktivbetrieb.test.ts`, `scripts/gate-nachweis --sudo`, Portscan |
| Datenträgerverschlüsselung | FileVault. Docker-Disk-Image und Secrets liegen auf dem Data-Volume. | `scripts/gate-nachweis` |
| Secrets | Compose-Secrets aus Dateien außerhalb des Repos, `0700`/`0600`. Wiederherstellung aus dem Passwortmanager. | `scripts/prod-secrets pruefen`, `test/produktivbetrieb.test.ts` |
| Sicherheitsupdates | automatische macOS-Updates; Container-Images per Release-Checkliste | `scripts/gate-nachweis`, Bildschirmfoto, Abschnitt „Updates“ |
| SSH | „Entfernte Anmeldung“ aus | `scripts/gate-nachweis --sudo` |
| Release-Checkliste | `scripts/release-check`; `scripts/prod` verteilt nur freigegebene Stände | Protokoll unter `~/Library/Logs/abnehm-app/release/` |
| Backup und Restore | **nicht Teil des Gates** (Nutzerentscheidung vom 04.11.2026 in [#115](https://github.com/Yggras/abnehm-app/issues/115), siehe „Backup“) | – |

## Einrichtung (einmalig)

### HTTPS über Tailscale Serve

`tailscale serve` leitet Anfragen aus dem Tailnet an einen lokalen Dienst weiter. Dabei gilt: „By default, the device's Tailscale daemon terminates the HTTPS connection“ ([Tailscale Serve](https://tailscale.com/kb/1242/tailscale-serve)). Das Zertifikat holt Tailscale „using Let's Encrypt“ für `<maschine>.<tailnet>.ts.net` ([Enabling HTTPS](https://tailscale.com/kb/1153/enabling-https)). Die App vertraut ihm deshalb über den Zertifikatsspeicher des Systems und braucht keine Ausnahme. Wer öffentlich teilen will, nutzt Funnel, das „publicly, open to the entire internet“ freigibt ([Tailscale Serve](https://tailscale.com/kb/1242/tailscale-serve)). Funnel wird hier **nicht** verwendet.

1. Tailscale auf dem Laptop installieren und anmelden. Die CLI liegt bei der App-Store-Variante unter `/Applications/Tailscale.app/Contents/MacOS/Tailscale`. Die Standalone-Variante installiert sie in den Einstellungen nach `/usr/local/bin/tailscale` ([Tailscale CLI](https://tailscale.com/kb/1080/cli)). `scripts/prod` findet beide.
2. **Maschinennamen neutral wählen**, etwa `heimserver`. Er wird mit dem Zertifikat öffentlich: „the machine names are still published in the public ledger“ ([Enabling HTTPS](https://tailscale.com/kb/1153/enabling-https)).
3. In der [Admin-Konsole › DNS](https://console.tailscale.com/admin/dns) MagicDNS einschalten, dann unter „HTTPS Certificates“ „Enable HTTPS“ wählen ([Enabling HTTPS](https://tailscale.com/kb/1153/enabling-https)).
4. Die Weiterleitung einrichten. Mit `--bg` übersteht sie Neustarts: „it runs persistently in the background until you disable it“ ([Tailscale Serve](https://tailscale.com/kb/1242/tailscale-serve)).

   ```sh
   tailscale serve --bg --https=443 http://127.0.0.1:8790
   tailscale serve status        # zeigt https://<maschine>.<tailnet>.ts.net
   scripts/prod adresse https://<maschine>.<tailnet>.ts.net
   ```

5. Auf beiden Handys die Tailscale-App installieren und im selben Tailnet anmelden. Der kostenlose Personal-Plan erlaubt „Up to 6 users“ ([Tailscale Pricing](https://tailscale.com/pricing)). Für den Sync muss Tailscale auf dem Handy verbunden sein.

`scripts/prod adresse` speichert die Adresse in `~/Library/Application Support/abnehm-app/produktion/produktion.env`. Sie ist kein Geheimnis. Der Produktionsbuild der App und `AUTH_BASE_URL` des Backends nutzen sie.

### Secrets

```sh
scripts/prod-secrets                           # legt Datenbankpasswort, Better-Auth- und Einladungs-Secret an
scripts/prod-secrets setzen anthropic_api_key  # API-Schlüssel der Fotoanalyse, Eingabe unsichtbar
scripts/prod-secrets pruefen
```

- Die Dateien liegen in `~/Library/Application Support/abnehm-app/produktion/secrets/`: Verzeichnis `0700`, Dateien `0600`. Damit stehen sie außerhalb jedes Checkouts, also nicht in Git, im Build-Kontext oder im Image. Docker Compose bindet sie zur Laufzeit unter `/run/secrets/` ein ([Docker Compose Secrets](https://docs.docker.com/compose/how-tos/use-secrets/)). Jeder Dienst erhält nur seine Secrets, Postgres nur das Datenbankpasswort (`test/produktivbetrieb.test.ts`).
- Das Backend liest Geheimnisse nur aus `*_FILE`-Dateien und nennt in Fehlern nur Variablennamen (`apps/backend/src/config.ts`). Die App enthält keine Secrets.
- **Wiederherstellungsquelle ist Philipps Passwortmanager** (#22). Nach dem Anlegen jeden Wert übernehmen, etwa mit `pbcopy < "<datei>"`, danach `pbcopy < /dev/null`. Wiederherstellen auf einem neuen Rechner: `scripts/prod-secrets setzen <name>` je Secret.
- Ein neues `postgres_password` wirkt nicht auf eine bestehende Datenbank. Die Variablen des Postgres-Images „will only have an effect if you start the container with a data directory that is empty“ ([Postgres-Image](https://github.com/docker-library/docs/blob/master/postgres/content.md)). Das Passwort ändert man mit `ALTER ROLE` in der Datenbank und danach in der Datei.

### Starten und App installieren

Der Produktivbetrieb läuft aus dem primären Checkout, sauber und auf dem freigegebenen `main`:

```sh
scripts/release-check --android-geraet <adb-serial> --iphone <devicectl-id> --lan-ip <LAN-IP>
scripts/prod start                         # startet genau die freigegebenen Images
scripts/prod app ios <devicectl-id>        # installiert das freigegebene Binary per Kabel
scripts/prod app android <adb-serial>
scripts/prod status
```

- Die Geräte-IDs liefern `xcrun devicectl list devices` und `adb devices`.
- Die App kommt vorerst per Kabel auf die Geräte ([Nutzerentscheidung vom 04.11.2026 in #115](https://github.com/Yggras/abnehm-app/issues/115#issuecomment-6642572329)). TestFlight und Play Internal Testing ([#8](https://github.com/Yggras/abnehm-app/issues/8)) folgen später. Die iOS-App ist mit dem Zertifikat „Apple Development“ signiert. Mit einem kostenlosen Apple-Konto läuft sie nach 7 Tagen ab ([Recherche zur Verteilung](https://github.com/Yggras/abnehm-app/blob/main/research/private-distribution.md)). Die Android-APK signiert der Release-Build der Expo-Vorlage mit dem Debug-Schlüssel (`signingConfig signingConfigs.debug`, [Vorlage SDK 58](https://unpkg.com/expo-template-bare-minimum@58.0.23/android/app/build.gradle)); für die Installation per `adb` genügt das.
- Die Container haben `restart: unless-stopped`: Sie starten wieder, wenn der Docker-Daemon neu startet, außer man hat sie angehalten ([Docker](https://docs.docker.com/engine/containers/start-containers-automatically/)). Damit sie nach einem Neustart des Laptops laufen, muss in Docker Desktop „Start Docker Desktop when you sign in to your computer“ an sein ([Docker Desktop Settings](https://docs.docker.com/desktop/settings-and-maintenance/settings/)).

### Quelladresse und Anmeldebegrenzung

Die Anmeldung ist pro IP begrenzt; die IP kommt aus `X-Forwarded-For` eines vertrauenswürdigen Proxys (`AUTH_TRUSTED_PROXIES`, [`entwicklung.md`](entwicklung.md) › „Konto, Sitzung und Sicherheitslog“).

- `tailscale serve` **setzt** `X-Forwarded-For` auf die Tailnet-Adresse des anfragenden Geräts und überschreibt damit einen mitgeschickten Wert: `r.Out.Header.Set("X-Forwarded-For", c.SrcAddr.Addr().String())` ([Quelltext v1.104.5](https://github.com/tailscale/tailscale/blob/v1.104.5/ipn/ipnlocal/serve.go#L1144-L1152)).
- Über die Portweiterleitung von Docker Desktop kommt die Anfrage im Container vom Gateway des Netzes. `compose.prod.yaml` legt das Netz `intern` deshalb auf `172.30.115.0/24` fest und vertraut nur `172.30.115.1`. Beobachtet am 04.11.2026: Ein Container in diesem Netz sah eine Anfrage an `127.0.0.1` des Laptops von `172.30.115.1`.
- Nur Prozesse auf dem Laptop selbst können `127.0.0.1:8790` direkt ansprechen und `X-Forwarded-For` frei setzen.

## Release-Checkliste

**Jeder Produktiv-Build durchläuft sie vor der Verteilung, auch die Builds der Spezifikationen 1–5. Ein Build ohne grünen Lauf wird nicht verteilt.** `scripts/prod start` und `scripts/prod app` setzen das durch: Sie verteilen nur Commits mit Freigabe und nur die Images bzw. Binaries mit den freigegebenen IDs.

```sh
scripts/release-check --android-geraet <adb-serial> --iphone <devicectl-id> --lan-ip <LAN-IP>
```

Voraussetzungen: Docker Desktop läuft, das Samsung Galaxy A34 und das iPhone SE hängen entsperrt am Kabel, Java 17+ für Maestro, und `scripts/prod adresse` ist gesetzt. Der Lauf baut alle Binaries neu und dauert entsprechend lange.

| Schritt | Was | Belegt |
| --- | --- | --- |
| `stand` | sauberer Checkout, `HEAD` = `origin/main` | genau der freizugebende Commit |
| `statisch` | `npm run typecheck`, `npm run lint` | Typen, Uhr- und Importgrenzen |
| `autorisierung` | `apps/backend/test/authorization-*` und `sync-authorization` | Matrix aus Abschnitt 11 der Spezifikation 0 |
| `release-sperren` | Vitest-Projekt `release` und `apps/backend/test/release-sperren.test.ts` | Seed, Testuhr und Fehlermodi fehlen im Export, in der COPY-Liste und im laufenden Produktions-Backend |
| `tests` | Jest der App und übrige Vitest-Suite | alles Übrige |
| `backend-image` | holt die Basis-Images neu, baut die Stage `production` und prüft das Image mit `test/release-sperren-artefakt.ts` | Image-IDs von Backend und Postgres; keine Testfähigkeit in genau diesem Image |
| `maestro` | `scripts/e2e-run --build`: `sync-offline`, `geraetesmoke`, `geraetetest` auf iOS-Simulator und Android-Emulator | E2E-Artefakt-IDs dieses Commits |
| `android-geraet` | On-Device-Suite und Gerätesmoke auf dem Galaxy A34 per Maestro | E2E-Artefakt-ID `android-geraet` |
| `iphone-geraet` | On-Device-Suite vor und nach Neustart sowie Gerätesmoke auf dem iPhone SE; Maestro steuert echte iPhones nicht ([#101](https://github.com/Yggras/abnehm-app/issues/101)). Das Skript baut, installiert und öffnet die Links; ein Mensch bestätigt die Ergebnisse. | E2E-Artefakt-ID `ios-geraet` |
| `produktion-binaries` | `scripts/app-build produktion ios\|android` mit der https-Adresse, danach `scripts/app-artefakt-pruefen` | Artefakt-IDs der Produktions-Binaries; TLS ohne Ausnahme und keine Testfähigkeit in genau diesen Bundles |
| `sichtpruefung` | Ein Mensch sieht die Bildschirmfotos `smoke-*.png` an (sichere Bereiche) | Sichtprüfung |

- Testfähigkeiten fehlen im Produktionsbinary. Maestro, On-Device-Suite und Gerätesmoke prüfen deshalb die **E2E-Binaries desselben Commits** (Nutzerentscheidung vom 24.10.2026 in [#114](https://github.com/Yggras/abnehm-app/issues/114)). Das Protokoll hält beide Artefaktarten fest.
- Protokoll, Logs, E2E-Läufe und Bildschirmfotos liegen unter `~/Library/Logs/abnehm-app/release/<Zeitpunkt>/`. Nur ein vollständiger grüner Lauf auf `origin/main` legt `freigaben/<commit>.md` an, dazu die freigegebenen Image- und Artefakt-IDs.
- Ohne Terminal (etwa in einer Agenten-Session) bleiben die Bestätigungen offen; der Lauf ist dann nicht grün.
- Die Release-Sperren gelten damit doppelt: als Tests am Export (`release-sperren`) und an den freigegebenen Artefakten selbst (`backend-image`, `produktion-binaries`). Die Gegenprobe am E2E-Bundle und am Development-Image findet die Marker (geprüft am 04.11.2026).
- Vor der Freigabe prüft der Schritt `commit-bindung`, dass der Checkout noch derselbe saubere Commit ist und jedes geprüfte Artefakt (Produktions- und E2E-Binaries) aus genau diesem Commit stammt.
- `--nur <schritt>,…` wiederholt einzelne Schritte zur Fehlersuche und gibt nie frei. `ABNEHM_RELEASE_BELIEBIGER_STAND=1` erlaubt Probeläufe auf anderen Ständen, ebenfalls ohne Freigabe.
- `ABNEHM_PROD_BELIEBIGER_STAND=1 scripts/prod start` startet einen Probe-Stack `abnehm-prod-probe` mit eigenen Volumes auf `127.0.0.1:8791`. `tailscale serve` leitet nicht dorthin, echte Geräte erreichen ihn also nicht. `scripts/prod app` verlangt auch dann eine Freigabe.

## Updates

- **macOS:** Unter Systemeinstellungen › Allgemein › Softwareupdate › Automatische Updates sind alle Schalter an, auch „Sicherheitsmaßnahmen und Systemdateien installieren“. Nachweis: `scripts/gate-nachweis` und ein Bildschirmfoto. Für die Konfigurationsprofil-Schlüssel dieser Einstellungen nennt Apple „Removed: macOS 27+“ ([Apple](https://developer.apple.com/documentation/devicemanagement/softwareupdate)). Die ausgelesenen Werte sind deshalb nur ein Hinweis, maßgeblich ist das Bildschirmfoto. Neustarts für Updates bestätigt man zeitnah. Nach dem Neustart startet Docker Desktop bei der Anmeldung, und die Container laufen wieder (siehe oben).
- **Container-Images:** Die Tags sind festgelegt (`postgres:18.6-alpine` in `compose.prod.yaml`, `node:26.12.0-alpine` im `Dockerfile`). Ein Update ist ein neuer Lauf der Release-Checkliste. Der Schritt `backend-image` holt den aktuellen Stand dieser Tags und baut das Backend neu. Danach erzeugt `scripts/prod start` die Container mit den neuen Images neu; das ist der Neustart. Rhythmus: mindestens monatlich und zusätzlich bei Sicherheitsmeldungen zu Node, Postgres oder Alpine. Das ist ein Designwert dieser Umsetzung, nicht belegt und nicht aus einer Quelle abgeleitet.
- **Neue Versionen** (anderer Tag) kommen per Pull Request: Tag in `compose.yaml`, `compose.prod.yaml` bzw. `Dockerfile` ändern, CI, Merge, Release-Checkliste, `scripts/prod start`. Ein Wechsel der Postgres-Hauptversion braucht `pg_upgrade` oder Dump und Restore ([PostgreSQL: Upgrading](https://www.postgresql.org/docs/current/upgrading.html)). Er ist ein eigenes Ticket.

## Gate-Nachweise

```sh
scripts/gate-nachweis --sudo    # Bericht unter ~/Library/Logs/abnehm-app/gate/
```

Der Bericht enthält:

- FileVault-Status;
- Datenträger von Docker-Disk-Image und Secret-Verzeichnis;
- Mountpoints der Produktiv-Volumes;
- alle lauschenden Ports (mit `--sudo` auch die von Root-Diensten);
- `tailscale serve status`;
- „Entfernte Anmeldung“;
- Firewall;
- Update-Einstellungen.

Docker Desktop speichert Images, Container und Volumes im Disk-Image der Linux-VM: „the Linux volume where containers and images are stored“ ([Docker Desktop Settings](https://docs.docker.com/desktop/settings-and-maintenance/settings/)). Dieses Disk-Image liegt hier unter `~/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw` auf dem FileVault-verschlüsselten Data-Volume. Darin liegen auch Postgres und die Fotoablage.

### Portscan

Von einem anderen Gerät im selben WLAN (z. B. mit `nmap`):

```sh
nmap -Pn -p- <LAN-IP-des-Laptops>
nmap -Pn -sU --top-ports 200 <LAN-IP-des-Laptops>
```

Weder Postgres (`5432`) noch das Backend (`8787`–`8790`) noch ein HTTPS-Port dürfen erscheinen; HTTPS gibt es nur im Tailnet. Das Ergebnis kommt als Kommentar in #115.

Geduldet sind Dienste von macOS selbst, die nichts mit der App zu tun haben ([Nutzerentscheidung vom 04.11.2026 in #115](https://github.com/Yggras/abnehm-app/issues/115#issuecomment-6642478303)). Am 04.11.2026 lauschten auf allen Adressen: `ControlCenter` auf TCP 5000 und 7000 (laut Apple „AirPlay“, [Apple: TCP- und UDP-Ports](https://support.apple.com/en-us/103229)) und `rapportd` auf TCP 60752 (laut `lsof`). Der Nachweis nennt solche Funde und bewertet sie. Ein neuer, unbekannter Fund wird geklärt, bevor das Gate gilt.

## Backup

Backup und Restore sind **nicht Teil des Gates** (Nutzerentscheidung vom 04.11.2026, in den Akzeptanzkriterien von [#115](https://github.com/Yggras/abnehm-app/issues/115) gestrichen). Damit weicht das Gate von #22 und Abschnitt 11 der Spezifikation 0 ab. Die Kriterien in #115 sind angepasst; #22 und der Text von Abschnitt 11 nennen das Backup noch (Stand 04.11.2026). Folge: Gehen Laptop oder SSD verloren, sind alle Daten und Mahlzeitenfotos verloren. Kommt ein Backup später dazu, gehören das Volume `photo-data` und Postgres aus **demselben** Sicherungslauf hinein ([`entwicklung.md`](entwicklung.md) › „Ernährung: Fotoentwurf bestätigen und Fotoablage“).
