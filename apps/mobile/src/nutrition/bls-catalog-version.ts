/**
 * Version des mitgelieferten BLS-Katalogs `assets/catalog/bls-katalog.db`: BLS-Ausgabe und Stand des
 * Assets. Jedes neu gebaute Asset bekommt einen neuen Stand, etwa nach einer geänderten
 * Normalisierung; nur dann ersetzt die App die installierte Datei (#154). Das Build-Skript schreibt
 * sie in die Tabelle `catalog_info`; ein Test prüft, dass Asset und Konstante übereinstimmen.
 *
 * Die Datei hat keine Importe, weil das Build-Skript (`scripts/bls-catalog/`) sie unter Node lädt.
 */
export const blsCatalogVersion = 'bls-4.0+1';
