# Recherche: Google Health API zusätzlich zu Apple Health/Health Connect

Ticket: [#53](https://github.com/Yggras/abnehm-app/issues/53) · Stand: 12.10.2026 · Alle Quellen am 12.10.2026 abgerufen. Das Discovery-Dokument der API hatte die Revision `20261012` [12].

Quellen-Nummern in eckigen Klammern [n] verweisen auf die Liste am Ende. Mit *eigene Einschätzung* markierte Stellen sind nicht durch eine Quelle belegt. **Nicht belegt** heißt: Ich habe keine Primärquelle gefunden. Aufwandsschätzungen und Rechtsthemen (u. a. Datenschutz, Store-Richtlinien) werden laut `AGENTS.md` nicht betrachtet.

## Ausgangslage

- **Beschlossen (#38):** Die App liest nur Apple Health und Health Connect (Training und Gewicht). Importe sind schreibgeschützt. Bei ≥ 50 % Überschneidung ersetzt der Import den manuellen Eintrag [1].
- **Geräte (Karte #1):** Philipp hat ein iPhone und eine Fitbit Sense 2. Der Weg ist Google Health ≥ 5.05 → Apple Health. Seine Frau hat Android und Fitbit, der Weg ist Health Connect [2].
- **Hintergrund-Import (#45):** machbar, aber nur als Bonus. Wie schnell Fitbit nach Health Connect schreibt, ist nicht belegt [3].
- **Fitbit Web API:** Der Support endet am 30.09.2026. Am 30.10.2026 wird die API abgeschaltet und synchronisiert keine Daten mehr. Nachfolger ist die Google Health API [4][5].

## Zusammenfassung

- **Antwort: technisch möglich, für V1 aber kein Muss.** Die Google Health API bringt Fitbit-Daten serverseitig über Webhooks ins Backend. Sie löst das Kernproblem aber nur teilweise: Auch dieser Weg hängt am Sync der Google-Health-App auf dem Handy [9]. Vorschlag: V1 bleibt bei zwei Wegen. Die API wird als Option vorgemerkt, falls der [Spike #47](https://github.com/Yggras/abnehm-app/issues/47) zeigt, dass Fitbit-Daten über Apple Health oder Health Connect zu spät oder unvollständig ankommen.
- **Zugang (2 Nutzer):**
  - Ohne Verifizierung sind bis zu 100 Nutzer möglich [6][7]. „Personal Use“-Apps mit weniger als 100 Nutzern brauchen keine Verifizierung [15].
  - Im Status **„Testing“** laufen Refresh-Tokens nach **7 Tagen** ab [6][16][17].
  - Im Status **„In production“** gilt das nicht [6]. Weil die meisten Scopes **restricted** sind [7], sehen die Nutzer dann aber einen Warnbildschirm „unverified app“. Für das Projekt gilt eine feste Obergrenze von 100 Nutzern [17][18]. Google rät von veröffentlichten, nicht verifizierten Apps ausdrücklich ab („Strongly discouraged“) [18].
- **Daten:** Es gibt alles Nötige:
  - `exercise` mit Dauer, `activeDuration` und `caloriesKcal` [9][11][12]
  - `weight` [9]
  - `active-minutes` und `active-zone-minutes` [9]
  - `active-energy-burned` und `total-calories` [9]
  - Historie ohne API-Grenze [9]

  Rate-Limits: 300 Requests pro Minute und Nutzer [10]. Webhooks gibt es u. a. für Exercise, Weight und Active Minutes. Sie melden nur, *dass* sich etwas geändert hat. Die Daten muss man danach abrufen [13].
- **Duplikate:** zuverlässig erkennbar, auf allen drei Wegen.
  - Apple Health setzt die Quelle (`sourceRevision.source.bundleIdentifier`) selbst [19][20][21].
  - Health Connect setzt `dataOrigin.packageName` selbst [22][23].
  - Die Google Health API kennzeichnet jeden Datenpunkt mit `dataSource.platform` (`FITBIT`, `HEALTH_KIT`, `HEALTH_CONNECT` …) [12].
  - Die Google-Health-App hat auf beiden Plattformen die Kennung `com.fitbit.FitbitMobile` [24][25].
- **Achtung, Datenkreislauf:** Google Health liest auch **aus** Apple Health und Health Connect und speichert diese Daten im Google-Health-Konto [8][26][27]. Über die API kämen also auch Daten von Waagen, Apple Watch oder anderen Apps zurück. Der Server müsste sie herausfiltern.

## 1. Zugang: OAuth, Verifizierung, Token-Laufzeit

- **Projekt und Client:** Man braucht ein Google-Cloud-Projekt mit einem OAuth-Client vom Typ „Web Server“, also mit Client-ID und Client-Secret [6]. Eine Sandbox gibt es nicht. Google empfiehlt getrennte Projekte für Entwicklung, Staging und Produktion [6].
- **Nutzerlimit:** „newly created OAuth clients are in an unverified state with a cap of 100 users“ [6]. Mehr als 100 Nutzer erfordern eine Sicherheitsprüfung durch Dritte [6][7].
- **Restricted Scopes:** „Most scopes for the Google Health API are restricted“ [7]. Welche Scopes genau restricted und welche sensitive sind, steht auf keiner Seite: **nicht belegt** [7][11]. Für eine öffentliche Verifizierung wären eine OAuth-Prüfung und eine **jährliche** CASA-Sicherheitsprüfung nötig [7]. Für 2 Personen ist das nicht erforderlich [15].
- **Ausnahme „Personal Use“:** Apps für den persönlichen Gebrauch mit „fewer than 100 users“ brauchen keine Verifizierung. Die Nutzer können sich durch die Warnung „unverified app“ klicken [15]. Apps im Entwicklungs- oder Testmodus sind ebenfalls ausgenommen, mit Warnbildschirm und 100-Nutzer-Grenze [15].
- **Testing:**
  - Höchstens 100 Testnutzer [17].
  - „Authorizations by a test user will expire seven days from the time of consent“, das gilt auch für das Refresh-Token [17].
  - Ausgenommen sind nur reine Profil- und OpenID-Scopes [16]. Die Health-Scopes gehören nicht dazu.
  - Für den Dauerbetrieb ist Testing deshalb ungeeignet: Beide müssten jede Woche neu zustimmen (*eigene Einschätzung*, folgt aus [6][16][17]).
- **In production:**
  - „refresh tokens generally don't expire unless they are revoked“ [6].
  - Ungenutzt verfallen Refresh-Tokens nach 6 Monaten [5][6][16].
  - Pro Google-Konto und Client gibt es höchstens 100 Refresh-Tokens. Ein neues Token macht das älteste ohne Warnung ungültig [16].
  - Nicht verifizierte, veröffentlichte Apps mit sensitive oder restricted Scopes zeigen „Danger UI“. Es gilt „a hard cap of 100 total users“ über die gesamte Projektlaufzeit [17][18]. Google bewertet diese Kombination als „Strongly discouraged“ [18].
- **Ergebnis für 2 Personen:** Der Status „In production“ ohne Verifizierung passt zur Ausnahme „Personal Use“ [15]. Die Tokens laufen dann nicht nach 7 Tagen ab [6]. Der Preis ist ein einmaliger Warnbildschirm beim Verbinden [17][18]. Ob Google so ein Projekt dauerhaft duldet, ist über die zitierten Regeln hinaus **nicht belegt**. Konkret geht es um die Kombination aus „Strongly discouraged“ [18] und Personal Use [15].
- **Kosten:** Die Setup- und Rate-Limit-Seiten nennen keine Gebühren für die API-Nutzung [6][10]. Eine ausdrückliche Aussage „kostenlos“ habe ich nicht gefunden: **nicht belegt**.
- **Unterschied zur alten Fitbit Web API:** Dort lief ein Refresh-Token nie ab und war nur einmal nutzbar. Bei der Google Health API kann es mehrere Refresh-Tokens pro Nutzer geben. Fitbit-Nutzer müssen neu zustimmen [5].

## 2. Daten, Aktualität, Limits, Webhooks

### Datentypen (Auswahl, relevant für die App)

| Bedarf | Datentyp | Scope | Webhook | Hinweis |
|---|---|---|---|---|
| Training | `exercise` (Session) | `activity_and_fitness.readonly` | ja | `interval`, `activeDuration` (ohne Pausen), `metricsSummary.caloriesKcal`, `exerciseType`, `notes` [9][11][12]. Seitengröße max. 25 [9] |
| Gewicht | `weight` (Sample) | `health_metrics_and_measurements.readonly` | ja | `weightGrams`, `sampleTime` [9][12]. Als kompatible Geräte nennt die Doku nur Fitbit-Aria-Waagen [9] |
| Körperfett | `body-fat` | `health_metrics_and_measurements.readonly` | ja | [9] |
| Aktive Minuten | `active-minutes`, `active-zone-minutes` (Interval) | `activity_and_fitness.readonly` | ja | Rollup max. 14 Tage pro Abfrage bei `active-minutes` [9] |
| Kalorien | `active-energy-burned` (Interval), `total-calories` (nur Rollup) | `activity_and_fitness.readonly` | nein | Rollup max. 14 Tage pro Abfrage bei `total-calories` [9] |

- **Historie:** Historische Daten sind abfragbar „as far back as it has been recorded“, die API setzt dafür „no limitations or restrictions“ [9]. Zum Vergleich: Health Connect liest standardmäßig nur 30 Tage rückwirkend [2].
- **Kalorien:** Laut Health-Recherche (#6) schreibt Fitbit keine aktiven Kalorien nach Health Connect [2]. Die Google Health API liefert aktive Kalorien pro Training (`caloriesKcal`) und als eigenen Typ (`active-energy-burned`) [9][12].
- **Stabilität:**
  - Die API startete am 24.03.2026 [14].
  - Der aktuelle Kanal heißt `v4`. Seit 01.10.2026 gibt es zusätzlich `v4beta` als Vorschau [14].
  - Scopes wurden am 26.05.2026 umbenannt (Read/Write → `.writeonly`) [14].
  - Die API ist jung und ändert sich noch (*eigene Einschätzung*, gestützt auf [14]).

### Wie aktuell sind die Daten?

- „Fitbit devices can't communicate directly with third-party applications or services“. Die Daten laufen über die Google-Health-App in die Cloud und stehen erst dann in der API [9].
- Wie oft die Uhr synchronisiert und wie schnell Daten danach in der API ankommen, steht nirgends: **nicht belegt** [9][13]. Schon die Health-Recherche (#45) fand kein dokumentiertes Sync-Intervall der Google-Health-App [3].
- **Folge:** Der Server-Weg macht die App unabhängig vom Hintergrund-Verhalten **unserer** App. Er bleibt aber abhängig davon, dass die **Google-Health-App** auf dem Handy synchronisiert (*eigene Einschätzung*, folgt aus [9]).

### Rate-Limits

- Pro Nutzer: 300 Requests pro Minute (Standard 5 QPS) [10].
- Pro Projekt: 120.000 pro Minute und 86,4 Mio. pro Tag. Nicht verifizierte Apps sind auf 250 QPS insgesamt begrenzt [10].
- Bei Überschreitung kommt `429 Too Many Requests`. Google empfiehlt Backoff und Retry [10].
- Für 2 Nutzer mit wenigen Abfragen pro Stunde ist das unkritisch (*eigene Einschätzung*).

### Webhooks statt Polling

- **Prinzip:** Der Server bekommt einen HTTPS-POST, „as soon as data is available“, statt selbst zu pollen [13].
- **Einrichtung:** Ein Subscriber wird über `projects.subscribers.create` angelegt, mit `endpointUri`, `subscriberConfigs` (Datentypen) und `endpointAuthorization` [12][13]. Mit `subscriptionCreatePolicy: AUTOMATIC` legt Google die Subscriptions pro Nutzer selbst an, sobald die passenden Scopes erteilt sind [13].
- **Endpoint-Prüfung:** Die API schickt zwei Verifizierungs-POSTs. Mit korrektem `Authorization`-Header muss der Server 200 oder 201 antworten, ohne Header 401 oder 403 [13].
- **Anforderungen:** HTTPS (TLS 1.2+) und öffentlich erreichbar [13]. Das Hetzner-Backend müsste also einen öffentlichen Webhook-Endpunkt anbieten (*eigene Einschätzung*).
- **Sicherheit:** Bei jeder Nachricht kommt das Secret im `Authorization`-Header. Zusätzlich ist jeder Payload signiert (Header `GOOGLE-HEALTH-API-SIGNATURE`, prüfbar per Tink oder öffentlichem Keyset). Die Schlüssel rotieren alle 30 Tage [13].
- **Inhalt:**
  - Eine Nachricht enthält nur Metadaten: `healthUserId`, `dataType`, `operation` (UPSERT/DELETE) und `intervals`, gebündelt bis 99 Nachrichten [13].
  - Die Messwerte muss der Server danach per API holen [13].
  - Rückwirkend wird nichts nachgeliefert („not backfilled“) [13].
  - Systemseitige Löschungen lösen keinen Webhook aus [13].
- **Zustellung:**
  - Der Server muss sofort mit `204` antworten. Sonst versucht Google es später erneut [13].
  - Ist der Endpunkt nicht erreichbar, hält Google Nachrichten bis zu 7 Tage vor (exponentieller Backoff) [13][14].
  - Google empfiehlt eine idempotente Verarbeitung [13].
  - Eine Latenzangabe gibt es nicht: **nicht belegt** [13].

## 3. Duplikate: „Import gegen Import“

### Woher die Doppelungen kommen

- **Google Health → Apple Health:** Die Google-Health-App schreibt u. a. Training, aktive Kalorien, Gewicht und Körperfett nach Apple Health [26].
- **Google Health → Health Connect:** Laut Health-Recherche (#45) schreibt die App Exercise, Weight und Total calories burned nach Health Connect [3].
- **Rückrichtung:** Google Health liest auch **aus** Apple Health (Training, Gewicht, Körperfett u. a.) und speichert diese Daten im Google-Health-Konto: „data from these sources is stored in your Google Health account“ [26]. Aus Apple Health liest die App derzeit 3 Monate Historie [26]. Für Health Connect gilt das ebenfalls: Die Familie `google-sources` enthält ausdrücklich „data from Health Connect“ [8].
- **Eigene Bereinigung von Google:** „Google Health tries to remove duplicate data synced from multiple connections“, Duplikate können trotzdem auftreten [27]. Eine Prioritätsregel für Quellen nennt die Hilfe nicht [27].

### Erkennungsmerkmale je Weg

| Weg | Feld | Wer setzt es | Wert für Google Health/Fitbit |
|---|---|---|---|
| Apple Health (HealthKit) | `HKObject.sourceRevision.source.bundleIdentifier` | HealthKit beim Speichern: „The system automatically sets this property“ [20]. Für Apps steht dort die Bundle-ID der App [21] | `com.fitbit.FitbitMobile` (Bundle-ID laut App Store, App „Google Health (Fitbit)“, Version 5.10 vom 09.10.2026) [24] |
| Health Connect | `Metadata.dataOrigin.packageName` | „auto-populated by Health Platform at insertion time of the client package name“ [23] | `com.fitbit.FitbitMobile` (Play-Store-Eintrag „Google Health (Fitbit)“) [25] |
| Google Health API | `dataSource.platform` (Output only) | Google: „Captures the platform that uploaded the data“ [12] | `FITBIT` für Fitbit. Daten aus Apple Health und Health Connect tragen `HEALTH_KIT` bzw. `HEALTH_CONNECT` [12] |
| Google Health API | `dataSource.application.packageName` | Google, wenn die Daten aus der Fitbit-App, Health Connect oder HealthKit kommen [12] | Paketname bzw. Bundle-ID der Ursprungs-App [12] |
| Google Health API | `dataSource.recordingMethod` | optional [12] | u. a. `MANUAL`, `ACTIVELY_MEASURED`, `PASSIVELY_MEASURED` [12] |
| Google Health API | Parameter `dataSourceFamily` | Abfrage-Filter für `reconcile`, `rollUp`, `dailyRollUp` [8] | `google-wearables` = nur Google- und Fitbit-Geräte, ohne manuelle und geschätzte Daten [8] |

- Dass die Google-Health-App in HealthKit mit der Bundle-ID `com.fitbit.FitbitMobile` als Quelle erscheint, ist **abgeleitet** aus Apples Definition [21] und der App-Store-Bundle-ID [24]. Auf dem Gerät gemessen ist das nicht: **nicht belegt**, im Spike #47 prüfen. Dasselbe gilt für `dataOrigin` auf Android [23][25].
- In welche `dataSourceFamily` Daten mit `platform = HEALTH_KIT` fallen, ist nicht dokumentiert: **nicht belegt** [8].
- `platform` ist kein Filterfeld der API. Die dokumentierten Filter betreffen nur Zeitfelder [8]. Nach `platform` muss also der Server selbst filtern (*eigene Einschätzung*, folgt aus [8][12]).
- Ob Google Health beim Schreiben nach HealthKit eigene IDs in den Metadaten hinterlegt (z. B. `HKMetadataKeyExternalUUID` oder `HKMetadataKeySyncIdentifier` [28]), ist nicht dokumentiert: **nicht belegt**. Eine exakte ID-Zuordnung zwischen API-Datenpunkt und HealthKit-Sample ist daher nicht gesichert.

### Vorschlag für die Regel „Import gegen Import“ (nur falls der dritte Weg kommt)

1. **Eine Quelle pro Herkunft.** Fitbit-Daten kommen ausschließlich über die Google Health API (*eigene Einschätzung*).
   - **iOS:** Beim Import aus Apple Health werden Samples mit der Quelle `com.fitbit.FitbitMobile` verworfen [20][21][24].
   - **Android:** Beim Import aus Health Connect werden Records mit `dataOrigin.packageName == "com.fitbit.FitbitMobile"` verworfen [23][25].
2. **Server-seitig nur Fitbit-Eigenes übernehmen.**
   - Datenpunkte mit `dataSource.platform` `HEALTH_KIT` oder `HEALTH_CONNECT` werden verworfen. Sie kommen über das Handy ohnehin direkt [12][26].
   - Übernommen wird `FITBIT`. Eventuell kommt `MANUAL` aus der Google-Health-App dazu [12].
   - Alternativ wird bei `reconcile`/`rollUp` `dataSourceFamily = google-wearables` genutzt [8]. Dann fallen aber auch manuelle Einträge in der Google-Health-App weg [8].
   - Ob Aria-Gewichte `platform = FITBIT` tragen, ist **nicht belegt**.
3. **Rückfall Überschneidung:** Bleiben trotzdem zwei Import-Trainings mit ≥ 50 % zeitlicher Überschneidung übrig, zählt nur eines. Die Rangfolge wäre Google Health API vor Apple Health/Health Connect. Das ist analog zur bestehenden Regel „Import ersetzt manuell“ [1] (*eigene Einschätzung*).
4. **Gewicht:** Zwei Messungen mit gleichem Zeitpunkt (z. B. ± 1 min) und gleichem Wert aus verschiedenen Wegen gelten als eine. Das Tagesgewicht bleibt die früheste Messung [1] (*eigene Einschätzung*, Toleranz im Spike prüfen).

## 4. Aufwand-Treiber (ohne Schätzung)

- **OAuth-Flow in Expo:**
  - Google verbietet OAuth-Anfragen in einem „embedded user-agent under the developer's control“ [29].
  - `expo-web-browser` `openAuthSessionAsync` nutzt auf iOS `ASWebAuthenticationSession` und auf Android Chrome Custom Tabs, also den System-Browser [30].
  - Der Client vom Typ „Web Server“ braucht eine Redirect-URI [6]. Naheliegend ist ein Callback auf dem Hono-Backend, das den Code serverseitig eintauscht und dann per App-Schema zurück in die App leitet. Das Client-Secret bleibt so auf dem Server (*eigene Einschätzung*, passt zu [29]).
- **Token-Speicherung:** Die Refresh-Tokens liegen pro Person im Postgres-Backend. Google verlangt „always store encrypted tokens at rest“ und das Löschen widerrufener Tokens [29]. Das Client-Secret gehört wie ein Passwort geschützt und nie in ein öffentliches Repo [29]. Die Token-Verwaltung muss mit dem Fehlerfall umgehen: Ablauf nach 6 Monaten Nichtnutzung, Widerruf, 100-Token-Grenze [16].
- **Webhook-Endpunkt:** Er braucht eine öffentliche HTTPS-Route, die Secret und Signatur prüft und sofort mit `204` antwortet. Danach holt ein Abruf-Job die geänderten Daten [13]. Die Verarbeitung muss idempotent sein [13].
- **Abruf-Job:** Er läuft nach jedem Webhook und zusätzlich als periodischer Abgleich, weil nichts rückwirkend nachgeliefert wird und eine Latenz nicht zugesagt ist [13]. Zu beachten sind Seitengröße 25 bei `exercise` und 14-Tage-Fenster bei einigen Rollups [9].
- **Weitere Punkte:**
  - Duplikat-Filter auf drei Wegen (Abschnitt 3).
  - Ein zweites Cloud-Projekt für Entwicklung, weil Google keine Sandbox anbietet [6].
  - Weiterleitung neuer Server-Daten an die Handys über den bestehenden `/sync/pull` [2].
  - Die Einordnung „Personal Use“ und das Verhalten bei der Google-Prüfung sind organisatorisch und hier nur als Risiko vermerkt.

## Vergleich: zwei oder drei Wege

| Kriterium | 2 Wege (Apple Health + Health Connect) | + Google Health API (3 Wege) |
|---|---|---|
| Unabhängig vom Hintergrund-Verhalten unserer App | nein, Import beim Öffnen bzw. Bonus-Hintergrund [3] | ja für Fitbit-Daten, per Webhook [13] |
| Abhängig vom Sync der Google-Health-App | ja [3] | ja [9] |
| Aktive Kalorien pro Training | iOS ja (Google Health schreibt aktive Kalorien [26]), Android nein [2] | ja [9][12] |
| Historie | Health Connect 30 Tage Standard [2] | unbegrenzt laut Doku [9] |
| Waage/andere Apps/Apple Watch | ja | nur indirekt (über Health Connect/HealthKit, `HEALTH_KIT`/`HEALTH_CONNECT`) [12][26]. Die Health-Plattformen bleiben nötig |
| Zusätzliche Bausteine | keine | OAuth, Token-Speicher, Webhook, Abruf-Job, Duplikat-Filter [13][16][29] |
| Externe Risiken | Plattform-Drosselung [3] | Warnbildschirm, „Strongly discouraged“ [18], junge API [14] |

## Vorschlag (Entscheidung beim Nutzer)

**V1 mit zwei Wegen (Apple Health + Health Connect). Die Google Health API ist vorgemerkt, wird aber nicht gebaut.**

- **Begründung:**
  - Der Server-Weg beseitigt nicht die Abhängigkeit vom Sync der Google-Health-App [9].
  - Die Health-Plattformen bleiben für Waage, manuelle Einträge und andere Apps ohnehin nötig.
  - Der dritte Weg bringt einen eigenen OAuth-, Token- und Webhook-Stack und Filterregeln gegen Kreisläufe [8][13][26].
  - Für 2 Personen geht das nur mit dem Warnbildschirm einer nicht verifizierten App [17][18].
- **Auslöser für den dritten Weg:** Der Spike #47 zeigt auf einem der Geräte, dass Fitbit-Trainings über Apple Health oder Health Connect regelmäßig erst Stunden später oder unvollständig ankommen. Oder aktive Kalorien pro Training werden auf Android wichtig [2][9].
- **Falls doch:**
  - Projekt im Status „In production“ ohne Verifizierung („Personal Use“) [6][15].
  - Nur die Scopes `activity_and_fitness.readonly` und `health_metrics_and_measurements.readonly` [9][11].
  - Webhooks für `exercise`, `weight`, `active-minutes` mit periodischem Abgleich [13].
  - Duplikat-Regel wie in Abschnitt 3.
  - Kein Import mehr von `com.fitbit.FitbitMobile` aus Apple Health und Health Connect.

## Offene / nicht belegte Punkte

- **Latenz Fitbit → Google-Cloud → Webhook:** nicht belegt [9][13]. Nur durch Messung klärbar (Spike #47).
- **Dauerhafter Betrieb als nicht verifizierte, veröffentlichte App:** erlaubt laut „Personal Use“ [15], aber „Strongly discouraged“ [18]. Wie Google das in der Praxis behandelt, ist nicht belegt.
- **Einstufung der einzelnen Scopes** als sensitive oder restricted: nicht belegt, nur „most … are restricted“ [7].
- **Kosten der API-Nutzung:** keine Angabe gefunden, nicht belegt [6][10].
- **HealthKit-Quelle der Google-Health-App** (`com.fitbit.FitbitMobile`) und **Health-Connect-`dataOrigin`:** abgeleitet [21][23][24][25], auf dem Gerät nicht geprüft.
- **`dataSourceFamily` für Daten mit `platform = HEALTH_KIT`:** nicht dokumentiert [8].
- **Ob Google Health bereits aus Apple Health gelesene Daten wieder nach Apple Health zurückschreibt** (Kreislauf auf dem iPhone): nicht dokumentiert [26][27].
- **`platform`-Wert für Fitbit-Aria-Gewichte:** nicht belegt.
- **Rechtliches** (Datenschutz, Google-Richtlinie zu API-Nutzerdaten [15]): laut `AGENTS.md` hier nicht betrachtet.

## Quellen

Abgerufen am 12.10.2026.

1. Ticket #38, Erfassung von Wasser, Sport und Gewicht festlegen: https://github.com/Yggras/abnehm-app/issues/38 *(Projekt)*
2. Wayfinder-Karte #1 (Geräte, Decisions zu #6, #35, #38): https://github.com/Yggras/abnehm-app/issues/1 *(Projekt)*
3. Recherche #45, `research/health-background.md`: https://github.com/Yggras/abnehm-app/blob/research/health-background/research/health-background.md *(Projekt)*
4. Google Health API, Newsletter (Abschaltungs-Hinweis, August 2026): https://developers.google.com/health/newsletters *(Doku)*
5. Google Health API, Migration „Data Access and Authorization“: https://developers.google.com/health/migration/data-access *(Doku)*
6. Google Health API, „Set up Google Cloud and OAuth“ (Stand 09.10.2026): https://developers.google.com/health/setup *(Doku)*
7. Google Health API, „App verification“ (Stand 25.09.2026): https://developers.google.com/health/app-verification *(Doku)*
8. Google Health API, „Filter data“ (`dataSourceFamily`): https://developers.google.com/health/filters *(Doku)*
9. Google Health API, „Google Health API data types“ (Tabelle, Query constraints, Third-party access, Historical data): https://developers.google.com/health/data-types *(Doku)*
10. Google Health API, „Quotas and Rate Limits“ (Stand 18.05.2026): https://developers.google.com/health/rate-limits *(Doku)*
11. Google Health API, „Scopes“ (Stand 09.10.2026): https://developers.google.com/health/scopes und „Develop Workout Experiences“: https://developers.google.com/health/data-types/workouts *(Doku)*
12. Google Health API, Discovery-Dokument v4 (Revision 20261012; Schemas `DataSource`, `Application`, `Exercise`, `MetricsSummary`, `Weight`, `Subscriber`, `SubscriberConfig`, OAuth-Scopes): https://health.googleapis.com/$discovery/rest?version=v4 *(API-Spezifikation)*
13. Google Health API, „Webhook subscriptions“ (Stand 24.09.2026): https://developers.google.com/health/webhooks *(Doku)*
14. Google Health API, Release Notes (24.03.2026 bis 01.10.2026): https://developers.google.com/health/release-notes *(Doku)*
15. Google Cloud Help, „When is verification not needed“: https://support.google.com/cloud/answer/13464323 *(Hersteller-Hilfe)*
16. Google Identity, „Using OAuth 2.0 to Access Google APIs“, Abschnitt Refresh token expiration: https://developers.google.com/identity/protocols/oauth2 *(Doku)*
17. Google Auth Platform Help, „Manage App Audience“: https://support.google.com/cloud/answer/15549945 *(Hersteller-Hilfe)*
18. Google Identity, „OAuth app state overview“: https://developers.google.com/identity/protocols/oauth2/production-readiness/overview *(Doku)*
19. Apple, `HKSourceRevision`: https://developer.apple.com/documentation/healthkit/hksourcerevision (JSON: https://developer.apple.com/tutorials/data/documentation/healthkit/hksourcerevision.json) *(Doku)*
20. Apple, `HKObject.sourceRevision`: https://developer.apple.com/documentation/healthkit/hkobject/sourcerevision (JSON: https://developer.apple.com/tutorials/data/documentation/healthkit/hkobject/sourcerevision.json) *(Doku)*
21. Apple, `HKSource` und `HKSource.bundleIdentifier`: https://developer.apple.com/documentation/healthkit/hksource, https://developer.apple.com/documentation/healthkit/hksource/bundleidentifier *(Doku)*
22. Android Developers, Health Connect `Metadata`: https://developer.android.com/reference/kotlin/androidx/health/connect/client/records/metadata/Metadata *(Doku)*
23. Android Developers, Health Connect `DataOrigin`: https://developer.android.com/reference/kotlin/androidx/health/connect/client/records/metadata/DataOrigin *(Doku)*
24. Apple iTunes Lookup API, Bundle-ID `com.fitbit.FitbitMobile` („Google Health (Fitbit)“, Version 5.10, 09.10.2026): https://itunes.apple.com/lookup?bundleId=com.fitbit.FitbitMobile&country=de, App-Store-Seite: https://apps.apple.com/de/app/google-health-fitbit/id462638897 *(Store)*
25. Google Play, „Google Health (Fitbit)“: https://play.google.com/store/apps/details?id=com.fitbit.FitbitMobile *(Store)*
26. Google Health Help, „How do I use Apple Health with the Google Health app?“: https://support.google.com/googlehealth/answer/17037331 *(Hersteller-Hilfe)*
27. Google Health Help, „Connect third-party devices & apps to the Google Health app“: https://support.google.com/googlehealth/answer/14236613 *(Hersteller-Hilfe)*
28. Apple, `HKMetadataKeyExternalUUID` und `HKMetadataKeySyncIdentifier`: https://developer.apple.com/documentation/healthkit/hkmetadatakeyexternaluuid, https://developer.apple.com/documentation/healthkit/hkmetadatakeysyncidentifier *(Doku)*
29. Google Identity, „OAuth 2.0 Policies“ (Use secure browsers, Handle user tokens securely, Handle client credentials securely): https://developers.google.com/identity/protocols/oauth2/policies *(Doku)*
30. Expo, WebBrowser (`openAuthSessionAsync`, SDK 57): https://docs.expo.dev/versions/latest/sdk/webbrowser/ *(Doku)*
