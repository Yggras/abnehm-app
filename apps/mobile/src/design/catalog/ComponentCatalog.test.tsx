import { render, screen } from '@testing-library/react-native';

import { hitArea } from '../testing/hit-area';
import { textScale } from '../tokens';
import ComponentCatalog from './ComponentCatalog';

// Der Katalog zeigt alle Primitiven in ihren Zuständen. Deshalb prüft dieser Test an ihm die
// Zusagen, die für jede Oberfläche aus dem Design-System gelten.

const interactiveRoles = ['button', 'radio', 'checkbox', 'switch', 'link', 'tab'];

test('jedes Bedienelement hat mindestens 48 × 48 dp Trefferfläche', async () => {
  await render(<ComponentCatalog />);

  const controls = interactiveRoles.flatMap((role) => screen.queryAllByRole(role));
  expect(controls.length).toBeGreaterThan(40);

  const tooSmall = controls
    .map((control) => ({ name: control.props.accessibilityLabel as string | undefined, ...hitArea(control) }))
    .filter((area) => area.width < 48 || area.height < 48);
  expect(tooSmall).toEqual([]);
});

test('jeder Text skaliert mit der Systemschrift bis Faktor 2,0, enger nur die begrenzten Stile', async () => {
  await render(<ComponentCatalog />);

  const texts = screen.queryAllByText(/[\s\S]*/, { includeHiddenElements: true });
  const limits = new Set<number>([textScale.max, ...Object.values(textScale.limit)]);

  expect(texts.length).toBeGreaterThan(100);
  for (const text of texts) {
    expect(text.props.allowFontScaling).not.toBe(false);
    expect(limits).toContain(text.props.maxFontSizeMultiplier);
  }
});
