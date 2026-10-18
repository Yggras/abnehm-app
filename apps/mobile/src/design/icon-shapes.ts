// Linien-Icon-Satz des Design-Systems „Lagune“: 24er Raster, Strich `icon-stroke`, runde Enden.
// Übernommen aus der Vorschau „Icons“ des Design-System-Artifacts (research/design-system.md,
// Abschnitt „Ikonografie“). Die Kommentare nennen die Bedeutung aus dem Artifact.

export type IconShape =
  | { readonly type: 'path'; readonly d: string }
  | { readonly type: 'circle'; readonly cx: number; readonly cy: number; readonly r: number }
  | {
      readonly type: 'rect';
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly rx: number;
    };

export const iconShapes = {
  /** Heute */
  sun: [
    { type: 'circle', cx: 12, cy: 12, r: 4 },
    {
      type: 'path',
      d: 'M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7',
    },
  ],
  /** Protokoll */
  book: [
    { type: 'path', d: 'M5 4.5h10.5a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3z' },
    { type: 'path', d: 'M5 16.5a3 3 0 0 1 3-3h10.5M9 8.5h6' },
  ],
  /** Erfassen */
  plus: [{ type: 'path', d: 'M12 5v14M5 12h14' }],
  /** Momo · Insel */
  island: [
    { type: 'path', d: 'M3 18.5c1.5-.9 3-.9 4.5 0s3 .9 4.5 0 3-.9 4.5 0 3 .9 4.5 0' },
    { type: 'path', d: 'M5.5 15c1.6-2.6 3.9-3.9 6.5-3.9s4.9 1.3 6.5 3.9M12 11V5.5M12 5.5c-1.6-1.4-3.6-1.5-5-.6M12 5.5c1.6-1.4 3.6-1.5 5-.6' },
  ],
  /** Wir */
  people: [
    { type: 'circle', cx: 9, cy: 8.5, r: 3 },
    { type: 'circle', cx: 16.2, cy: 9.5, r: 2.5 },
    { type: 'path', d: 'M3.8 19c.6-3.1 2.6-4.8 5.2-4.8s4.6 1.7 5.2 4.8M14.6 14.4c2.6-.3 4.8 1.2 5.6 4.6' },
  ],
  /** Einstellungen */
  gear: [
    { type: 'circle', cx: 12, cy: 12, r: 3.2 },
    {
      type: 'path',
      d: 'M19.4 13.4l1.7 1.3-1.9 3.3-2-.8a7.4 7.4 0 0 1-1.8 1l-.3 2.1h-3.8l-.3-2.1a7.4 7.4 0 0 1-1.8-1l-2 .8-1.9-3.3 1.7-1.3a7.6 7.6 0 0 1 0-2.1l-1.7-1.3 1.9-3.3 2 .8a7.4 7.4 0 0 1 1.8-1l.3-2.1h3.8l.3 2.1a7.4 7.4 0 0 1 1.8 1l2-.8 1.9 3.3-1.7 1.3a7.6 7.6 0 0 1 0 2.1z',
    },
  ],
  /** Ernährung */
  plate: [
    { type: 'circle', cx: 12, cy: 12, r: 8.2 },
    { type: 'circle', cx: 12, cy: 12, r: 4.4 },
  ],
  /** Wasser */
  drop: [{ type: 'path', d: 'M12 3.5c-3.2 4.2-5.6 7.3-5.6 10.3a5.6 5.6 0 0 0 11.2 0c0-3-2.4-6.1-5.6-10.3z' }],
  /** Sport */
  sport: [{ type: 'path', d: 'M6.5 7.5v9M3.8 10v4M17.5 7.5v9M20.2 10v4M6.5 12h11' }],
  /** Gewicht */
  scale: [
    { type: 'rect', x: 3.5, y: 4.5, width: 17, height: 15, rx: 4 },
    { type: 'path', d: 'M8.3 10.2a4.6 4.6 0 0 1 7.4 0M12 10l1.4-1.9' },
  ],
  /** Erfüllt */
  check: [{ type: 'path', d: 'M5.5 12.5l4.2 4.2 8.8-9.2' }],
  /** Anfeuern */
  heart: [{ type: 'path', d: 'M12 19.5s-7.2-4.4-7.2-9.6A4 4 0 0 1 12 7.6a4 4 0 0 1 7.2 2.3c0 5.2-7.2 9.6-7.2 9.6z' }],
  /** Bauen */
  hammer: [
    { type: 'path', d: 'M4.5 19.5l8.5-8.5' },
    { type: 'path', d: 'M10.5 6.5l3.5-3.5 6.5 6.5-3.5 3.5z' },
  ],
  /** Lager */
  box: [
    { type: 'path', d: 'M4 8.5l8-4 8 4v7l-8 4-8-4z' },
    { type: 'path', d: 'M4 8.5l8 4 8-4M12 12.5v7' },
  ],
  /** Projekt */
  flag: [
    { type: 'path', d: 'M6 21V4' },
    { type: 'path', d: 'M6 4.5h11l-2.5 4 2.5 4H6' },
  ],
  /** Ereignisse */
  star: [{ type: 'path', d: 'M12 3.5l2.3 5.2 5.7.6-4.3 3.8 1.3 5.6L12 15.8l-5 2.9 1.3-5.6L4 9.3l5.7-.6z' }],
  /** Bereiche */
  layers: [
    { type: 'path', d: 'M12 4l8.5 4.5L12 13 3.5 8.5z' },
    { type: 'path', d: 'M3.5 12.5L12 17l8.5-4.5' },
  ],
  /** Jahreszeit */
  leaf: [
    { type: 'path', d: 'M5 19c0-8 5-13 14-14 0 9-5 14-13 14z' },
    { type: 'path', d: 'M5 19l7-7' },
  ],
  /** Tagesende */
  moon: [{ type: 'path', d: 'M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z' }],
  /** Wiegetag */
  calendar: [
    { type: 'rect', x: 4, y: 5.5, width: 16, height: 14, rx: 3 },
    { type: 'path', d: 'M4 10h16M8.5 3.5v4M15.5 3.5v4' },
  ],
  /** Foto */
  camera: [
    { type: 'rect', x: 3.5, y: 7, width: 17, height: 12.5, rx: 3 },
    { type: 'path', d: 'M8.5 7l1.5-2.5h4L15.5 7' },
    { type: 'circle', cx: 12, cy: 13.2, r: 3.4 },
  ],
  /** Barcode */
  barcode: [{ type: 'path', d: 'M4 7V5h3M17 5h3v2M20 17v2h-3M7 19H4v-2M8 9v6M11 9v6M14 9v6M16.5 9v6' }],
  /** Suche */
  search: [
    { type: 'circle', cx: 11, cy: 11, r: 6.5 },
    { type: 'path', d: 'M16 16l4 4' },
  ],
  /** Health-Import */
  pulse: [{ type: 'path', d: 'M3.5 12h3.5l2-4.5 3.5 9 2-4.5h6' }],
  /** Bearbeiten */
  pencil: [
    { type: 'path', d: 'M4.5 19.5l1-4L15.5 5.5l3 3-10 10z' },
    { type: 'path', d: 'M13.5 7.5l3 3' },
  ],
  /** Ausblenden */
  eyeOff: [
    { type: 'path', d: 'M3.5 12s3-5.5 8.5-5.5S20.5 12 20.5 12s-3 5.5-8.5 5.5S3.5 12 3.5 12z' },
    { type: 'circle', cx: 12, cy: 12, r: 2.5 },
    { type: 'path', d: 'M4.5 4.5l15 15' },
  ],
  /** Rückgängig */
  undo: [
    { type: 'path', d: 'M9 7.5L5 11.5l4 4' },
    { type: 'path', d: 'M5.5 11.5h9a4.5 4.5 0 0 1 0 9H12' },
  ],
  /** Weiter */
  chevron: [{ type: 'path', d: 'M9.5 6.5l5.5 5.5-5.5 5.5' }],
  /** Zurück */
  back: [{ type: 'path', d: 'M14.5 6.5L9 12l5.5 5.5' }],
  /** Schließen */
  close: [{ type: 'path', d: 'M6.5 6.5l11 11M17.5 6.5l-11 11' }],
  /** Info */
  info: [
    { type: 'circle', cx: 12, cy: 12, r: 8.5 },
    { type: 'path', d: 'M12 11v5.5M12 7.8v.4' },
  ],
  /** Problem */
  alert: [
    { type: 'circle', cx: 12, cy: 12, r: 8.5 },
    { type: 'path', d: 'M12 7.5v5.5M12 16.2v.3' },
  ],
  /** Offline */
  offline: [
    { type: 'path', d: 'M7 18h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 18z' },
    { type: 'path', d: 'M4 4l16 16' },
  ],
  /** Partner einladen */
  invite: [
    { type: 'circle', cx: 10, cy: 8.5, r: 3.2 },
    { type: 'path', d: 'M4 19c.7-3.2 3-5 6-5s5.3 1.8 6 5M18.5 8v6M15.5 11h6' },
  ],
  /** Teilen */
  share: [
    { type: 'path', d: 'M12 15V4M8 7.5L12 3.5l4 4' },
    { type: 'path', d: 'M6.5 11H5.5v8.5h13V11h-1' },
  ],
  /** Gesperrt */
  lock: [
    { type: 'rect', x: 5.5, y: 10.5, width: 13, height: 9.5, rx: 2.5 },
    { type: 'path', d: 'M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5' },
  ],
  /** Mehr */
  more: [
    { type: 'circle', cx: 6, cy: 12, r: 1.1 },
    { type: 'circle', cx: 12, cy: 12, r: 1.1 },
    { type: 'circle', cx: 18, cy: 12, r: 1.1 },
  ],
} as const satisfies Record<string, readonly IconShape[]>;

export type IconName = keyof typeof iconShapes;

/** Energie-Symbol: die einzige gefüllte Form, Füllung `energy` mit Kontur `energy-edge`. */
export const energyPath = 'M12 2.5c.7 4.6 3.4 7.3 8 8-4.6.7-7.3 3.4-8 8-.7-4.6-3.4-7.3-8-8 4.6-.7 7.3-3.4 8-8z';
