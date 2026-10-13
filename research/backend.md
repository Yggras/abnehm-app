# Recherche: Backend-Optionen für Sync, Auth und Push

Ticket: #3 · Stand der Recherche und aller Preisangaben: **2026-10-10**. Quellen-Nummern [n] verweisen auf die Liste am Ende. Aussagen ohne Quelle sind ausdrücklich als *Annahme* oder *eigene Rechnung* markiert.

## Zusammenfassung

- **Supabase (Free, Region Frankfurt)** deckt alle Anforderungen im kostenlosen Plan ab: Postgres mit Row Level Security (RLS) für Partner-Freigaben, Auth, Realtime, 1 GB Dateispeicher, 500.000 Edge-Function-Aufrufe/Monat für KI-Aufrufe mit serverseitigem Schlüssel [1][5][6][13]. Push gibt es **nicht nativ**, sondern über eine Edge Function, die FCM bzw. den Expo Push Service aufruft [7].
- **Firebase** hat die stärkste Mobile-Integration (Offline-Persistenz standardmäßig an, FCM kostenlos) [2][19], aber **Cloud Functions und Cloud Storage verlangen seit 2026 den Blaze-Plan** (Kreditkarte, Pay-as-you-go) [8][9]; Budget-Alerts stoppen dort keine Kosten (Spend-Caps nur für ausgewählte Dienste) [11]. Der kostenlose Storage-Anteil gilt nur für US-Regionen [10].
- **Appwrite Cloud** bringt Push (FCM + APNs) nativ mit und hat eine Frankfurt-Region [14][15], aber Free-Projekte werden pausiert, wenn 7 Tage **keine Entwicklungsaktivität in der Console** stattfindet – App-Traffic zählt laut Dokumentation nicht – und sind dann für Nutzer nicht erreichbar [16]. Für eine produktiv genutzte App im Free-Plan ein erhebliches Risiko.
- **PocketBase** ist schlank und Open Source (MIT), aber selbst zu hosten, hat keinen eingebauten Push und ist laut eigener Doku vor v1.0 „NOT recommended for production critical applications" [3][4].
- **Empfehlung (Entscheidung liegt bei euch):** Supabase Free in `eu-central-1` (Frankfurt) + FCM (bzw. Expo Push) für Stupser. Hauptrisiken: Pausierung bei Inaktivität (bei täglicher Nutzung durch 2 Personen laut Doku unkritisch [12]), 1-GB-Fotolimit, kein eingebauter Offline-Sync.

## Anforderungen (aus Ticket/Kontext)

Daten-Sync zwischen 2 Nutzern (iPhone + Android), Freigaben pro Bereich, einfache Auth, Server-Push (APNs + FCM) für Partner-Stupser, Speicher für Mahlzeitenfotos, Serverfunktion für KI-Vision-Aufrufe (API-Key nicht auf dem Gerät), 0 €/Monat (max. ~10 €), EU-Datenstandort bevorzugt, spätere Veröffentlichung nicht verbauen, gut von KI-Agenten bedienbar.

## Vergleichstabelle

| Kriterium | Supabase | Firebase | Appwrite Cloud | PocketBase (self-hosted) |
|---|---|---|---|---|
| Datenmodell | Postgres (SQL) [5] | Firestore (NoSQL-Dokumente) [2] | Datenbanken mit Tabellen/Zeilen [15] | SQLite eingebettet [3] |
| Sync / Realtime | Postgres Changes, Broadcast, Presence [13]; Offline-Sync in der Realtime-Doku nicht erwähnt [13] | Realtime; Offline-Persistenz auf Android/Apple standardmäßig an [19] | Realtime enthalten [14] | Realtime-Subscriptions [3] |
| Auth | enthalten, 50.000 MAU free [1] | enthalten, 50.000 MAU free [2] | enthalten, 75.000 MAU free [17] | eingebaut [3] |
| Rechte für Partner-Freigabe | RLS-Policies per SQL mit `auth.uid()`; RLS muss explizit aktiviert werden [5] | Security Rules (MCP-Server unterstützt beim Verständnis) [20] | Pro Zeile `Permission.read(Role.user(id))` / Teams [15] | API-Rules mit `@request.auth.id`, wirken auch als Filter [4] |
| Push (APNs + FCM) | nicht nativ; Edge Function ruft FCM/Expo auf [7] | FCM kostenlos [2]; iOS benötigt APNs-Key [21] | nativ: Messaging mit FCM- und APNs-Provider [14] | nicht in der Doku erwähnt [3] → eigene Lösung nötig |
| Dateispeicher (free) | 1 GB, 5 GB Egress [1] | nur mit Blaze (seit 03.02.2026) [9]; „Always Free" nur in US-CENTRAL1/US-EAST1/US-WEST1 [10] | 2 GB, 5 GB Bandbreite [17] | eigener Server-Speicher [3] |
| Serverfunktionen (KI-Key) | Edge Functions (Deno), 500.000/Monat free, Secrets per Dashboard/CLI [1][6] | Cloud Functions, Deploy nur mit Blaze [8] | Functions, 750.000 Ausführungen/Monat free [17] | als Go-Framework erweiterbar [3] |
| Free-Tier-Haken | Pausierung nach 1 Woche geringer DB-Aktivität; „a few user requests … each day" genügen; Wiederherstellung 1 Jahr möglich [12]; max. 2 aktive Projekte [1] | Blaze (Kreditkarte) für Functions + Storage nötig [8][9]; Budget-Alerts pausieren nichts, Spend-Cap nur für einzelne Dienste (u. a. Cloud Functions) [11] | Pausierung nach 7 Tagen ohne Console-Aktivität, Projekt dann für Nutzer nicht erreichbar [16]; nach 90 Tagen pausiert → Löschung [18] | Server-Kosten + Wartung; Hetzner-Preis konnte nicht verifiziert werden (siehe unten) |
| Nächste Bezahlstufe | Pro ab 25 $/Monat inkl. 10 $ Compute-Guthaben [1] | Pay-as-you-go [2] | „Start" ab 10 $/Monat (Blog 21.09.2026) [17] | – |
| EU-Datenstandort | Frankfurt, Irland, London, Paris, Stockholm, Zürich [22] | Firestore u. a. `europe-west3` (Frankfurt), `eur3` [23]; Functions u. a. `europe-west3` [24] | Frankfurt (einzige EU-Region aktuell) [25] | frei wählbar (eigener Server) |
| Vendor-Lock-in | gering: Apache-2.0, selbst hostbar per Docker [26][27]; Standard-Postgres | hoch: proprietär (*Einschätzung*, Firestore/Rules sind Google-spezifisch) | gering: BSD-3-Clause, selbst hostbar per Docker [28] | gering: MIT [4] |
| KI-Agent-Freundlichkeit | offizieller MCP-Server (SQL, Migrationen, Edge Functions deployen, TS-Typen), Claude Code unterstützt [29] | offizieller MCP-Server (Projekte, Auth, Firestore, Rules, FCM senden), Claude Code unterstützt [20] | nicht geprüft | nicht geprüft |

## Details je Option

### Supabase
- **Free-Plan** [1]: 500 MB Datenbank, 1 GB Dateispeicher, 5 GB Egress, 50.000 MAU, 500.000 Edge-Function-Aufrufe, 2 Mio. Realtime-Nachrichten, 200 gleichzeitige Verbindungen, max. 2 aktive Projekte, Pausierung nach 1 Woche Inaktivität.
- **Pausierung** [12]: Inaktiv heißt „does not receive sufficient user database activity over the past week"; laut Doku reichen „a few user requests to the database each day". Wiederherstellung innerhalb 1 Jahr in Studio. (Ein älterer Changelog-Eintrag von 2024 nannte 90 Tage [30]; die aktuelle Doku sagt 1 Jahr.)
- **Partner-Freigabe**: RLS-Policies (z. B. `using ((select auth.uid()) = user_id)`) wirken wie ein automatisches `WHERE` [5]. Freigaben pro Bereich lassen sich als Policy, die eine Freigabe-Tabelle abfragt, abbilden (*Entwurfsidee, nicht aus Doku*). Achtung: Tabellen ohne RLS sind über die API les- und schreibbar [5].
- **Push**: Offizielles Beispiel: Database Webhook → Edge Function → Expo Push API oder FCM HTTP v1 [7]. Expo leitet an FCM/APNs weiter, Limit 600 Benachrichtigungen/s pro Projekt [31]. Ob Expo Push kostenlos ist, steht auf der geprüften Seite nicht [31] → offen.
- **KI-Aufruf**: Edge Functions lesen Secrets über `Deno.env.get`; Secrets werden über Dashboard/CLI gesetzt [6].

### Firebase
- **Spark (kostenlos)** [2]: Firestore 1 GiB, 50.000 Reads/Tag, 20.000 Writes/Tag, 20.000 Deletes/Tag; Auth 50.000 MAU; FCM ohne Kosten.
- **Blaze-Pflicht**: „Upgrade your project to the pay-as-you-go Blaze pricing plan and deploy your functions" [8]. Cloud Storage „(even default buckets) now requires … Blaze", gültig seit 03.02.2026; kostenlose Nutzung bleibt im Blaze-Plan erhalten [9].
- **EU-Fotos kosten**: Der „Always Free"-Storage gilt nur für US-CENTRAL1, US-EAST1, US-WEST1 [10]. EU-Buckets werden nach Standard-GCS-Preisen abgerechnet [10] (Höhe nicht geprüft; bei wenigen GB vermutlich Cent-Beträge – *Annahme*).
- **Kostenschutz**: Budget-Alerts „do not pause services"; Spend-Cap-Budgets gibt es nur für ausgewählte Dienste (Firebase AI Logic, App Hosting, Cloud Functions, Extensions) [11].
- **Stärke**: Offline-Persistenz auf Android/Apple standardmäßig aktiv [19] – relevant, falls Offline-Erfassung wichtig wird.

### Appwrite Cloud
- **Free** [17]: 5 GB Bandbreite, 2 GB Speicher, 750.000 Function-Ausführungen, 75.000 MAU. Pro Projekt max. 1 Datenbank, 3 Buckets, 5 Functions; 2 Projekte pro Konto [32].
- **Push nativ**: Messaging mit FCM- und APNs-Providern [14] – das ist der größte funktionale Vorteil gegenüber Supabase.
- **K.-o.-Risiko im Free-Plan**: „Projects on the Free plan with no development activity for 7 consecutive days will be automatically paused" und „The project is not accessible to users while paused" (Changelog 20.02.2026) [16]. Dass reiner App-Traffic nicht zählt, ergibt sich aus der Formulierung „development activity in the Console" [16]; ausführlicher stand es nur in einer Suchzusammenfassung, nicht wörtlich verifiziert. Seit 29.06.2026 werden 90 Tage pausierte Free-Projekte gelöscht [18].
- Bezahlstufe „Start" ab 10 $/Monat (80 GB Bandbreite, 40 GB Speicher, 1,5 Mio. Ausführungen) [17] – läge an der Budgetgrenze (10 $ ≠ 10 €, Wechselkurs nicht geprüft).

### PocketBase
- Ein Binary mit SQLite, Realtime, Auth, Dateien, API-Rules [3][4]; MIT-Lizenz [33].
- „NOT recommended for production critical applications yet … full backward compatibility is not guaranteed before reaching v1.0.0" [3].
- Push: in der Doku nicht erwähnt [3] → FCM selbst anbinden.
- Hosting: z. B. Hetzner Cloud CX23 (2 vCPU, 4 GB RAM, 40 GB NVMe, Standorte u. a. Nürnberg/Falkenstein) [34][35]; **der Monatspreis wurde auf der Seite nicht angezeigt und ist nicht verifiziert.** Zusätzlich Betrieb, Backups, Updates in Eigenregie.

### Weitere Option: Convex (kurz)
- Free: 1 Mio. Funktionsaufrufe/Monat, 0,5 GB DB, 1 GB Dateispeicher, 1 GB Egress/Monat [36]. EU-Region, Push und Preise der Bezahlstufe konnten nicht verifiziert werden (Preisseite wird per JavaScript geladen). Nicht weiter verfolgt.

## Querschnitt: Push auf iOS
Unabhängig vom Backend: FCM auf Apple-Plattformen benötigt einen APNs-Authentifizierungsschlüssel aus dem Apple Developer Member Center [21]. Ob/wie das ohne bezahlten Apple-Developer-Account geht, ist hier nicht geprüft (gehört zur iOS-Distributions-Recherche).

## Eigene Abschätzung Fotospeicher (*eigene Rechnung, Annahmen*)
Annahme: 2 Personen × 5 Fotos/Tag × 200 KB (komprimiert) ≈ 2 MB/Tag ≈ 0,73 GB/Jahr. Supabase Free (1 GB [1]) reicht damit ca. 1 Jahr; danach Fotos löschen/verkleinern, Thumbnails speichern oder Pro-Plan. Appwrite Free (2 GB [17]) entsprechend ca. 2,5 Jahre.

## Empfehlung (Vorschlag – Entscheidung liegt bei euch)
**Supabase Free, Region Frankfurt (`eu-central-1`)**, mit:
1. RLS-Policies + Freigabe-Tabelle für Partner-Sharing pro Bereich,
2. Supabase Auth (E-Mail oder Social-Login),
3. Storage für Fotos (clientseitig komprimieren),
4. Edge Function als Proxy zur KI-Vision-API (Key als Secret),
5. Edge Function → FCM HTTP v1 (Android + iOS via APNs-Key) oder Expo Push, ausgelöst per Database Webhook [7].

Begründung: einzige geprüfte Option, die alles im Free-Plan ohne Kreditkarte abdeckt; EU-Region; Open Source und selbst hostbar (kein harter Lock-in, gut für spätere Veröffentlichung); offizieller MCP-Server mit Claude-Code-Support erleichtert die Arbeit der KI-Agenten [1][22][26][29].

**Plan B:** Firebase (Blaze mit Spend-Cap auf Functions), falls Offline-First wichtiger wird als 0 € ohne Kreditkarte.
**Nicht empfohlen im Free-Plan:** Appwrite (Pausierung trotz Nutzung), PocketBase (Betrieb + pre-1.0 + kein Push).

**Offene Punkte:** Kosten Expo Push; Offline-Strategie mit Supabase (z. B. lokaler Cache) – separat klären; DSGVO-Verträge (AVV/DPA) der Anbieter wurden nicht geprüft.

## Quellen (abgerufen am 2026-10-10)
1. Supabase Pricing – https://supabase.com/pricing
2. Firebase Pricing – https://firebase.google.com/pricing
3. PocketBase Docs (v0.40.5) – https://pocketbase.io/docs/
4. PocketBase API Rules and Filters – https://pocketbase.io/docs/api-rules-and-filters/
5. Supabase Row Level Security – https://supabase.com/docs/guides/database/postgres/row-level-security
6. Supabase Edge Functions Secrets – https://supabase.com/docs/guides/functions/secrets
7. Supabase Push Notifications Beispiel – https://supabase.com/docs/guides/functions/examples/push-notifications
8. Firebase Cloud Functions – https://firebase.google.com/docs/functions
9. Firebase Storage FAQ (Änderungen Sept. 2024) – https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024
10. Cloud Storage for Firebase Locations – https://firebase.google.com/docs/storage/locations
11. Firebase: Avoid surprise bills – https://firebase.google.com/docs/projects/billing/avoid-surprise-bills
12. Supabase Project Pausing – https://supabase.com/docs/guides/platform/free-project-pausing
13. Supabase Realtime – https://supabase.com/docs/guides/realtime
14. Appwrite Messaging / FCM – https://appwrite.io/docs/products/messaging/fcm
15. Appwrite Permissions – https://appwrite.io/docs/advanced/platform/permissions
16. Appwrite Changelog 20.02.2026 (Pausierung) – https://appwrite.io/changelog/entry/2026-02-20-1
17. Appwrite Blog „Introducing Appwrite Start" (21.09.2026, inkl. Free-Vergleich) – https://appwrite.io/blog/post/introducing-appwrite-cloud-start-plan
18. Appwrite Changelog 29.06.2026 (Löschung nach 90 Tagen) – https://appwrite.io/changelog/entry/2026-06-29 (nur über Suchergebnis-Titel/Zusammenfassung erfasst, Seite nicht einzeln abgerufen)
19. Firestore Offline – https://firebase.google.com/docs/firestore/manage-data/enable-offline
20. Firebase MCP Server – https://firebase.google.com/docs/ai-assistance/mcp-server
21. FCM Apple Client Setup – https://firebase.google.com/docs/cloud-messaging/ios/client
22. Supabase Regions – https://supabase.com/docs/guides/platform/regions
23. Firestore Locations – https://firebase.google.com/docs/firestore/locations
24. Cloud Functions Locations – https://firebase.google.com/docs/functions/locations
25. Appwrite Regions – https://appwrite.io/docs/products/network/regions
26. Supabase GitHub (Apache 2.0) – https://github.com/supabase/supabase
27. Supabase Self-Hosting – https://supabase.com/docs/guides/self-hosting
28. Appwrite GitHub (BSD-3-Clause) – https://github.com/appwrite/appwrite
29. Supabase MCP Server – https://supabase.com/docs/guides/getting-started/mcp
30. Supabase Changelog (2024, 90 Tage) – https://supabase.com/changelog/27497-paused-free-plan-projects-are-restorable-for-90-days (nur Suchergebnis-Titel)
31. Expo: Sending notifications – https://docs.expo.dev/push-notifications/sending-notifications/
32. Appwrite Free Plan Docs – https://appwrite.io/docs/advanced/platform/free
33. PocketBase GitHub (MIT) – https://github.com/pocketbase/pocketbase
34. Hetzner Cloud – https://www.hetzner.com/cloud/
35. Hetzner Cost-Optimized – https://www.hetzner.com/cloud/cost-optimized/
36. Convex Limits – https://docs.convex.dev/production/state/limits
