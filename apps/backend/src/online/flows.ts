// Arten der Online-Abläufe mit clientseitiger `requestId` (Spezifikation 0, Abschnitt 9). Der CHECK der
// Tabelle `online_request` verwendet dieselbe Liste; ein weiterer Ablauf ergänzt sie.
export const onlineFlows = ['einladung_erzeugen', 'einladung_annehmen', 'abmelden'] as const;
export type OnlineFlow = (typeof onlineFlows)[number];
