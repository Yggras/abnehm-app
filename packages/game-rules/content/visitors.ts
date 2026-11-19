import type { Blueprint, Deko, VisitorTemplate } from '../src/catalog.ts';
import { stageArt } from './define.ts';

// Besucher mit Wunsch (Spezifikation 4, Abschnitte 4 und 9): acht Besuchervorlagen mit Tier, Art des
// Wunsches und Belohnungspool, dazu je Rolle drei Besucher-Baupläne und acht Stücke Besucher-Deko. Motive,
// Namen, Preislevel und Pools sind Designwerte aus #202, nicht belegt; die Tiere stammen aus dem Prototyp
// von #28 (prototypes/momos-insel/app.js). Die Grafiken zeichnet die App (`apps/mobile/src/island/art.ts`).

const visitorBlueprint = (key: string, name: string, role: Blueprint['role'], priceLevel: number): Blueprint => ({
  key, name, role, origin: 'besucher', priceLevel, art: stageArt(key),
});

/** Preise nach der Preisformel: Preislevel 2 → 4, 3 → 5, 5 → 6 Energie. */
export const visitorBlueprints: readonly Blueprint[] = [
  visitorBlueprint('brunnen', 'Brunnen', 'bauen', 2),
  visitorBlueprint('vogelhaus', 'Vogelhaus', 'bauen', 3),
  visitorBlueprint('wegweiser', 'Wegweiser', 'bauen', 5),
  visitorBlueprint('sonnenblumen', 'Sonnenblumen', 'natur', 2),
  visitorBlueprint('pilzkreis', 'Pilzkreis', 'natur', 3),
  visitorBlueprint('kuerbisbeet', 'Kürbisbeet', 'natur', 5),
];

const deko = (key: string, name: string): Deko => ({ key, name, origin: 'besucher', art: key });

export const visitorDeko: readonly Deko[] = [
  deko('muschel', 'Muschel'),
  deko('treibholz', 'Treibholz'),
  deko('flaschenpost', 'Flaschenpost'),
  deko('kieselturm', 'Kieselturm'),
  deko('seestern', 'Seestern'),
  deko('windrad', 'Windrad'),
  deko('vogeltraenke', 'Vogeltränke'),
  deko('steinherz', 'Steinherz'),
];

const visitor = (key: string, name: string, animal: string, blueprints: readonly [string, string], dekoKey: string): VisitorTemplate => ({
  key, name, animal: `tier_${animal}`, wish: 'bauplan_bauen', rewards: { blueprints, deko: [dekoKey] },
});

/** Jeder Pool hat einen Bauplan je Rolle; so passt jeder Besucher zu jeder Person. */
export const visitorTemplates: readonly VisitorTemplate[] = [
  visitor('igel_ilse', 'Igel Ilse', 'igel', ['brunnen', 'sonnenblumen'], 'muschel'),
  visitor('fuchs_fridolin', 'Fuchs Fridolin', 'fuchs', ['vogelhaus', 'pilzkreis'], 'treibholz'),
  visitor('schwan_selma', 'Schwan Selma', 'schwan', ['wegweiser', 'kuerbisbeet'], 'flaschenpost'),
  visitor('eule_otto', 'Eule Otto', 'eule', ['vogelhaus', 'sonnenblumen'], 'kieselturm'),
  visitor('hase_hanna', 'Hase Hanna', 'hase', ['brunnen', 'kuerbisbeet'], 'seestern'),
  visitor('ente_emil', 'Ente Emil', 'ente', ['wegweiser', 'pilzkreis'], 'windrad'),
  visitor('eichhoernchen_erna', 'Eichhörnchen Erna', 'eichhoernchen', ['vogelhaus', 'kuerbisbeet'], 'vogeltraenke'),
  visitor('schildkroete_tilda', 'Schildkröte Tilda', 'schildkroete', ['brunnen', 'pilzkreis'], 'steinherz'),
];
