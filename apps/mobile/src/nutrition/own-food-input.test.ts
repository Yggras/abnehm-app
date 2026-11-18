/** @jest-environment node */
import { ownFoodSnapshot } from '@abnehm/contracts/nutrition';

import { checkOwnFoodDraft, checkPortionDraft, emptyOwnFoodDraft, ownFoodDraftOf, type OwnFoodDraft } from './own-food-input';

// Formular „Eigenes Lebensmittel“ (#157): deutsche Dezimalzahlen werden zu mg, ml und `milli_kcal`;
// jede ungültige Eingabe hat ein Problem am Feld.

const filled: OwnFoodDraft = {
  ...emptyOwnFoodDraft('Bircher-Müsli'),
  kcal: '150',
  protein: '4,5',
  carbs: '21',
  fat: '5,2',
  portion: { amount: '250', label: '1 Glas' },
};

describe('Eigenes Lebensmittel im Formular', () => {
  it('rechnet g, kcal und Makros in Ganzzahlen des Vertrags um, mit optionaler Portion', () => {
    expect(checkOwnFoodDraft(filled)).toEqual({
      type: 'werte',
      values: {
        name: 'Bircher-Müsli',
        baseUnit: 'g',
        referenceAmount: 100_000,
        milliKcal: 150_000,
        proteinMg: 4_500,
        carbsMg: 21_000,
        fatMg: 5_200,
        portions: [{ unit: 'portion', label: '1 Glas', baseAmount: 250_000 }],
      },
    });
  });

  it('nimmt ml ganzzahlig und vergleicht dort die Makros nicht mit der Bezugsmenge', () => {
    const drink = { ...filled, baseUnit: 'ml', referenceAmount: '250', carbs: '300', portion: { amount: '330', label: '' }, stueck: { amount: '', label: '' } } as const;

    expect(checkOwnFoodDraft(drink)).toMatchObject({ type: 'werte', values: { referenceAmount: 250, carbsMg: 300_000, portions: [{ unit: 'portion', label: null, baseAmount: 330 }] } });
    expect(checkOwnFoodDraft({ ...drink, referenceAmount: '250,5' })).toEqual({ type: 'probleme', problems: { referenceAmount: 'ganze_ml' } });
  });

  it.each([
    ['ohne Namen', { name: '  ' }, { name: 'leer' }],
    ['Name über 200 Zeichen', { name: 'a'.repeat(201) }, { name: 'zu_lang' }],
    ['Bezugsmenge 0', { referenceAmount: '0' }, { referenceAmount: 'null' }],
    ['Bezugsmenge über 5 kg', { referenceAmount: '5000,001' }, { referenceAmount: 'zu_gross' }],
    ['kcal leer', { kcal: '' }, { kcal: 'leer' }],
    ['Fett als Wort', { fat: 'wenig' }, { fat: 'format' }],
    ['Eiweiß mit Tausenderpunkt', { protein: '1.500' }, { protein: 'tausenderpunkt' }],
    ['Makros schwerer als die Bezugsmenge', { protein: '50', carbs: '50', fat: '0,001' }, { makros: 'makros_zu_schwer' }],
    ['Portion ohne Gewicht', { portion: { amount: '', label: '1 Glas' } }, { portionAmount: 'gewicht_fehlt' }],
    ['Stück über 5 kg', { stueck: { amount: '5001', label: '' } }, { stueckAmount: 'zu_gross' }],
  ])('meldet %s am Feld', (_, change, problems) => {
    expect(checkOwnFoodDraft({ ...filled, ...change })).toEqual({ type: 'probleme', problems });
  });

  it('belegt das Formular mit einer Fassung vor; unverändert ergibt es dieselben Werte', () => {
    const check = checkOwnFoodDraft(filled);
    if (check.type !== 'werte') throw new Error('ungültig');

    const draft = ownFoodDraftOf(ownFoodSnapshot(check.values));

    expect(draft).toEqual({ ...filled, stueck: { amount: '', label: '' } });
    expect(checkOwnFoodDraft(draft)).toEqual(check);
  });
});

describe('Fehlende Umrechnung', () => {
  it('verlangt das Gewicht und nimmt eine Bezeichnung optional', () => {
    expect(checkPortionDraft('stueck', 'g', { amount: '180', label: ' ' })).toEqual({ type: 'umrechnung', conversion: { unit: 'stueck', label: null, baseAmount: 180_000 } });
    expect(checkPortionDraft('stueck', 'g', { amount: '', label: '1 großer' })).toEqual({ type: 'probleme', problems: { amount: 'gewicht_fehlt' } });
    expect(checkPortionDraft('portion', 'g', { amount: '40', label: 'x'.repeat(41) })).toEqual({ type: 'probleme', problems: { label: 'zu_lang' } });
  });
});
