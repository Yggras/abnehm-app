import { panBy, startView, toScene, zoomAt, type View } from './viewport';

// Ausschnitt der Inselansicht (Spezifikation 4, Abschnitt 7): Start auf Momos Lichtung, Ziehen
// verschiebt, Pinch zoomt von 0,5 bis 2,0 um den Mittelpunkt der Finger. Werte von Hand gerechnet.

const screen = { width: 400, height: 800 };
const bounds = { x: -400, y: 0, width: 800, height: 600 };

test('der Start zeigt den Fokus bei Zoom 1 in der Mitte des Bildschirms', () => {
  expect(startView(screen, { x: 100, y: 250 })).toEqual({ x: 100, y: 150, scale: 1 });
});

test('Pinch hält den Punkt unter den Fingern fest', () => {
  const view: View = { x: 100, y: 150, scale: 1 };

  // Fokus (200, 400) zeigt Szenenpunkt (100, 250); bei Zoom 1,5 bleibt er dort.
  const zoomed = zoomAt(view, { x: 200, y: 400 }, 1.5, screen, bounds);

  expect(zoomed).toEqual({ x: 50, y: 25, scale: 1.5 });
  expect(toScene(zoomed, { x: 200, y: 400 })).toEqual({ x: 100, y: 250 });
});

test.each([
  [0.1, 0.5],
  [0.5, 0.5],
  [2, 2],
  [5, 2],
])('Zoom um den Faktor %d endet bei %d: nie unter 0,5 und nie über 2,0', (factor, scale) => {
  expect(zoomAt({ x: 100, y: 150, scale: 1 }, { x: 200, y: 400 }, factor, screen, bounds).scale).toBe(scale);
});

test('Ziehen verschiebt die Szene um den Fingerweg', () => {
  expect(panBy({ x: 100, y: 150, scale: 1 }, { x: -30, y: 40 }, screen, bounds)).toEqual({ x: 70, y: 190, scale: 1 });
});

test('die Insel bleibt erreichbar: Die Bildschirmmitte verlässt ihre Ausdehnung nie', () => {
  // Bildschirmmitte (200, 400) bei Zoom 1 zeigt den Szenenpunkt (200 − x, 400 − y); er bleibt in x ∈ [−400, 400], y ∈ [0, 600].
  expect(panBy({ x: 100, y: 150, scale: 1 }, { x: 5000, y: 5000 }, screen, bounds)).toEqual({ x: 600, y: 400, scale: 1 });
  expect(panBy({ x: 100, y: 150, scale: 1 }, { x: -5000, y: -5000 }, screen, bounds)).toEqual({ x: -200, y: -200, scale: 1 });
});

test('ein Punkt des Bildschirms wird mit Verschiebung und Zoom in die Szene zurückgerechnet', () => {
  expect(toScene({ x: 50, y: 25, scale: 2 }, { x: 250, y: 425 })).toEqual({ x: 100, y: 200 });
});
