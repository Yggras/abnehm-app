// Standzeit einer Meldung nach dem Design-System (research/design-system.md › Komponenten, „Meldung“:
// Annahme 7, 5 s, mit Screenreader länger). Die 10 s mit Screenreader sind ein Designwert ohne Beleg.
// Eigenes Modul, weil auch der Spieldienst sie kennt: Beim Levelaufstieg feiert Momo, solange die Meldung
// steht (#200).
export const messageStandingTime = { default: 5_000, screenReader: 10_000 } as const;
