import { render, screen, act } from '@testing-library/react-native';
import { View } from 'react-native';
import { Instant } from '@abnehm/contracts/base';
import { syncStatusSource } from '../session/sync-status-source';
import { SyncWarning } from './SyncWarning';

test('der Sicherungshinweis erscheint nach 24 Stunden und verschwindet nach Bestätigung', async () => {
  syncStatusSource.publish({ type: 'secured' });
  await render(<View><SyncWarning /></View>);
  expect(screen.queryByText('Noch nicht gesichert – verbinde dich mit dem Internet')).toBeNull();
  await act(async () => syncStatusSource.publish({ type: 'not_secured_since', since: Instant.parse('2026-10-14T12:00:00.000Z') }));
  expect(screen.getByText('Noch nicht gesichert – verbinde dich mit dem Internet')).toBeTruthy();
  await act(async () => syncStatusSource.publish({ type: 'secured' }));
  expect(screen.queryByText('Noch nicht gesichert – verbinde dich mit dem Internet')).toBeNull();
});
