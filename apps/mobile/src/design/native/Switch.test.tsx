import { render, screen, userEvent } from '@testing-library/react-native';

import { hitArea } from '../testing/hit-area';
import { Switch } from './Switch';

test('ist ein Schalter mit Name und Zustand und schaltet um', async () => {
  const onValueChange = jest.fn();
  await render(<Switch label="Fotos teilen" value={false} onValueChange={onValueChange} />);

  const toggle = screen.getByRole('switch', { name: 'Fotos teilen' });
  await userEvent.press(toggle);

  expect(toggle).not.toBeChecked();
  expect(onValueChange).toHaveBeenCalledWith(true);
  expect(hitArea(toggle)).toEqual({ width: 48, height: 48 });
});

test('deaktiviert schaltet nicht', async () => {
  const onValueChange = jest.fn();
  await render(<Switch label="Health" value onValueChange={onValueChange} disabled />);

  await userEvent.press(screen.getByRole('switch', { name: 'Health' }));

  expect(onValueChange).not.toHaveBeenCalled();
});
