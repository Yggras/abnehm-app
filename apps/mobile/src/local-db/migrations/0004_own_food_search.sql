-- Lokaler Suchindex der eigenen Lebensmittel (Spezifikation 2, Abschnitt 4; #157): FTS5 über die
-- normalisierten Suchnamen, dieselbe Normalisierung wie im BLS-Katalog. Die Namen berechnet die App
-- (`nutrition/search-text.ts`), weil SQLite Umlaute und ß nicht so falten kann. Den Index pflegt das
-- Modul „Ernährung“ aus `own_food`; er ist nur lokal, nicht synchronisiert und kein Teil des
-- Datenmodells beider Schemas (https://www.sqlite.org/fts5.html).
CREATE VIRTUAL TABLE `own_food_search` USING fts5(`own_food_id` UNINDEXED, `search_name`, `search_alt`);
