# Open Food Facts: Produkt-API für den Barcode-Scan

Recherche für [#160](https://github.com/Yggras/abnehm-app/issues/160) („Ernährung · Barcode-Scan mit Open-Food-Facts-Cache“). Laut Ticket legt die Umsetzung die genauen Feldnamen anhand der OFF-Datenstruktur fest und belegt sie. [Spezifikation 2](https://github.com/Yggras/abnehm-app/issues/81), Abschnitt 3, nennt die Feldnamen für Eiweiß, Fett und Portionen „hier nicht belegt“.

Stand: 23.11.2026. Quellen sind die Dokumentation von Open Food Facts und eigene Leseabfragen gegen `world.openfoodfacts.org`. Die Abfragen liefen mit einem generischen User-Agent ohne persönliche Daten.

## Ergebnis

| Frage | Antwort | Beleg |
| --- | --- | --- |
| API-Version | v3 ist „Current — recommended for all new integrations“, v2 „Deprecated — still supported for backward compatibility“. | [API-Übersicht](https://openfoodfacts.github.io/openfoodfacts-server/api/) |
| Endpunkt | `GET /api/v3/product/{barcode}` | [API-Übersicht](https://openfoodfacts.github.io/openfoodfacts-server/api/) (Beispiel mit `/api/v3.6/product/…`), Abfragen unten |
| Felder begrenzen | Parameter `fields`, kommagetrennt | [Cheatsheet](https://openfoodfacts.github.io/openfoodfacts-server/api/ref-cheatsheet/): „Use the `fields` parameter to get only specific product data“ |
| Pflicht-User-Agent | „The User-Agent should be in the form of `AppName/Version (ContactEmail)`“ | [API-Übersicht](https://openfoodfacts.github.io/openfoodfacts-server/api/) |
| Leselimit | „15 req/min/IP address for all read product queries“; bei Anfragen direkt aus einer App „the rate limits apply per user“ | [API-Übersicht](https://openfoodfacts.github.io/openfoodfacts-server/api/) |
| Nährwerte | unter `product.nutriments`: `energy-kcal_100g`, `proteins_100g`, `carbohydrates_100g`, `fat_100g`, als Zahlen | [data-fields.txt](https://world.openfoodfacts.org/data/data-fields.txt), Abfragen unten |
| Einheit der `_100g`-Werte | „fields that end with _100g correspond to the amount of a nutriment (in g, or kJ for energy) for 100 g or 100 ml of product“; Energie in kcal steht in `energy-kcal_100g` | [data-fields.txt](https://world.openfoodfacts.org/data/data-fields.txt) |
| g oder ml | `product_quantity_unit` ist `g` bzw. `ml`, `quantity` der Text der Packungsmenge („330 ml“) | Abfragen unten; in der Doku nicht beschrieben |
| Portion | `serving_quantity` (Zahl) mit `serving_quantity_unit` (`g` bzw. `ml`). Die Doku beschreibt `serving_quantity` als „Computed value in g“. | [Nutrition data](https://openfoodfacts.github.io/openfoodfacts-server/dev/explain-nutrition-data/), Abfragen unten |
| Name | `product_name`, dazu der deutsche Name `product_name_de` | [data-fields.txt](https://world.openfoodfacts.org/data/data-fields.txt) (`product_name`); `product_name_de` nur in den Abfragen |
| Marke | `brands` (Text, kommagetrennt) | [data-fields.txt](https://world.openfoodfacts.org/data/data-fields.txt), Abfragen unten |
| Gefunden | HTTP 200, `"status": "success"`, `"result": { "id": "product_found" }`, Daten in `product` | Abfragen unten |
| Nicht gefunden | HTTP 404, `"status": "failure"`, `"result": { "id": "product_not_found" }` | Abfragen unten; in der Doku nicht beschrieben |
| Überlastung | „exceeding the global limits returns HTTP 503“ | [API-Übersicht](https://openfoodfacts.github.io/openfoodfacts-server/api/) |
| Lizenz | Datenbank unter der Open Database License (ODbL) | [API-Übersicht](https://openfoodfacts.github.io/openfoodfacts-server/api/), [Nutzungsbedingungen](https://world.openfoodfacts.org/terms-of-use) |

## Abfragen vom 23.11.2026

Feldliste der App: `product_name,product_name_de,brands,quantity,product_quantity_unit,serving_quantity,serving_quantity_unit,nutriments`.

- **Nutella** (`3017620422003`): HTTP 200. Die Antwort enthielt `product_name` „Nutella“, `brands` „Ferrero, Nutella“, `quantity` „400 g e“ und `product_quantity_unit` „g“, dazu `serving_quantity_unit` „g“, aber kein `serving_quantity`. Nährwerte: `energy-kcal_100g` 539, `proteins_100g` 6.3, `carbohydrates_100g` 57.5, `fat_100g` 30.9.
- **Coca-Cola** (`5449000000996`): HTTP 200. Die Antwort enthielt `product_name_de` „Coca-Cola“, `quantity` „330 ml“, `product_quantity_unit` „ml“, `serving_quantity` 330 und `serving_quantity_unit` „ml“. Auch hier steht `nutrition_data_per` auf „100g“. Für Getränke gelten die `_100g`-Werte also je 100 ml, wie `data-fields.txt` es beschreibt.
- **Unbekannter Barcode** (`4000000000037`): HTTP 404 mit `{"status":"failure","result":{"id":"product_not_found",…}}`. In v2 kam dieselbe Abfrage ebenfalls mit HTTP 404, dort mit `{"status":0,"status_verbose":"product not found"}`.
- **Auffälligkeit:** Fehlt `quantity` in der Feldliste, liefert OFF neben `nutriments` kein `product_quantity_unit`. Das galt für v2 und v3. Mit `quantity` kam das Feld in jeder Wiederholung. Die App fragt deshalb `quantity` mit ab. Als Rückfall nutzt sie die Einheit aus dem Text von `quantity` und danach `serving_quantity_unit`.

Die Gründe für dieses Verhalten sind nicht belegt. Belegt ist nur das beobachtete Ergebnis der Abfragen.

## Nicht belegt

- Ob Open Food Facts einen 12-stelligen UPC-A-Code genauso findet wie die 13-stellige Form mit führender Null. Die App fragt den Code so ab, wie die Kamera ihn liefert.
- Ob React Native den Header `User-Agent` auf iOS und Android unverändert sendet. Geprüft wird das im Gerätelauf.
