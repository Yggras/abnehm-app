# Recherche: Selbst geschriebenes Backend als Alternative zu Supabase

Ticket: #20 · Stand der Recherche und aller Preisangaben: **2026-10-10**. Quellen-Nummern [n] verweisen auf die Liste am Ende. Aussagen ohne Quelle sind ausdrücklich als *Annahme*, *eigene Einschätzung* oder *eigene Rechnung* markiert. Vergleichsbasis ist die Vorrecherche `research/backend.md` (Ticket #3), deren Supabase-Angaben hier nicht erneut recherchiert, sondern mit „[VR]“ referenziert werden.

## Zusammenfassung

- **Technisch realistisch: ja.** Alle Bausteine gibt es als gepflegte, MIT/Apache-lizenzierte TypeScript-Bibliotheken mit Releases im September/Oktober 2026: Hono, Fastify, NestJS (API), Drizzle/Prisma (DB), Better Auth (Auth inkl. Expo-Plugin und Sign in with Apple), `expo-server-sdk` (Push) [16][17][18][19][20][21][22][23].
- **Kosten:** Ein „klassisches“ Eigen-Backend auf einem EU-VPS kostet Geld: Hetzner CX23 seit 15.06.2026 **5,49 € netto/Monat ohne IPv4** (DE/FI) [1]. Echte 0-€-Varianten gibt es nur mit Haken: **Oracle Always Free** (Kreditkarte bei Anmeldung, Rückforderung „idle“ Instanzen) [5][6][7] oder **Cloudflare Workers Free + D1 + R2** (EU-Jurisdiktion für Daten wählbar, aber kein eingebautes Realtime, 10 ms CPU pro Aufruf) [8][9][10][11]. Fly.io hat keine Free-Stufe [12], Render-Free schläft nach 15 min und löscht Free-Postgres nach 30 Tagen [13], Railway-Free gibt nur 1 $ Guthaben/Monat [14].
- **Expo Push ist kostenlos** („There is no cost associated with sending notifications through Expo push notification service“, Limit 600/s pro Projekt) [24] – damit ist der offene Punkt aus der Vorrecherche geklärt.
- **Mehraufwand ggü. Supabase** (keine Stundenschätzung): Auth-Server inkl. Session-Handling, Rechte-/Freigabelogik im API-Code statt RLS, Backups, OS-/Dependency-Updates, TLS, Monitoring und Dateispeicher liegen vollständig in eigener Verantwortung (Details unten). Supabase liefert Auth, RLS, Storage, Edge Functions und Backups-Infrastruktur im Free-Plan mit [VR].
- **Empfehlung (Vorschlag – Entscheidung liegt bei euch):** Für V1 **bei Supabase Free bleiben**, aber die eigene Logik (KI-Proxy, Push-Versand, Freigaberegeln) so schreiben, dass ein späterer Umzug möglich bleibt. Ein Eigen-Backend lohnt sich vor allem, wenn **Lerneffekt** ausdrücklich Ziel ist; dann wäre *eigene Einschätzung* die sinnvollste 0-€-Variante „Hono + Drizzle + Better Auth auf Cloudflare Workers/D1/R2 (EU)“ bzw. die einfachste Betriebsvariante „Hono/Fastify + Postgres auf Hetzner CX23“ (~6,5 € brutto/Monat, *eigene Rechnung*).

## Was „selbst geschrieben“ hier bedeutet

Drei Bauformen werden verglichen (Einteilung = *eigene Einschätzung*):

- **A) VPS selbst betrieben:** eigener Linux-Server (z. B. Hetzner/Oracle), darauf API-Server (Node.js), Postgres, Reverse Proxy mit TLS, Dateien auf Platte oder S3-kompatiblem Speicher.
- **B) Serverless selbst geschrieben:** eigener API-Code auf einer Plattform ohne Serververwaltung (Cloudflare Workers + D1 + R2, Deno Deploy, Google Cloud Run, Render, Railway, Fly.io).
- **C) Hybrid:** eigener API-Code + verwaltete Datenbank (Neon, Supabase nur als Postgres).

## Vergleichstabelle Hosting (Preise Stand 2026-10-10)

| Anbieter | Kostenlos? | Kleinste sinnvolle Stufe | EU-Standort | Free-Tier-Haken |
|---|---|---|---|---|
| **Hetzner Cloud** (A) | nein | CX23: 2 vCPU, 4 GB RAM, 40 GB NVMe, **5,49 € netto/Monat excl. IPv4** (vorher 3,99 €); CAX11 (Arm) 5,99 € [1][2] | Nürnberg, Falkenstein, Helsinki [1][2] | – (kein Free-Tier). Abrechnung stündlich mit Monatsobergrenze [3]. Server sind auch ohne öffentliche IPv4 anlegbar [4]; IPv4-Preis auf Primärquelle nicht gefunden (*nicht belegt*). Produktseite zeigte beim Abruf „This product is currently unavailable“ [2] (ob Darstellungsartefakt oder echter Engpass: *nicht geprüft*). |
| **Oracle Cloud Always Free** (A) | ja | Ampere A1: 1.500 OCPU-h + 9.000 GB-h/Monat ≙ **2 OCPU + 12 GB RAM**; 200 GB Block Storage; 20 GB Object Storage; 10 TB Egress/Monat [5] | Frankfurt u. a. (Home-Region frei wählbar; *EU-Regionsliste nicht separat geprüft*) | **Kreditkarte zur Verifizierung bei Anmeldung** [6]; Always-Free-Ressourcen nur in der Home-Region [5]; „Idle Always Free compute instances may be reclaimed by Oracle“ (7 Tage: CPU-95.-Perzentil < 20 %, Netzwerk < 20 %, RAM < 20 %) [5]; nach Ablauf der 30-Tage-Promotion bleiben Always-Free-Ressourcen verfügbar [7]. |
| **Cloudflare Workers + D1 + R2** (B) | ja | Workers Free: 100.000 Requests/Tag, 10 ms CPU pro Aufruf; D1: 5 Mio. Rows read/Tag, 100.000 Rows written/Tag, 5 GB; R2: 10 GB-Monat, Egress kostenlos [8][11]; Paid ab 5 $/Monat [8] | D1 und R2 per **Jurisdiktion `eu`** garantiert in der EU [9][10]; Ausführungsort des Worker-Codes selbst nicht auf EU festgelegt (*nicht belegt*, nicht geprüft) | 10 ms CPU/Aufruf (Netzwerk-Warten zählt nicht) [11]; 50 Subrequests/Aufruf, 5 Cron-Trigger [11]; kein klassisches Postgres (D1 = SQLite); kein eingebautes Realtime (Durable Objects mit SQLite im Free-Plan verfügbar [8]). Ob R2 eine hinterlegte Zahlungsmethode verlangt: *nicht geprüft*. |
| **Google Cloud Run** (B) | teilweise | Free: 2 Mio. Requests, 180.000 vCPU-s, 360.000 GiB-s/Monat (request-basiert) [15][41] | Frankfurt (`europe-west3`) in Preisliste; Free-Tier wird „as a spending based discount using Tier 1 pricing“ angewendet [41] | **Billing-Konto Pflicht** [15]; Datenbank nicht enthalten (Cloud SQL nicht geprüft); Cloud-Storage-Free nur in US-Regionen [15]. |
| **Deno Deploy** (B) | ja | Free: 1 Mio. Requests, 10 h aktive CPU, 20 GiB Egress, 1 GiB KV/Monat; Pro 20 $/Monat [25] | aktuelle Region-Doku nicht gefunden (*nicht belegt*; nur „Classic“-Doku mit Frankfurt, nicht verifiziert) | Kreditkartenpflicht auf Preisseite nicht genannt [25]; kein Postgres enthalten. |
| **Render** (B) | ja, eingeschränkt | Free-Webservice; 750 Free-Instanzstunden/Monat [13] | Frankfurt (einzige EU-Region) [26] | Free-Dienst **schläft nach 15 min ohne Traffic**; **Free-Postgres läuft 30 Tage nach Erstellung ab** [13]. Bezahlpreise: Preisseite wurde ohne Inhalt geladen (*nicht belegt*). |
| **Railway** (B) | minimal | Free: 1 $ Guthaben/Monat; Hobby 5 $/Monat inkl. 5 $ Nutzung; RAM 10 $/GB/Monat, CPU 20 $/vCPU/Monat, Volume 0,15 $/GB [14] | EU West Metal (Amsterdam) [27] | Free-Guthaben reicht laut Ressourcenpreisen nur für einen Bruchteil eines dauerhaft laufenden Dienstes (*eigene Rechnung*: 1 $ ≙ 0,1 GB RAM-Monat). |
| **Fly.io** (B) | **nein** | shared-cpu-1x 256 MB: 2,19 $/Monat; 512 MB: 3,69 $; Volume 0,15 $/GB; Managed Postgres ab 38 $/Monat [12] | Frankfurt, Amsterdam, Paris, Stockholm, London [28] | „New organizations don't have a free tier“; Trial max. 2 h Maschinenlaufzeit oder 7 Tage; Kreditkarte Pflicht [12]. |
| **Neon** (C, nur DB) | ja | Free: Postgres, 100 CU-h/Projekt, Speicherlimit laut Preisseite „1 GB/project, 20 GB account total“ [29] | Frankfurt (`aws-eu-central-1`) [30] | Scale-to-zero nach 5 min (im Free nicht abschaltbar) → Kaltstart-Latenz (*Annahme* zur Auswirkung); keine Kreditkarte [29]. |
| **Supabase Free** (Referenz) | ja | 500 MB DB, 1 GB Storage, 500.000 Edge-Function-Aufrufe [VR] | Frankfurt [VR] | Pausierung nach 1 Woche geringer DB-Aktivität [VR] |

Hinweis: Dollar-Preise wurden nicht in Euro umgerechnet (Wechselkurs nicht geprüft). Hetzner-Preise sind netto; Hetzner verweist für Preise inkl. 19 % USt. auf die deutsche Preisliste [1]. *Eigene Rechnung:* 5,49 € × 1,19 ≈ 6,53 € brutto/Monat, zzgl. IPv4 und optionaler Backups (beide Preise *nicht belegt*).

## Vergleichstabelle Bausteine (TypeScript)

| Baustein | Rolle | Status/Pflege (Stand 2026-10-10) | Bemerkung |
|---|---|---|---|
| **Hono** | HTTP-Framework | v4.13.13 (npm, 10.10.2026), MIT, ~32 k Sterne, Repo aktiv [16][31] | Läuft laut Doku auf Cloudflare Workers, Deno, Bun, Vercel, Netlify, AWS Lambda und Node.js („Thanks to the use of the Web Standards …“) [16] → gleicher Code auf VPS und Serverless (geringer Plattform-Lock-in). |
| **Fastify** | HTTP-Framework (Node.js) | v5.12.5 (16.09.2026), MIT, OpenJS Foundation [17][31] | „A fast and low overhead web framework for Node.js“ [17]; nur Node.js. |
| **NestJS** | Vollframework (Module, DI) | v12.1.x (28.09.2026), MIT [18][31] | Basiert auf Express (Standard) oder Fastify; Angular-ähnliche Architektur mit Modulen und Dependency Injection [18]. Für 2 Nutzer viel Struktur (*eigene Einschätzung*). |
| **Drizzle ORM** | DB-Zugriff + Migrationen | v0.45.4 stabil (08.10.2026), 1.0 als RC, Apache-2.0 [19][31] | PostgreSQL, MySQL, SQLite u. a.; „serverless-ready by design“, 0 Abhängigkeiten; Migrationen mit drizzle-kit [19]. |
| **Prisma ORM** | DB-Zugriff + Migrationen | npm-Tag `latest` = 8.0.0-rc.22, vorherige Stable 7.10.0; Apache-2.0 [20][31] | In Prisma 8 ist nur PostgreSQL RC, SQLite experimentell, MySQL geplant; Prisma 7 erhält 18 Monate nach Prisma-8-GA noch Fixes [20]. Laufender Major-Umbruch = Risiko (*eigene Einschätzung*). |
| **Better Auth** | Auth (Sessions, E-Mail/Passwort, Social, 2FA, Rate-Limiting) | v1.7.7 (30.09.2026), MIT, ~30 k Sterne [21][31] | Adapter für Drizzle, Prisma, Kysely; DBs u. a. PostgreSQL, SQLite, Cloudflare D1 [32]; CLI zum Generieren/Migrieren des Schemas [32]; Expo-Plugin `@better-auth/expo` mit `expo-secure-store` [22]; bietet `llms.txt` und MCP-Server für KI-Assistenten [21]. |
| **Lucia** | (früher Auth) | **„Lucia was deprecated on March 2025“** [33] | Nicht mehr verwenden; Repo verweist auf eine Ein-Datei-Vorlage und das „Auth Book“ [33]. |
| **expo-server-sdk** | Push via Expo | v7.2.0, MIT [23][31] | Offizielles Node-SDK für den Expo Push Service. |

## Was man selbst bauen und betreiben muss

| Aufgabe | Bei Supabase | Beim Eigen-Backend | Belege / Hinweise |
|---|---|---|---|
| **Auth** | Supabase Auth enthalten [VR] | Better Auth einbinden (Server + Expo-Client), Session-Speicher in eigener DB [21][22][32] | Sign in with Apple: Apple verlangt eine gleichwertige datensparsame Login-Option, **wenn** ein Drittanbieter-/Social-Login (z. B. Google) das primäre Konto anlegt; ausgenommen sind Apps, die „exclusively“ eigenes Konto-Setup nutzen [34]. → Nur E-Mail/Passwort = kein SiwA-Zwang. Better Auth + Apple: aktiver Apple-Developer-Account nötig; Client-Secret-JWT darf max. 6 Monate gültig sein (regelmäßig erneuern) [35]. Ob dieselbe 6-Monats-Erneuerung bei Supabase Auth anfällt: *nicht geprüft*. |
| **Rechte/Freigaben** | RLS-Policies in Postgres [VR] | Prüflogik im API-Code (jede Route muss Owner/Freigabe prüfen) oder ebenfalls Postgres-RLS mit eigener Rolle | *Eigene Einschätzung:* Fehlende Prüfung in einer Route = Datenleck; bei RLS greift der Schutz zentral. Mit Postgres auf eigenem Server kann RLS weiter genutzt werden (Postgres-Feature, siehe [VR]). |
| **Push (APNs + FCM)** | nicht nativ; Edge Function → FCM/Expo [VR] | Gleich: Server ruft Expo Push, FCM oder APNs direkt auf | **Expo Push:** kostenlos, 600 Benachrichtigungen/s, Inhalte nur bis zur Zustellung gespeichert, Receipts 24 h abrufbar, bei `DeviceNotRegistered` Token nicht mehr verwenden, Access-Token empfohlen [24][36]. **Direkt FCM HTTP v1:** OAuth-2.0-Token aus Service-Account, Scope `firebase.messaging`, liefert an Android und iOS [37]. **Direkt APNs:** `.p8`-Schlüssel, JWT mit ES256, Token mind. stündlich erneuern, HTTP/2 [38]. Expo erlaubt auch native Tokens für direkten FCM/APNs-Versand [24]. Push auf iOS setzt Zugang zu „Certificates, Identifiers & Profiles“ voraus, das laut Apple-Vergleichstabelle nur im kostenpflichtigen Developer Program enthalten ist [39] (gilt unabhängig vom Backend). |
| **KI-Vision-Proxy** | Edge Function + Secret [VR] | Eine API-Route mit Key aus Umgebungsvariable | Auf Workers Free zählt das Warten auf `fetch()` nicht zur 10-ms-CPU-Grenze [11]; Bild-Upload bis 100 MB Request-Body (Free) [11]. |
| **Dateispeicher (Fotos)** | 1 GB Free [VR] | VPS-Platte (Hetzner CX23: 40 GB [2]), Oracle 20 GB Object Storage [5], Cloudflare R2 10 GB-Monat free + EU-Jurisdiktion [10][40] oder Hetzner Object Storage (FSN1/HEL1/NBG1; Basispreis inkl. 1 TB, Betrag auf Seite nicht lesbar → *nicht belegt*) [42] | Bei ~0,7 GB/Jahr [VR] reichen alle Eigen-Optionen mehrere Jahre (*eigene Rechnung*). Zugriffsschutz (signierte URLs o. Ä.) muss selbst gebaut werden (*eigene Einschätzung*). |
| **Backups** | Plattform-Infrastruktur (Umfang im Free-Plan: siehe Supabase-Doku, hier *nicht erneut geprüft*) | Selbst einrichten: Postgres kennt SQL-Dump, Dateisystem-Backup und Continuous Archiving [43]; Hetzner-Server-Backups: 7 Slots, täglich, ältestes wird überschrieben [44] (Preis *nicht belegt*); Oracle: 5 Volume-Backups im Always Free [5] | Backups außerhalb des Servers lagern und Wiederherstellung testen (*eigene Einschätzung*). |
| **Updates/Sicherheitspatches** | Plattform | Ubuntu: `unattended-upgrades` standardmäßig installiert, spielt Security-Updates täglich ein, **startet aber nicht automatisch neu** [45]; Node.js, Postgres, npm-Abhängigkeiten selbst aktualisieren | Bei Serverless (B) entfällt OS-Patching, Dependency-Updates bleiben (*eigene Einschätzung*). |
| **TLS** | Plattform | z. B. Caddy: holt und erneuert Zertifikate automatisch (Let's Encrypt/ZeroSSL) und leitet HTTP→HTTPS um [46] | Serverless-Plattformen liefern TLS mit (*Annahme*, nicht je Anbieter geprüft). |
| **Monitoring** | Dashboard der Plattform | Uptime-Check, Logs, Fehlertracking, Plattenplatz-/Backup-Alarm selbst einrichten | *Nicht recherchiert* (keine konkreten Dienste/Preise geprüft). |
| **Realtime/Sync** | Realtime enthalten [VR] | Polling, Server-Sent Events/WebSockets selbst bauen; auf Cloudflare z. B. Durable Objects [8] | Für 2 Personen genügt evtl. Polling + Push-Anstoß (*eigene Einschätzung*). |

## Hybrid-Varianten

1. **Eigene API + Supabase nur als Postgres:** Supabase erlaubt Direktverbindungen für „persistent backends, such as virtual machines … and long-running containers“; Direktverbindung nur über IPv6 (IPv4 nur mit Add-on), der Shared Pooler (Session Mode) ist IPv4 [47]. Vorteil: verwaltete DB, eigene API frei gestaltbar. Nachteil (*eigene Einschätzung*): Man verzichtet auf Supabase Auth/RLS-über-API/Storage und betreibt trotzdem einen eigenen Server; Supabase-Pausierung (an DB-Aktivität gekoppelt [VR]) bleibt bestehen.
2. **Supabase komplett + eigene Edge Functions** (= Vorrecherche-Empfehlung): eigener TypeScript-Code nur dort, wo nötig (KI-Proxy, Push) [VR]. Hono läuft auch auf Deno [16], d. h. Edge-Function-Code kann Hono nutzen (*Annahme*: Kompatibilität mit Supabase Edge Runtime nicht separat geprüft).
3. **Eigene API auf Serverless + Neon (Frankfurt):** Postgres ohne Kreditkarte, aber Scale-to-zero nach 5 min [29][30].
4. **Cloudflare Workers + Hyperdrive + externes Postgres:** Hyperdrive ist im Workers-Free-Plan enthalten (100.000 Queries/Tag) [48].

## Vergleich zur Supabase-Empfehlung

| Kriterium | Supabase Free (Frankfurt) | Eigen-Backend VPS (Hetzner CX23) | Eigen-Backend Serverless (Cloudflare Free, EU-Jurisdiktion) |
|---|---|---|---|
| Kosten/Monat | 0 € [VR] | ~6,5 € brutto + IPv4 + ggf. Backups (*eigene Rechnung*, [1]) | 0 € innerhalb der Limits [8][40] |
| Kreditkarte | nicht nötig (laut [VR]) | Hetzner-Konto mit Zahlungsmittel (*Annahme*) | Workers Free ohne (*Annahme*); R2: *nicht geprüft* |
| Betriebsaufwand | gering: Plattform übernimmt Auth, Storage, TLS, OS (*eigene Einschätzung*) | hoch: OS, Postgres, Backups, TLS, Monitoring selbst [43][45][46] | mittel: kein OS, aber Auth, Rechte, Backups von D1/R2-Daten, Monitoring selbst (*eigene Einschätzung*) |
| Free-Tier-Risiko | Pausierung bei Inaktivität [VR] | keines (bezahlt); Preiserhöhung 2026 belegt [1] | harte Tageslimits (100.000 Requests) [8]; 10 ms CPU [11] |
| Sicherheitsrisiko | RLS vergessen = Tabelle offen [VR] | jede Route, jedes Paket, offene Ports selbst absichern (*eigene Einschätzung*) | Rechteprüfung im Code (*eigene Einschätzung*) |
| Lerneffekt | Postgres/RLS, Edge Functions (*eigene Einschätzung*) | am höchsten: Linux, Netzwerk, TLS, DB-Betrieb, Auth-Interna (*eigene Einschätzung*) | hoch: API-Design, Auth, Edge-Plattform (*eigene Einschätzung*) |
| KI-Agent-Freundlichkeit | offizieller Supabase-MCP-Server [VR] | Code vollständig im Repo und testbar; Server-Administration per SSH durch Agenten heikel (*eigene Einschätzung*); Better Auth mit `llms.txt`/MCP [21] | Code + Konfiguration im Repo (*eigene Einschätzung*); Better Auth `llms.txt`/MCP [21] |
| Lock-in | gering (Open Source, selbst hostbar) [VR] | sehr gering: Standard-Postgres, Hono/Fastify (*eigene Einschätzung*) | mittel: D1/R2/Workers-APIs Cloudflare-spezifisch; Hono/Drizzle portabel [16][19] |
| Spätere Veröffentlichung | Pro ab 25 $/Monat [VR] | Server skalierbar (größere Hetzner-Typen [1]) | Paid ab 5 $/Monat [8] |
| Realtime | eingebaut [VR] | selbst bauen | selbst bauen / Durable Objects [8] |

## Empfehlung (Vorschlag – Entscheidung liegt bei euch)

1. **V1 weiter mit Supabase Free (Frankfurt)** wie in der Vorrecherche. Begründung: einzige geprüfte 0-€-Option, die Auth, Rechte (RLS), Fotospeicher, Serverfunktionen und Realtime ohne eigenen Betrieb abdeckt [VR]; ein Eigen-Backend verschiebt Sicherheits- und Betriebsverantwortung (Backups, Patches, TLS, Auth) auf einen Einzelbetreiber ohne Ops-Team [43][45][46].
2. **Lock-in klein halten:** KI-Proxy und Push-Versand als schlanke TypeScript-Funktionen schreiben (z. B. mit Hono, das auf Deno, Workers und Node läuft [16]); für Push den kostenlosen Expo Push Service nutzen [24].
3. **Falls Lerneffekt Priorität hat** (laut User-Profil möchte Philipp pro Projekt Neues lernen – *Kontext aus Projektnotizen, kein externer Beleg*): Eigen-Backend als eigenes Lernprojekt bzw. später, mit dem Stack **Hono + Drizzle + Better Auth** [16][19][21]. 0-€-Variante: Cloudflare Workers + D1/R2 mit EU-Jurisdiktion [8][9][10]; einfachste Betriebsvariante: Hetzner CX23 + Postgres + Caddy (~6,5 €/Monat brutto, *eigene Rechnung*) [1][46].
4. **Nicht empfohlen:** Fly.io (kein Free-Tier, Postgres ab 38 $) [12], Render Free (Schlaf nach 15 min, Free-DB nach 30 Tagen weg) [13], Railway Free (1 $ Guthaben) [14], Lucia (eingestellt) [33]. Oracle Always Free nur mit Vorbehalt (Kreditkarte, Idle-Rückforderung, Home-Region-Bindung) [5][6].

## Offene Punkte

- Hetzner: Preis für Primary IPv4 und für Server-Backups nicht auf Primärquelle verifiziert; Verfügbarkeitsanzeige „currently unavailable“ auf der Produktseite ungeklärt [2].
- Cloudflare: Ob R2 eine Zahlungsmethode verlangt und wo der Worker-Code tatsächlich ausgeführt wird (EU?), nicht geprüft.
- Deno Deploy: aktuelle Regionen nicht belegt.
- Render: Preise der kleinsten Bezahlstufen nicht belegt (Preisseite lieferte keinen Inhalt).
- Monitoring-Dienste und deren Kosten nicht recherchiert.
- Apple-Developer-Program-Kosten und iOS-Push ohne bezahlten Account: gehört zur iOS-Distributions-Recherche.
- Backup-Umfang von Supabase Free nicht erneut geprüft.

## Quellen (abgerufen am 2026-10-10)

1. Hetzner Docs: Price Adjustment 15 June 2026 (Cloud-Server-Preistabellen DE/FI) – https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/
2. Hetzner Cloud Cost-Optimized (CX/CAX-Spezifikationen, Standorte, 20 TB Traffic) – https://www.hetzner.com/cloud/cost-optimized/
3. Hetzner Docs: Cloud Billing FAQ – https://docs.hetzner.com/cloud/billing/faq/
4. Hetzner Docs: Primary IPs – https://docs.hetzner.com/cloud/servers/primary-ips/faq/
5. Oracle: Always Free Resources – https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
6. Oracle: Sign Up for the Free Oracle Cloud Promotion – https://docs.oracle.com/en-us/iaas/Content/GSG/Tasks/signingup_topic-Sign_Up_for_Free_Oracle_Cloud_Promotion.htm
7. Oracle: What Happens When the Promotion Expires – https://docs.oracle.com/en-us/iaas/Content/GSG/Tasks/signingup_topic-What_Happens_When_the_Promotion_Expires.htm
8. Cloudflare Workers Pricing (inkl. D1, KV, Durable Objects) – https://developers.cloudflare.com/workers/platform/pricing/
9. Cloudflare D1 Data Location – https://developers.cloudflare.com/d1/configuration/data-location/
10. Cloudflare R2 Data Location – https://developers.cloudflare.com/r2/reference/data-location/
11. Cloudflare Workers Limits – https://developers.cloudflare.com/workers/platform/limits/
12. Fly.io Pricing – https://docs.fly.io/about/pricing
13. Render Free Instances – https://render.com/docs/free
14. Railway Pricing Plans – https://docs.railway.com/reference/pricing/plans
15. Google Cloud Free Tier – https://docs.cloud.google.com/free/docs/free-cloud-features
16. Hono Docs – https://hono.dev/docs/
17. Fastify Docs – https://fastify.dev/docs/latest/
18. NestJS Docs – https://docs.nestjs.com/
19. Drizzle ORM Overview – https://orm.drizzle.team/docs/overview
20. Prisma Supported Databases – https://www.prisma.io/docs/orm/reference/supported-databases
21. Better Auth Introduction – https://www.better-auth.com/docs/introduction
22. Better Auth Expo Integration – https://www.better-auth.com/docs/integrations/expo
23. expo-server-sdk-node (GitHub) – https://github.com/expo/expo-server-sdk-node
24. Expo Push Notifications FAQ – https://docs.expo.dev/push-notifications/faq/
25. Deno Deploy Pricing – https://deno.com/deploy/pricing
26. Render Regions – https://render.com/docs/regions
27. Railway Regions – https://docs.railway.com/reference/regions
28. Fly.io Regions – https://docs.fly.io/reference/regions
29. Neon Pricing – https://neon.com/pricing
30. Neon Regions – https://neon.com/docs/introduction/regions
31. GitHub-Repos und npm-Registry (Version, Lizenz, letzte Releases; abgefragt per `gh api` und `npm view`): https://github.com/honojs/hono, https://github.com/fastify/fastify, https://github.com/nestjs/nest, https://github.com/drizzle-team/drizzle-orm, https://github.com/prisma/orm (ehemals prisma/prisma), https://github.com/better-auth/better-auth, https://github.com/expo/expo-server-sdk-node, https://www.npmjs.com/package/prisma
32. Better Auth Database – https://www.better-auth.com/docs/concepts/database
33. Lucia (GitHub, README) – https://github.com/lucia-auth/lucia
34. Apple App Review Guidelines 4.8 Login Services – https://developer.apple.com/app-store/review/guidelines/#login-services
35. Better Auth: Apple Provider – https://www.better-auth.com/docs/authentication/apple
36. Expo: Send notifications with the Expo Push Service – https://docs.expo.dev/push-notifications/sending-notifications/
37. FCM HTTP v1 API – https://firebase.google.com/docs/cloud-messaging/send/v1-api
38. Apple: Establishing a token-based connection to APNs – https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns
39. Apple: Compare Memberships – https://developer.apple.com/support/compare-memberships/
40. Cloudflare R2 Pricing – https://developers.cloudflare.com/r2/pricing/
41. Google Cloud Run Pricing – https://cloud.google.com/run/pricing
42. Hetzner Object Storage – https://www.hetzner.com/storage/object-storage/
43. PostgreSQL 18 Docs: Backup and Restore – https://www.postgresql.org/docs/current/backup.html
44. Hetzner Docs: Backups/Snapshots – https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/
45. Ubuntu Server Docs: Automatic updates – https://ubuntu.com/server/docs/how-to/software/automatic-updates/
46. Caddy: Automatic HTTPS – https://caddyserver.com/docs/automatic-https
47. Supabase: Connecting to Postgres – https://supabase.com/docs/guides/database/connecting-to-postgres
48. Cloudflare Hyperdrive Pricing – https://developers.cloudflare.com/hyperdrive/platform/pricing/
- [VR] Vorrecherche „Backend-Optionen für Sync, Auth und Push“ – https://github.com/Yggras/abnehm-app/blob/main/research/backend.md
