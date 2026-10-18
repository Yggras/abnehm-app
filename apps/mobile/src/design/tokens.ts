// Design-Tokens „Lagune“ aus research/design-system.md (#65), übernommen aus `code/tokens.ts`
// des Design-System-Artifacts. Längen in dp/pt als Zahl, Farben als Hex. `tokens.test.ts` prüft
// die Vollständigkeit gegen das Design-System. Dies ist die einzige Datei der App mit rohen
// Farbwerten; Lint verbietet sie überall sonst.

const palette = {
  primary: '#0B7470',
  self: '#0E8580',
  primarySoft: '#DDF0EE',
  ink: '#1D3332',
  inkMuted: '#55625E',
  line: '#EAD9BC',
  neutral: '#66625A',
  momoCheek: '#F48C73',
} as const;

export const color = {
  // Flächen und Linien
  surfaceBase: '#FBF4E6',
  surfaceCard: '#FFFCF6',
  surfaceSunken: '#F4EBDA',
  surfaceOverlay: '#1D333266',
  surfaceInverse: '#1D3332',
  onInverse: '#FFFCF6',
  line: palette.line,
  lineStrong: '#8F7B59',
  plinth: '#E4D2B0',
  focus: palette.primary,
  // Text und Aktion
  ink: palette.ink,
  inkMuted: palette.inkMuted,
  inkDisabled: '#A2998A',
  onPrimary: '#FFFFFF',
  primary: palette.primary,
  primaryPressed: '#085B58',
  primarySoft: palette.primarySoft,
  primarySoftPressed: '#C6E6E2',
  fillDisabled: '#EDE4D3',
  // Personen und Spiel
  self: palette.self,
  partner: '#C9662B',
  partnerSoft: '#F9E4D5',
  energy: '#F2B33D',
  energyEdge: '#8C5A00',
  // Zustände
  success: '#256F3F',
  successSoft: '#DDF0E0',
  hint: '#8C5A00',
  hintSoft: '#FDEBC2',
  neutral: palette.neutral,
  neutralSoft: '#EFE7D6',
  problem: '#A1401F',
  problemSoft: '#FBE3D9',
  // Daten
  trackerCalories: palette.self,
  trackerWater: palette.self,
  trackerSport: palette.self,
  chartDay: palette.inkMuted,
  chartTrend: palette.self,
  chartGoal: palette.neutral,
  chartGrid: palette.line,
  // Momo (nur Skia)
  momoBody: '#FFC56E',
  momoBelly: '#FFEBC4',
  momoCheek: palette.momoCheek,
  momoFrond: palette.momoCheek,
  momoStage: palette.primarySoft,
  // Insel (nur Skia)
  islandGrass: '#8BCB5E',
  islandGrassSpring: '#9FD774',
  islandGrassAutumn: '#B9C46A',
  islandGrassWinter: '#EEF4F7',
  islandFoliage: '#5FA44A',
  islandFoliageAutumn: '#E8913A',
  islandWater: '#3FB7D0',
  islandWaterDeep: '#2A93B3',
  islandSand: '#F3D9A4',
  islandEarth: '#B07A48',
  islandWood: '#A86B3C',
  islandStone: '#CFC6B4',
  islandRoof: '#D2693A',
  islandRoofAlt: '#2E8C87',
  islandNight: '#1E3557',
  islandLamp: '#FFD36A',
  islandBuildable: '#FFF3B0',
} as const;

export type ColorToken = keyof typeof color;

/**
 * Exportnamen von `@expo-google-fonts/rubik`, unter denen `useDesignFonts` die Schnitte lädt.
 * Jeder Textstil setzt seine eigene Familie statt `fontWeight`, weil Android den Schnitt über die
 * Familie wählt.
 */
export const fontFamily = {
  regular: 'Rubik_400Regular',
  medium: 'Rubik_500Medium',
  semibold: 'Rubik_600SemiBold',
  bold: 'Rubik_700Bold',
} as const;

export const type = {
  display: { fontFamily: fontFamily.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.3 },
  title: { fontFamily: fontFamily.semibold, fontSize: 20, lineHeight: 26 },
  headline: { fontFamily: fontFamily.semibold, fontSize: 17, lineHeight: 22 },
  body: { fontFamily: fontFamily.regular, fontSize: 16, lineHeight: 22 },
  bodyStrong: { fontFamily: fontFamily.semibold, fontSize: 16, lineHeight: 22 },
  button: { fontFamily: fontFamily.semibold, fontSize: 16, lineHeight: 20 },
  label: { fontFamily: fontFamily.medium, fontSize: 14, lineHeight: 18 },
  caption: { fontFamily: fontFamily.medium, fontSize: 12, lineHeight: 16 },
  tabLabel: { fontFamily: fontFamily.semibold, fontSize: 12, lineHeight: 14 },
  numberXl: {
    fontFamily: fontFamily.semibold,
    fontSize: 40,
    lineHeight: 44,
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  numberM: { fontFamily: fontFamily.semibold, fontSize: 20, lineHeight: 24, fontVariant: ['tabular-nums'] },
} as const;

export type TypeToken = keyof typeof type;

/**
 * Schriftskalierung. Texte wachsen mit der Systemschrift bis Faktor 2,0 (Spezifikation 0,
 * Abschnitt 7). Ab `breakpoint` stapeln sich Momo-Bereich, Mini-Tracker und
 * Partner-Zusammenfassungen; einzelne Stile sind enger begrenzt (Annahme 8 des Design-Systems).
 */
export const textScale = {
  max: 2,
  breakpoint: 1.3,
  limit: { display: 1.6, numberXl: 1.4, tabLabel: 1.3 } satisfies Partial<Record<TypeToken, number>>,
} as const;

export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
} as const;

export const radius = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 24,
  xl: 28,
  pill: 999,
} as const;

/**
 * Eine Schattenebene in der Richtung des Design-Systems (Web-Syntax): positives `offsetY` liegt
 * unten. In React-Native-Styles übersetzt sie ausschließlich `boxShadow` aus `elevation.ts`.
 */
export type ShadowLayer = {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly blur: number;
  readonly spread: number;
  readonly color: string;
};

const edge = (offsetY: number, edgeColor: string): ShadowLayer => ({
  offsetX: 0,
  offsetY,
  blur: 0,
  spread: 0,
  color: edgeColor,
});

/** Deckkraft als zweistelliger Hex-Anhang (`40` = 25 %), wie in den Schatten des Design-Systems. */
const withAlpha = (hex: string, alpha: string) => `${hex}${alpha}`;

export const elevation = {
  card: [edge(4, color.plinth)],
  cardPressed: [edge(1, color.plinth)],
  button: [edge(4, color.primaryPressed)],
  buttonPressed: [edge(1, color.primaryPressed)],
  buttonSoft: [edge(3, color.primarySoftPressed)],
  buttonSoftPressed: [edge(1, color.primarySoftPressed)],
  floating: [
    edge(4, color.primaryPressed),
    { offsetX: 0, offsetY: 10, blur: 20, spread: -6, color: withAlpha(color.ink, '40') },
  ],
  sheet: [edge(-1, color.line), { offsetX: 0, offsetY: -10, blur: 30, spread: -10, color: withAlpha(color.ink, '33') }],
  toast: [edge(4, '#0E1F1E'), { offsetX: 0, offsetY: 12, blur: 24, spread: -10, color: withAlpha(color.ink, '59') }],
  focusRing: [
    { offsetX: 0, offsetY: 0, blur: 0, spread: 2, color: color.surfaceCard },
    { offsetX: 0, offsetY: 0, blur: 0, spread: 5, color: color.primary },
  ],
} as const satisfies Record<string, readonly ShadowLayer[]>;

export type ElevationToken = keyof typeof elevation;

export const size = {
  touchMin: 48,
  buttonHeight: 52,
  buttonHeightCompact: 44,
  chipHeight: 36,
  fieldHeight: 52,
  rowMin: 52,
  iconSm: 16,
  iconMd: 20,
  iconLg: 24,
  iconStroke: 2,
  avatar: 44,
  plusButton: 56,
  ringSize: 136,
  ringStroke: 14,
  levelbarHeight: 14,
  barHeight: 6,
  plinthDepth: 4,
  pressDepth: 3,
  momoToday: 104,
  islandTile: 64,
} as const;

export const opacity = {
  shadeLeft: 0.12,
  shadeRight: 0.24,
  castShadow: 0.16,
  cheek: 0.55,
  evening: 0.45,
  fog: 0.85,
} as const;

/** Bewegungswerte (Designwerte ohne Beleg, Annahme 6). Welche gilt, entscheidet `motion.ts`. */
export const motion = {
  duration: {
    instant: 90,
    fast: 150,
    base: 240,
    slow: 400,
    celebrate: 1200,
  },
  /** Kontrollpunkte für `Easing.bezier(x1, y1, x2, y2)`. */
  easing: {
    standard: [0.2, 0, 0, 1],
    enter: [0, 0, 0, 1],
    exit: [0.3, 0, 1, 1],
  },
  /** Konfigurationen für `withSpring`. */
  spring: {
    bouncy: { damping: 11, stiffness: 180, mass: 1 },
    firm: { damping: 20, stiffness: 260, mass: 1 },
  },
} as const;
