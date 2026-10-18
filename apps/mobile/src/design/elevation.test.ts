import { boxShadow } from './elevation';
import { color, elevation } from './tokens';

test('übersetzt die Sockelkante der Karte in einen unscharfen React-Native-Schatten nach unten', () => {
  expect(boxShadow.card).toEqual([{ offsetX: 0, offsetY: 4, blurRadius: 0, spreadDistance: 0, color: color.plinth }]);
});

test('übernimmt mehrere Ebenen, Spread und Richtung nach oben', () => {
  expect(boxShadow.sheet).toEqual([
    { offsetX: 0, offsetY: -1, blurRadius: 0, spreadDistance: 0, color: color.line },
    { offsetX: 0, offsetY: -10, blurRadius: 30, spreadDistance: -10, color: '#1D333233' },
  ]);
});

test('liefert für jede Elevation einen Wert', () => {
  expect(Object.keys(boxShadow)).toEqual(Object.keys(elevation));
});
