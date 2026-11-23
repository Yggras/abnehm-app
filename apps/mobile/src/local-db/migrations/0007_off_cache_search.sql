-- Lokaler Suchindex der gescannten Produkte (Spezifikation 2, Abschnitt 4; #160): FTS5 über die
-- normalisierten Namen der vollständigen Einträge im Open-Food-Facts-Cache, dieselbe Normalisierung wie
-- bei BLS-Katalog und eigenen Lebensmitteln (`nutrition/search-text.ts`). Den Index pflegt das Modul
-- „Ernährung“ aus `off_cache`; er ist nur lokal, nicht synchronisiert und kein Teil des Datenmodells
-- beider Schemas (https://www.sqlite.org/fts5.html).
CREATE VIRTUAL TABLE `off_cache_search` USING fts5(`barcode` UNINDEXED, `search_name`, `search_alt`);
