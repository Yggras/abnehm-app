import type { ChallengeTemplate, Deko } from '../src/catalog.ts';

// Gemeinsame Challenges (Spezifikation 4, Abschnitte 4 und 10; #19, #210): die vier Vorlagen des
// V1-Katalogs und je Vorlage eine Challenge-Deko. Namen und Maße stammen aus #19. Die Erklärungen, die
// anteilige Regel für nicht tägliche Pläne und die Deko-Motive sind Designwerte aus #210 (nicht belegt);
// die Motive lehnen sich an die Beispiele in #19 an („Team-Fahne, Picknicktisch, Brunnen oder
// Wegweiser/Sportplatz-Deko“). Die Grafiken der Deko zeichnet die App mit #211; bis dahin erscheint die
// Deko als neutraler Block.

const deko = (key: string, name: string): Deko => ({ key, name, origin: 'challenge', art: key });

export const challengeDeko: readonly Deko[] = [
  deko('teamfahne', 'Team-Fahne'),
  deko('picknicktisch', 'Picknicktisch'),
  deko('trinkbrunnen', 'Trinkbrunnen'),
  deko('sportplatz', 'Sportplatz'),
];

/** Ein Baustein zählt mit `ceil(6/7 × geplante Tage)`, bei sieben geplanten Tagen also 6. */
const sixOfSeven = { numerator: 6, denominator: 7 } as const;

export const challengeTemplates: readonly ChallengeTemplate[] = [
  {
    key: 'gemeinsam_dranbleiben',
    name: 'Gemeinsam dranbleiben',
    description: 'Jedes erfüllte Tagesziel zählt, egal welches.',
    measure: { type: 'tagesziele', required: 17 },
    deko: 'teamfahne',
  },
  {
    key: 'ernaehrung_im_blick',
    name: 'Ernährung im Blick',
    description: 'Es zählen eure Tagesziele „Ernährung erfasst“.',
    measure: { type: 'baustein', baustein: 'ernaehrung_erfasst', ...sixOfSeven },
    deko: 'picknicktisch',
  },
  {
    key: 'gut_getrunken',
    name: 'Gut getrunken',
    description: 'Es zählen eure Tagesziele „Wasserziel“.',
    measure: { type: 'baustein', baustein: 'wasserziel', ...sixOfSeven },
    deko: 'trinkbrunnen',
  },
  {
    key: 'aktive_woche',
    name: 'Aktive Woche',
    description: 'Es zählen eure geplanten Sporteinheiten; 80 % davon reichen.',
    measure: { type: 'baustein', baustein: 'sporteinheit', numerator: 4, denominator: 5 },
    deko: 'sportplatz',
  },
];
