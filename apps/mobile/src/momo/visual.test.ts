import type { MomoAppearance, MomoForm } from '@abnehm/contracts/island';
import type { GameCatalog } from '@abnehm/game-rules/catalog';
import { gameCatalog } from '@abnehm/game-rules/content';

import { momoVisual } from './visual';

// Nachweis für #187: Aus Erscheinung und Stimmung wählt das Rig Manifest, Ausdruck und Accessoires
// und benennt Momo mit Form, Stimmung und Accessoires (Spezifikation 4, Abschnitt 6).

const laichkugel: MomoAppearance = { stage: 'laichkugel', formKey: null, moodKey: null, accessories: { kopf: null, hals: null } };
const hatched = (formKey: MomoForm, accessories: MomoAppearance['accessories'] = { kopf: null, hals: null }): MomoAppearance => ({
  stage: 'geschluepft',
  formKey,
  moodKey: 'zufrieden',
  accessories,
});

describe('Bezeichnung', () => {
  test('die Laichkugel wartet im Ei, gleich welche Stimmung der Aufrufer nennt', () => {
    expect(momoVisual(laichkugel, 'begeistert', gameCatalog)).toMatchObject({ mood: 'wartet_im_ei', label: 'Momo wartet im Ei' });
  });

  test('ohne Erscheinung, etwa vor der Kopplung, zeigt sie die Laichkugel', () => {
    expect(momoVisual(null, 'neugierig', gameCatalog)).toMatchObject({ manifest: { form: 'laichkugel' }, label: 'Momo wartet im Ei' });
  });

  test.each([
    ['zufrieden', 'Momo, Kaulquappe, zufrieden'],
    ['freut_sich', 'Momo, Kaulquappe, freut sich'],
    ['begeistert', 'Momo, Kaulquappe, begeistert'],
    ['neugierig', 'Momo, Kaulquappe, neugierig'],
    ['doest', 'Momo, Kaulquappe, döst'],
    ['schlaeft', 'Momo, Kaulquappe, schläft'],
  ] as const)('nennt Form und Stimmung: %s', (mood, label) => {
    expect(momoVisual(hatched('kaulquappe'), mood, gameCatalog).label).toBe(label);
  });

  test('nennt getragene Accessoires mit ihrem Katalognamen', () => {
    const appearance = hatched('lagunendrache', { kopf: 'strohhuetchen', hals: 'muschelkette' });
    expect(momoVisual(appearance, 'freut_sich', gameCatalog).label).toBe('Momo, Lagunendrache, freut sich, trägt Strohhütchen und Muschelkette');
  });

  test('nennt ein einzelnes Accessoire', () => {
    expect(momoVisual(hatched('kaulquappe', { kopf: null, hals: 'muschelkette' }), 'zufrieden', gameCatalog).label).toBe(
      'Momo, Kaulquappe, zufrieden, trägt Muschelkette',
    );
  });
});

describe('Form', () => {
  test.each(['kaulquappe', 'lagunendrache'] as const)('zeichnet %s mit dem eigenen Manifest', (form) => {
    expect(momoVisual(hatched(form), 'zufrieden', gameCatalog).manifest.form).toBe(form);
  });

  test('zeichnet Formen ohne eigenes Manifest bis #213 als Kaulquappe, nennt aber die echte Form', () => {
    const visual = momoVisual(hatched('huepfer'), 'freut_sich', gameCatalog);
    expect(visual.manifest.form).toBe('kaulquappe');
    expect(visual.label).toBe('Momo, Hüpfer, freut sich');
  });
});

describe('Accessoires', () => {
  test('setzt ein Accessoire mit der Passung seiner Form an seine Stelle', () => {
    const visual = momoVisual(hatched('lagunendrache', { kopf: 'strohhuetchen', hals: null }), 'zufrieden', gameCatalog);
    expect(visual.accessories.kopf).toMatchObject({ name: 'Strohhütchen', fit: { x: 1, y: 2, rotation: -6, scale: 0.8 } });
    expect(visual.accessories.hals).toBeNull();
  });

  test('übergeht unbekannte Schlüssel und Grafiken, statt zu raten', () => {
    const catalog: GameCatalog = {
      ...gameCatalog,
      accessories: [{ ...gameCatalog.accessories[0]!, key: 'ohne_grafik', name: 'Ohne Grafik', art: 'gibt_es_nicht' }],
    };
    const visual = momoVisual(hatched('kaulquappe', { kopf: 'ohne_grafik', hals: 'unbekannt' }), 'zufrieden', catalog);
    expect(visual.accessories).toEqual({ kopf: null, hals: null });
    expect(visual.label).toBe('Momo, Kaulquappe, zufrieden');
  });

  test('legt ein Accessoire nur an seine eigene Stelle', () => {
    const visual = momoVisual(hatched('kaulquappe', { kopf: 'muschelkette', hals: 'strohhuetchen' }), 'zufrieden', gameCatalog);
    expect(visual.accessories).toEqual({ kopf: null, hals: null });
  });
});
