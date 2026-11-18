// Partnerbereich (Spezifikation 5): „Wir“ und die Partner-Karte auf „Heute“ (#121). Bildschirme und
// Komponenten (TSX) importieren Routen und Shell direkt, etwa `WirScreen` oder `PartnerAvatar`; die
// Node-Tests des Backends laden diesen Index über die App-Sitzung und kennen kein JSX.
export { appPartner } from './app-partner';
export { createPartner, type Partner, type PartnerDependencies } from './partner';
export { dataAgeOf } from './partner-view';
export { partnerHeadline, partnerTexts, standText } from './texts';
