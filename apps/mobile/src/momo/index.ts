// Momo-Rig (Spezifikation 4, Abschnitt 6). Außerhalb der Insel ist `MomoFigure` die einzige
// Schnittstelle; der Insel-Canvas zeichnet Momo mit `MomoRig` zwischen seinen Objekten. Die Namen der
// Formen und Stimmungen nutzen auch Momo-Sheet und Galerie.
export { MomoAppearanceProvider, MomoFigure } from './MomoFigure';
export { MomoRig } from './MomoRig';
export { momoVisual, type MomoVisual } from './visual';
export { formNames, moodNames } from './texts';
