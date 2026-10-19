import { notifyManager } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { EntityId } from '@abnehm/contracts/base';

import { OnlineFlowsProvider, useAcceptInvitation, useCheckInvitationCode, useCreateInvitationCode } from '.';
import { fakeInvitationFlows } from './testing/fake-invitation-flows';

// Hooks der Einladungsabläufe (#103) mit dem Online-Test-Adapter: Zustände, stabile `requestId` über
// Wiederholungen derselben Absicht und eine neue nach dem Erfolg.

// TanStack bündelt Benachrichtigungen standardmäßig per `setTimeout(0)`, also außerhalb von `act`
// (https://tanstack.com/query/v5/docs/reference/notifyManager); im Test geht jede sofort an React.
beforeAll(() => notifyManager.setScheduler((callback) => callback()));
afterAll(() => notifyManager.setScheduler((callback) => setTimeout(callback, 0)));

function setup() {
  const flows = fakeInvitationFlows();
  let next = 0;
  const newId = () => EntityId.parse(`00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <OnlineFlowsProvider invitations={flows} newId={newId}>
      {children}
    </OnlineFlowsProvider>
  );
  return { flows, wrapper };
}

test('Code erzeugen: erst wartend, dann Code und Ablauf', async () => {
  const { flows, wrapper } = setup();
  const release = flows.hold('createCode');
  const { result } = await renderHook(() => useCreateInvitationCode(), { wrapper });
  expect(result.current.state).toEqual({ type: 'idle' });

  await act(async () => result.current.create());
  await waitFor(() => expect(result.current.state).toEqual({ type: 'pending' }));
  await act(async () => release());

  await waitFor(() => expect(result.current.state).toEqual({ type: 'ok', value: flows.defaults.createCode }));
});

test('Annehmen: dieselbe requestId nach „offline“ und Ablehnung, eine neue nach dem Erfolg', async () => {
  const { flows, wrapper } = setup();
  flows.respond('acceptCode', { type: 'offline' }, { type: 'rejected', code: 'invite_rate_limited' });
  const { result } = await renderHook(() => useAcceptInvitation(), { wrapper });

  await act(async () => result.current.accept('482915'));
  await waitFor(() => expect(result.current.state).toEqual({ type: 'offline' }));
  await act(async () => result.current.accept('482915'));
  await waitFor(() => expect(result.current.state).toEqual({ type: 'rejected', code: 'invite_rate_limited' }));
  await act(async () => result.current.accept('482915'));
  await waitFor(() => expect(result.current.state.type).toBe('ok'));
  await act(async () => result.current.accept('482915'));
  await waitFor(() => expect(flows.calls).toHaveLength(4));

  const requestIds = flows.calls.map((call) => call.requestId);
  expect(requestIds.slice(0, 3)).toEqual([requestIds[0], requestIds[0], requestIds[0]]);
  expect(requestIds[3]).not.toBe(requestIds[0]);
});

test('Annehmen: ein anderer Code ist eine neue Absicht mit neuer requestId', async () => {
  const { flows, wrapper } = setup();
  flows.respond('acceptCode', { type: 'rejected', code: 'invite_invalid' });
  const { result } = await renderHook(() => useAcceptInvitation(), { wrapper });

  await act(async () => result.current.accept('482915'));
  await waitFor(() => expect(result.current.state).toEqual({ type: 'rejected', code: 'invite_invalid' }));
  await act(async () => result.current.accept('482916'));
  await waitFor(() => expect(flows.calls).toHaveLength(2));

  expect(flows.calls.map((call) => call.code)).toEqual(['482915', '482916']);
  expect(flows.calls[1]!.requestId).not.toBe(flows.calls[0]!.requestId);
});

test('Code prüfen: Ergebnis und Zurücksetzen', async () => {
  const { flows, wrapper } = setup();
  const { result } = await renderHook(() => useCheckInvitationCode(), { wrapper });

  await act(async () => result.current.check('482915'));
  await waitFor(() => expect(result.current.state).toEqual({ type: 'ok', value: flows.defaults.checkCode }));
  await act(async () => result.current.reset());

  await waitFor(() => expect(result.current.state).toEqual({ type: 'idle' }));
});

test('ein unerwarteter Fehler des Ablaufs wird zu „failed“, nicht zu einer Ausnahme', async () => {
  const { flows, wrapper } = setup();
  flows.respond('checkCode', new Error('Programmfehler'));
  const { result } = await renderHook(() => useCheckInvitationCode(), { wrapper });

  await act(async () => result.current.check('482915'));

  await waitFor(() => expect(result.current.state).toEqual({ type: 'failed' }));
});
