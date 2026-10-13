# Recherche: Lebensmittel-Datenquelle und Barcode-Lookup

Issue: #4 · Stand der Recherche: 2026-10-10

Quellen stehen als Nummern in eckigen Klammern [n] im Text, die vollständige Liste ist am Ende. Eigene Messungen sind als **(eigene Messung)** gekennzeichnet und mit der genauen Abfrage dokumentiert, damit man sie nachprüfen kann.

## Zusammenfassung

- **Open Food Facts (OFF) eignet sich für Barcode-Lookups deutscher Produkte.** Für Deutschland sind rund 430.000 Produkte erfasst [3][E1]. Bei etwa 252.000 davon (ca. 59 %) ist der Status „Nährwertangaben vollständig“ gesetzt, bei rund 178.000 noch nicht [E1]. Lücken und Fehler kommen also vor, und OFF übernimmt ausdrücklich keine Gewähr für die Daten [1].
- **API-Limits:** 15 Produktabfragen/min/IP und 10 Suchabfragen/min/IP. Der Header `User-Agent: AppName/Version (Kontakt-E-Mail)` ist Pflicht. Von „Search-as-you-type“ über die API rät OFF ab [1]. Für zwei Nutzer reicht das beim Barcode-Lookup locker, für eine Live-Suche nicht.
- **Lizenz:** Die Datenbank steht unter ODbL, die Einzelinhalte unter DbCL, die Bilder unter CC BY-SA 3.0. Pflicht sind Namensnennung (mit Link auf openfoodfacts.org) und Share-Alike für abgeleitete Datenbanken [2][7][8]. Bei rein privater Nutzung greift das kaum. Bei einer späteren Veröffentlichung braucht es eine Quellenangabe in der App und eine saubere Trennung der eigenen Daten (siehe 1.4).
- **Offline:** Es gibt nächtliche Dumps (JSONL, CSV ca. 0,9 GB gz / 9 GB entpackt, MongoDB, Parquet) und Delta-Exporte der letzten 14 Tage [4].
- **Unverpackte bzw. generische Lebensmittel:** Der **Bundeslebensmittelschlüssel (BLS) 4.0** ist seit dem 16.12.2025 **kostenfrei**: rund 7.140 Lebensmittel, bis zu 138 Nährstoffe, Werte pro 100 g, Excel-Download. Laut FAQ ist die Nutzung ausdrücklich auch für App-Entwicklung freigegeben [9][10][11][12]. Ergänzend gibt es die Schweizer Nährwertdatenbank (1.246 Lebensmittel, deutschsprachig, kommerzielle Nutzung mit Quellenangabe erlaubt) [14] und USDA FoodData Central (CC0, englisch, US-Fokus) [5][6].
- **Empfehlung (siehe Abschnitt 4):** Barcodes über OFF per API mit lokalem Cache auflösen. Generische Lebensmittel kommen aus dem BLS 4.0, der als Offline-Tabelle in die App gebündelt wird. Favoriten und eigene Einträge werden lokal gespeichert. Die Schweizer Datenbank dient optional als Ergänzung, USDA nur als Fallback.

---

## 1. Open Food Facts

### 1.1 Abdeckung deutscher Produkte

| Kennzahl | Wert | Beleg |
|---|---|---|
| Produkte mit Land „Deutschland“ | 430.001 | Startseite de.openfoodfacts.org [3]; API-Abfrage [E1] |
| davon Status `en:nutrition-facts-completed` | 251.764 (≈ 58,6 %) | [E1] |
| davon Status `en:nutrition-facts-to-be-completed` | 178.256 (≈ 41,5 %) | [E1] |

Die beiden Teilmengen ergeben zusammen 430.020 und decken sich damit fast genau mit der Gesamtzahl. Der Status ist also für praktisch alle deutschen Produkte gesetzt. Die Prozentwerte habe ich selbst berechnet.

**Einschränkung:** Der Status „vollständig“ sagt nichts über die Richtigkeit. OFF schreibt dazu: *„there are no assurances that the data is accurate, complete, or reliable“* [1]. Eine Stichprobe über die Suche zeigte auch verunreinigte Felder. Bei einem Lidl-Skyr enthielt das Feld `brands` zum Beispiel Einträge wie „8 x Lidl 18.09“ [E2]. Die App sollte Nutzer deshalb Werte korrigieren bzw. lokal überschreiben lassen.

Nicht geprüft habe ich, wie hoch die Abdeckung bei typischen Einkäufen ist (also die Trefferquote pro gescanntem Artikel). Dazu habe ich keine belastbare offizielle Statistik gefunden. Ein Praxistest mit 20–30 eigenen Produkten vor der Implementierung wäre sinnvoll.

### 1.2 API: Rate-Limits, User-Agent, Nutzungsbedingungen

- Limits: *„15 req/min/IP address for all read product queries“* und *„10 req/min/IP address for all search queries“*. Wer sie überschreitet, riskiert eine IP-Sperre [1].
- Von Search-as-you-type über die API rät OFF ausdrücklich ab [1].
- Lesezugriffe brauchen keinen Account, aber einen eigenen User-Agent im Format `AppName/Version (ContactEmail)` [1].
- Für Schreibzugriffe (z. B. neue Produkte beitragen) ist ein Account nötig. Dabei ist der Benutzername zu verwenden, nicht die E-Mail-Adresse [1].
- Für Tests gibt es eine Staging-Umgebung: `world.openfoodfacts.net`, Basic Auth `off:off` [1].
- Wer mehrere hundert Produkte braucht, soll laut OFF die Dumps nutzen statt der API [1].
- Volltextsuche ist in API v3 nicht vorgesehen. OFF verweist dafür auf **Search-a-licious** (`search.openfoodfacts.org`) [1].
- Während der Recherche lieferte `world.openfoodfacts.org` bei mehreren Abfragen im Abstand von 7–8 s zeitweise HTTP 503 („Page temporarily unavailable“) [E1]. Die App sollte Fehler also robust behandeln (Retry, Cache, manuelle Eingabe als Fallback).

### 1.3 Suchqualität

- Search-a-licious basiert auf Elasticsearch und unterstützt Lucene-Syntax [15].
- Eigener Test [E2]: Die Suche nach `skyr natur` mit `langs=de` lieferte 5.462 Treffer. Die ersten fünf waren alle deutsche „Skyr Natur“-Produkte verschiedener Marken (K-Classic, Jeden Tag, Milram, Edeka Gut & Günstig, Milbona). Die Antwort kam in rund 10 ms. Gesucht wird in `product_name.de`, `generic_name.de`, `categories.de`, `labels.de` und `brands`, wie die Debug-Ausgabe der Antwort zeigt.
- Viele Treffer sind fast gleich, weil dasselbe Produkt mehrfach erfasst ist. In der UI braucht es daher Ranking oder Deduplizierung, zum Beispiel nach Marke.
- Ein eigenes Rate-Limit für Search-a-licious habe ich in der zugänglichen Dokumentation nicht gefunden (nicht verifizierbar). Die Wiki-Seite war bei der Recherche durch einen Bot-Schutz gesperrt.

### 1.4 Lizenzpflichten (ODbL / DbCL / CC BY-SA)

Belegte Fakten:
- Datenbank: ODbL 1.0. Einzelinhalte: DbCL 1.0. Produktbilder: CC BY-SA 3.0 [2].
- *„The individuals and entities who reproduce or re-use information, data and/or photos … have to mention the licence and to attribute the authorship to Open Food Facts with a link to https://openfoodfacts.org.“* [2]
- *„Derivative works must be shared under the same conditions.“* [2]
- ODbL-Kurzfassung: Namensnennung bei jeder öffentlichen Nutzung. Wer eine angepasste Datenbank öffentlich nutzt, muss sie ebenfalls unter ODbL anbieten [7].
- Definitionen im Lizenztext [8]:
  - „Produced Work“: ein Werk, das durch Nutzung der Datenbank entsteht, z. B. durch Abfragen.
  - „Derivative Database“: eine Datenbank, die einen wesentlichen Teil der Inhalte in eine neue Datenbank übernimmt.
  - „Publicly“: Weitergabe an Personen außerhalb der eigenen Kontrolle.
- Collective Databases, also mehrere unabhängige Datenbanken nebeneinander, müssen nicht als Ganzes unter ODbL gestellt werden (Abschnitt 4.5) [8].
- Bilder können Elemente enthalten, die Rechten Dritter unterliegen, etwa Marken. Vor einer Veröffentlichung sollte man außerdem prüfen, ob die App auf der ODbL-Non-Compliance-Liste steht. Kontakt für Fragen: reuse@openfoodfacts.org [16].

Einordnung (meine Interpretation, keine Rechtsberatung):
- **Private Nutzung durch ein Paar:** Es findet keine öffentliche Nutzung bzw. Weitergabe im Sinne von „Publicly“ statt [8]. Share-Alike greift deshalb praktisch nicht. Eine Quellenangabe in der App schadet trotzdem nicht.
- **Spätere Veröffentlichung:**
  - Ein Hinweis „Daten von Open Food Facts (openfoodfacts.org), ODbL“ muss in die App, z. B. im Info-Screen und bei Produktdetails.
  - Wenn ein lokaler Cache oder Nutzerkorrekturen zu einer öffentlich bereitgestellten abgeleiteten Datenbank werden, muss diese unter ODbL angeboten werden [7][8].
  - Architektonisch heißt das: OFF-Daten und eigene bzw. BLS-Daten in getrennten Tabellen halten (Collective Database [8]). Korrekturen sollten idealerweise an OFF zurückgegeben werden, statt eine eigene Abspaltung zu pflegen.

### 1.5 Offline-Dumps

Laut der offiziellen Datenseite [4]:
- **JSONL** (`openfoodfacts-products.jsonl.gz`), nächtlich aktualisiert
- **CSV** (`en.openfoodfacts.org.products.csv.gz`), ca. 0,9 GB gz bzw. 9 GB entpackt, nächtlich
- **MongoDB-Dump**, nächtlich, mit Prüfsummen. Delta-Exporte gibt es für die letzten 14 Tage.
- **Parquet** auf Hugging Face (gefiltert, Spalten dedupliziert)
- RDF, das laut OFF „not actively maintained“ ist

Für die App selbst sind die Dumps zu groß, um sie vollständig auszuliefern (CSV: 9 GB entpackt [4]). Sie wären aber nützlich, um auf einem eigenen Server oder einmalig ein Teil-Extrakt nur mit deutschen Produkten und Nährwerten zu erzeugen. Das Ergebnis wäre dann eine Derivative Database, mit den Pflichten aus 1.4.

---

## 2. Bundeslebensmittelschlüssel (BLS) 4.0

- **Kosten:** Seit dem 16.12.2025 kostenlos. Die früheren Lizenzgebühren sind entfallen [10][11].
- **Nutzungsbedingungen (MRI-FAQ):** *„Der BLS 4.0 wird kostenfrei und ohne Lizenzbarrieren bereitgestellt. Die Daten können frei genutzt werden – für wissenschaftliche Forschung und Lehre, Ernährungsberatung und -planung, App- und Softwareentwicklung sowie in der Lebensmittelindustrie.“* [9]
- **Zitierweise:** „Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0 – Deutsche Nährstoffdatenbank. Karlsruhe. DOI: 10.25826/Data20251217-134202-0“ [9]
- **Standard-Lizenz offen:** Eine Standardlizenz wie CC BY 4.0 habe ich auf blsdb.de nicht gefunden [9][12]. Die DOI-Landingpage auf OpenAgrar [13] war bei der Recherche nicht erreichbar (HTTP 503), die genaue Lizenzangabe ist deshalb **nicht verifiziert**. Vor einer öffentlichen Veröffentlichung sollte man das nachprüfen.
- **Umfang:** 7.140 Lebensmittel und Gerichte, bis zu 138 Nährstoffe pro Lebensmittel. Neu sind u. a. Pflanzendrinks und Pseudogetreide [10][12].
- **Struktur:**
  - 7-stelliger hierarchischer Schlüssel
  - Werte „pro 100 g essbarem Anteil“
  - Die Mapping-Tabelle 3.02 → 4.0 ist zweisprachig (DE/EN)
  - regelmäßige Aktualisierungen sind geplant [12]
- **Format:** Excel (.xlsx) [9][12]. Die Datenmenge ist klein genug, um sie als SQLite-Tabelle direkt in die App zu bündeln. Das ist eine Schlussfolgerung aus der Anzahl der Einträge, die Dateigröße habe ich nicht gemessen.
- **Eignung:** Der BLS ist die deutsche Referenz für generische und unverpackte Lebensmittel sowie Gerichte. Deutsche Bezeichnungen sind vorhanden [12]. Barcodes enthält er nicht, da er Durchschnittswerte statt Markenprodukte abbildet [10].

## 3. Weitere kostenlose Alternativen und Ergänzungen

| Quelle | Umfang / Sprache | Lizenz / Kosten | Eignung | Beleg |
|---|---|---|---|---|
| **Schweizer Nährwertdatenbank (BLV)** | V 7.1, 1.246 Lebensmittel; DE/FR/IT/EN | kostenlos; *„dürfen unter Quellenangabe auch für kommerzielle (z.B. … Ernährungstagebuch-App) … Zwecke verwendet werden“* | gute deutschsprachige Ergänzung zum BLS | [14] |
| **USDA FoodData Central** | Foundation Foods, SR Legacy (letzter Release April 2018), FNDDS, Branded Foods; englisch | Public Domain / CC0 1.0; Quellenangabe erbeten; API-Key (data.gov) nötig, 1.000 Anfragen/h/IP; Downloads verfügbar | nur Fallback: englische Bezeichnungen. Die Branded-Daten stammen aus einer „public-private partnership“, die Abdeckung des deutschen Markts habe ich nicht geprüft | [5][6] |
| **Ciqual (ANSES, Frankreich)** | – | – | nicht verifiziert: Die Website war per Abruf nicht auswertbar | – |

## 4. Empfehlung

> **Empfehlung**, abgeleitet aus den Belegen oben. Das ist eine Bewertung, kein Fakt.

1. **Barcode-Scan → OFF-API** (`/api/v2` oder `/api/v3/product/{barcode}`):
   - Der User-Agent ist Pflicht [1].
   - Das Ergebnis wird lokal gecacht, sodass ein erneuter Scan keine weitere Anfrage auslöst.
   - Mit 15 Anfragen pro Minute und IP [1] reicht das für zwei Nutzer bequem.
   - Fehlt ein Produkt oder sind die Nährwerte unvollständig, ist ungefähr jedes vierte bis zweite deutsche Produkt betroffen [E1]. Dann gibt der Nutzer die Werte manuell ein (Daten vom Etikett) und speichert sie lokal.
   - Optional können solche Einträge an OFF zurückgegeben werden. Dafür ist ein Account nötig [1].
2. **Generische Lebensmittel → BLS 4.0 offline:**
   - Die Excel-Daten werden einmalig in SQLite überführt und mit der App ausgeliefert [9][12].
   - Die Suche läuft lokal und sofort, ohne API-Limit.
   - Optional kommt die Schweizer Nährwertdatenbank dazu [14].
3. **Produktsuche nach Namen:**
   - Lokal laufen BLS, Favoriten, zuletzt verwendete Einträge und der OFF-Cache.
   - Gegen OFF wird nur auf ausdrückliche Anfrage gesucht (Button bzw. Enter, kein Search-as-you-type [1]), und zwar über Search-a-licious [1][E2].
4. **Favoriten und eigene Einträge** liegen in einer eigenen, von den OFF-Daten getrennten Tabelle. So bleibt die App für eine spätere Veröffentlichung ODbL-sauber (Collective Database [8]).
5. **Quellenangabe von Anfang an einbauen:**
   - OFF mit Link und ODbL-Hinweis [2]
   - BLS-Zitat [9]
   - ggf. BLV [14]
6. **Kosten:** Alle genannten Quellen sind kostenlos [1][5][9][14]. Ein eigener Server ist für diesen Ansatz nicht nötig.

Offene Punkte vor einer öffentlichen Veröffentlichung:
- konkrete BLS-Lizenz auf OpenAgrar prüfen [13]
- Rate-Limits von Search-a-licious klären
- Praxistest der Trefferquote mit eigenen Einkäufen

---

## Eigene Messungen

- **[E1]** API-Abfragen am 2026-10-10 an `https://world.openfoodfacts.org/api/v2/search` mit User-Agent `abnehm-app-research/0.1 (…)`, `page_size=1&fields=code`, Feld `count`:
  - `countries_tags_en=germany` → 430001
  - `countries_tags=en:germany&states_tags=en:nutrition-facts-completed` → 251764
  - `countries_tags_en=germany&states_tags=en:nutrition-facts-to-be-completed` → 178256
  - Einzelne Abfragen lieferten zeitweise HTTP 503.
- **[E2]** Abfrage am 2026-10-10: `https://search.openfoodfacts.org/search?q=skyr%20natur&langs=de&page_size=5&fields=code,product_name,brands,countries_tags` → `count: 5462`, `took: 10`, Top 5 siehe 1.3.

## Quellen

1. Open Food Facts – API-Dokumentation (Einführung): https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/ (ältere URL: https://openfoodfacts.github.io/openfoodfacts-server/api/)
2. Open Food Facts – Terms of use, contribution and re-use: https://world.openfoodfacts.org/terms-of-use
3. Open Food Facts Deutschland, Startseite (Produktanzahl): https://de.openfoodfacts.org/
4. Open Food Facts – Daten / Dumps: https://world.openfoodfacts.org/data
5. USDA FoodData Central – API Guide: https://fdc.nal.usda.gov/api-guide/
6. USDA FoodData Central – Data Type Documentation: https://fdc.nal.usda.gov/data-documentation/
7. Open Data Commons – ODbL 1.0 Summary: https://opendatacommons.org/licenses/odbl/summary/
8. Open Data Commons – ODbL 1.0 Volltext: https://opendatacommons.org/licenses/odbl/1-0/
9. Max Rubner-Institut – BLS-FAQ: https://www.blsdb.de/faq
10. heise online, „Bundeslebensmittelschlüssel 4.0: Nährstoffdatenbank jetzt öffentlich verfügbar“, 23.12.2025: https://heise.de/-11123877
11. LebensmittelPraxis, „Nationale Nährstoffdatenbank Bundeslebensmittelschlüssel wird kostenfrei zugänglich“: https://lebensmittelpraxis.de/handel-aktuell/47047-nationale-naehrstoffdatenbank-bundeslebensmittelschluessel-wird-kostenfrei-zugaenglich.html
12. Max Rubner-Institut – BLS-Startseite und „BLS-Wissen“: https://www.blsdb.de/ und https://www.blsdb.de/bls
13. OpenAgrar – Datensatz BLS 4.0 (DOI 10.25826/Data20251217-134202-0): https://www.openagrar.de/receive/openagrar_mods_00112643 (bei der Recherche nicht erreichbar)
14. BLV – Schweizer Nährwertdatenbank: https://naehrwertdaten.ch/de/
15. Open Food Facts – API-Dokumentation, Tutorials (Search-a-licious, Elasticsearch/Lucene): https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/
16. Open Food Facts – „License: be on the legal side“: https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/tutorials/license-be-on-the-legal-side/
