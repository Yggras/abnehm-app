// Linien-Icon-Satz des Design-Systems „Lagune“: 24er Raster, Strich `icon-stroke`, runde Enden.
// Übernommen aus der Vorschau „Icons“ des Design-System-Artifacts (research/design-system.md,
// Abschnitt „Ikonografie“). Die Kommentare nennen die Bedeutung aus dem Artifact.

export type IconShape =
  | { readonly type: 'path'; readonly d: string }
  | {
      readonly type: 'circle';
      readonly cx: number;
      readonly cy: number;
      readonly r: number;
      /** Spur unter einem Bogen, etwa beim Teilring: in der Farbe der Fortschrittsspur statt im Ton des Icons. */
      readonly track?: true;
    }
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
  /**
   * Teilweise: Teilring auf voller Spur (Tagesziel, Design-System „Bedeutung nie nur über Farbe“). Die
   * Spur unterscheidet ihn von einem Ladekreis.
   */
  ringPartial: [
    { type: 'circle', cx: 12, cy: 12, r: 8.5, track: true },
    { type: 'path', d: 'M12 3.5A8.5 8.5 0 1 1 3.5 12' },
  ],
  /** Offen: gestrichelter Kreis (Tagesziel) */
  circleDashed: [
    {
      type: 'path',
      d: 'M13.11 3.57A8.5 8.5 0 0 1 17.17 5.26M18.74 6.83A8.5 8.5 0 0 1 20.43 10.89M20.43 13.11A8.5 8.5 0 0 1 18.74 17.17M17.17 18.74A8.5 8.5 0 0 1 13.11 20.43M10.89 20.43A8.5 8.5 0 0 1 6.83 18.74M5.26 17.17A8.5 8.5 0 0 1 3.57 13.11M3.57 10.89A8.5 8.5 0 0 1 5.26 6.83M6.83 5.26A8.5 8.5 0 0 1 10.89 3.57',
    },
  ],
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
  /** Anzeigen */
  eye: [
    { type: 'path', d: 'M3.5 12s3-5.5 8.5-5.5S20.5 12 20.5 12s-3 5.5-8.5 5.5S3.5 12 3.5 12z' },
    { type: 'circle', cx: 12, cy: 12, r: 2.5 },
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
  /** Benachrichtigungen */
  bell: [
    { type: 'path', d: 'M6.5 16.5v-5a5.5 5.5 0 0 1 11 0v5l1.5 1.5H5z' },
    { type: 'path', d: 'M10 20.5a2.2 2.2 0 0 0 4 0' },
  ],
  /** Konto */
  person: [
    { type: 'circle', cx: 12, cy: 8.5, r: 3.5 },
    { type: 'path', d: 'M5 19.5c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6' },
  ],
  /** Mehr */
  more: [
    { type: 'circle', cx: 6, cy: 12, r: 1.1 },
    { type: 'circle', cx: 12, cy: 12, r: 1.1 },
    { type: 'circle', cx: 18, cy: 12, r: 1.1 },
  ],

  // Aktivitätsarten des Sports (#38, Spezifikation 3, Abschnitt 3), ergänzt für #173: Das Artifact zeigt
  // nur das Hantel-Icon `sport`. Eigene Zeichnungen im selben Raster, Strich und Stil; Krafttraining nutzt
  // `sport`, Sonstiges `pulse`.
  /** Gehen */
  walk: [
    { type: 'circle', cx: 13, cy: 4.5, r: 1.8 },
    { type: 'path', d: 'M12.5 8.5l-1.5 6 3 3v4M11 14.5l-3 6.5M12.5 8.5l3 3.5 2.5.5M12.5 8.5L9.5 10.5 8.5 13.5' },
  ],
  /** Laufen */
  run: [
    { type: 'circle', cx: 15.5, cy: 4.5, r: 1.8 },
    { type: 'path', d: 'M14.5 8.5l-3 5 4 2.5-1 5.5M11.5 13.5L6.5 15M14.5 8.5l3 3h3M14.5 8.5l-4 .5-2.5 3' },
  ],
  /** Radfahren */
  bike: [
    { type: 'circle', cx: 6, cy: 16, r: 3.5 },
    { type: 'circle', cx: 18, cy: 16, r: 3.5 },
    { type: 'path', d: 'M6 16l3.5-6.5h6L18 16M9.5 9.5L12.5 16h-6.5M15.5 9.5l-1-3h2.5' },
  ],
  /** Schwimmen */
  swim: [
    { type: 'circle', cx: 17, cy: 7, r: 1.8 },
    { type: 'path', d: 'M3.5 16.5c1.4 1 2.8 1 4.2 0s2.8-1 4.2 0 2.8 1 4.2 0 2.8-1 4.2 0M3.5 20c1.4 1 2.8 1 4.2 0s2.8-1 4.2 0 2.8 1 4.2 0 2.8-1 4.2 0M6.5 13l4-4 3 2.5 3.5-2' },
  ],
  /** Yoga und Dehnen */
  yoga: [
    { type: 'circle', cx: 12, cy: 4.5, r: 1.8 },
    { type: 'path', d: 'M12 8.5v5.5M4.5 10.5l7.5-2 7.5 2M12 14l-5 5h10l-5-5' },
  ],
  /** Mannschaftssport */
  ball: [
    { type: 'circle', cx: 12, cy: 12, r: 8.5 },
    { type: 'path', d: 'M12 8l3.8 2.8-1.5 4.4H9.7l-1.5-4.4zM12 3.5V8M15.8 10.8l3.9-1.3M14.3 15.2l2.4 3.4M9.7 15.2l-2.4 3.4M8.2 10.8L4.3 9.5' },
  ],
} as const satisfies Record<string, readonly IconShape[]>;

export type IconName = keyof typeof iconShapes;

/** Energie-Symbol: die einzige gefüllte Form, Füllung `energy` mit Kontur `energy-edge`. */
export const energyPath = 'M12 2.5c.7 4.6 3.4 7.3 8 8-4.6.7-7.3 3.4-8 8-.7-4.6-3.4-7.3-8-8 4.6-.7 7.3-3.4 8-8z';
