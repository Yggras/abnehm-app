import type { MessageKey, MessageValues } from '@abnehm/contracts/base';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet } from 'react-native';

import { space, Toast, useMotion, type Motion, type ToastLine } from '../design';
import { isTestArtifact } from '../test-artifact';
import { messageTexts } from './message-texts';
import { shellTexts } from './texts';

// Der eine Meldungs-Host der App-Shell über der Tab-Leiste (Spezifikation 0, Abschnitt 6).
// Quick-Commands und alle Bereichsbildschirme zeigen Meldungen und „Rückgängig“ nur über ihn.

/** „Rückgängig“ einer Meldung: `run` höchstens einmal; `expire`, wenn es ungenutzt endet. */
export type MessageUndo = { run: () => void; expire?: () => void };

export type Message = { messageKey: MessageKey; values: MessageValues; undo?: MessageUndo };

export type MessageHost = {
  /**
   * Zeigt eine Meldung. Es steht immer höchstens eine: Eine Meldung mit „Rückgängig“ bleibt ihre
   * volle Standzeit stehen; eine Meldung ohne kommt währenddessen als zweite Zeile dazu, die
   * Standzeit beginnt neu. Eine neue Meldung mit „Rückgängig“ ersetzt die bisherige, deren Undo
   * verfällt. Meldungen ohne „Rückgängig“ ersetzen einander. Eine Meldung ohne „Rückgängig“ darf selbst
   * zwei Zeilen haben (#188); an eine Meldung mit „Rückgängig“ wird dann nur ihre letzte angehängt.
   */
  showMessage(message: Message): void;
};

/** Ein Bereich zeigt eine Meldung, deren Text er nicht eingetragen hat. */
export class MissingMessageTextError extends Error {
  constructor(messageKey: string) {
    super(`Integrationsfehler: Für die Meldung ${messageKey} fehlt der Text.`);
    this.name = 'MissingMessageTextError';
  }
}

// Standzeit nach dem Design-System (Annahme 7: 5 s, mit Screenreader länger). Die 10 s mit
// Screenreader sind ein Designwert ohne Beleg. Android übernimmt zusätzlich die längere
// Systemeinstellung „Zeit zum Reagieren“ (https://reactnative.dev/docs/accessibilityinfo).
const standingTime = { default: 5_000, screenReader: 10_000 } as const;

type Shown = { line: ToastLine; secondLine?: ToastLine; undo?: MessageUndo };

const HostContext = createContext<MessageHost | null>(null);
const ShownContext = createContext<{ shown: Shown | null; pressUndo: (undo: MessageUndo) => void } | null>(null);

/** Die Zeilen einer Meldung, eine oder zwei. */
function linesOf({ messageKey, values }: Message): readonly [ToastLine] | readonly [ToastLine, ToastLine] {
  const entry = Object.prototype.hasOwnProperty.call(messageTexts, messageKey) ? messageTexts[messageKey] : undefined;
  const parsed = entry?.values.safeParse(values);
  if (entry && parsed?.success) {
    const lines = entry.render(parsed.data);
    return Array.isArray(lines) ? (lines as readonly [ToastLine, ToastLine]) : [lines as ToastLine];
  }
  if (!isTestArtifact()) throw new MissingMessageTextError(messageKey);
  return [{ text: shellTexts.missingMessageText(messageKey) }];
}

/** Standzeit unter der aktuellen Systemeinstellung; als Ref, weil der laufende Timer sie liest. */
function useStandingTime() {
  const time = useRef<number>(standingTime.default);
  useEffect(() => {
    let active = true;
    const update = async (screenReader: boolean) => {
      const base = screenReader ? standingTime.screenReader : standingTime.default;
      const system = Platform.OS === 'android' ? await AccessibilityInfo.getRecommendedTimeoutMillis(base) : base;
      if (active) time.current = Math.max(base, system);
    };
    void AccessibilityInfo.isScreenReaderEnabled().then(update);
    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', (enabled) => void update(enabled));
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return time;
}

/** Besitzt Zustand und Standzeit der Meldung; `MessageSlot` zeigt sie über der Tab-Leiste. */
export function MessageHostProvider({ children }: { children: ReactNode }) {
  const time = useStandingTime();
  const [shown, setShown] = useState<Shown | null>(null);
  const [controller] = useState(() => {
    let current: Shown | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const display = (next: Shown | null) => {
      clearTimeout(timer);
      current = next;
      setShown(next);
      if (next) timer = setTimeout(end, time.current);
    };
    const end = () => {
      const ended = current;
      display(null);
      ended?.undo?.expire?.();
    };

    const host: MessageHost = {
      showMessage(message) {
        const lines = linesOf(message);
        const [line, secondLine] = lines;
        const previous = current;
        if (message.undo) display({ line, undo: message.undo });
        // Angehängt wird nur die letzte Zeile; die Meldung mit „Rückgängig“ behält ihre erste.
        else if (previous?.undo) display({ ...previous, secondLine: lines.at(-1) });
        else display({ line, secondLine });
        if (message.undo && previous?.undo !== message.undo) previous?.undo?.expire?.();
        const shown = message.undo === undefined && previous?.undo ? [lines.at(-1)!] : lines;
        for (const { text } of shown) AccessibilityInfo.announceForAccessibility(text);
      },
    };
    // Nur das „Rückgängig“ der gerade gezeigten Meldung zählt, und nur einmal: Danach ist sie weg.
    const pressUndo = (undo: MessageUndo) => {
      if (current?.undo !== undo) return;
      display(null);
      undo.run();
    };
    return { host, pressUndo, unmount: end };
  });

  useEffect(() => controller.unmount, [controller]);

  return (
    <HostContext.Provider value={controller.host}>
      <ShownContext.Provider value={{ shown, pressUndo: controller.pressUndo }}>{children}</ShownContext.Provider>
    </HostContext.Provider>
  );
}

/** Zugang zum Meldungs-Host für Quick-Commands und Bereichsbildschirme. */
export function useMessageHost(): MessageHost {
  const host = useContext(HostContext);
  if (!host) throw new Error('useMessageHost braucht den MessageHostProvider der App-Shell');
  return host;
}

function animate(value: Animated.Value, toValue: number, motion: Motion, done?: () => void) {
  const config =
    motion.type === 'timing'
      ? { duration: motion.duration, easing: Easing.bezier(...motion.easing) }
      : { duration: motion.type === 'crossfade' ? motion.duration : 0 };
  Animated.timing(value, { toValue, ...config, useNativeDriver: true }).start(({ finished }) => {
    if (finished) done?.();
  });
}

/**
 * Platz der Meldung über der Tab-Leiste. Sie blendet ein und aus; beim Ausblenden ist sie für
 * Berührung und Screenreader schon weg.
 */
export function MessageSlot() {
  const state = useContext(ShownContext);
  if (!state) throw new Error('MessageSlot braucht den MessageHostProvider der App-Shell');
  const { shown, pressUndo } = state;
  const enter = useMotion('enter');
  const exit = useMotion('exit');
  const [opacity] = useState(() => new Animated.Value(0));
  // Gezeichnet wird die zuletzt gezeigte Meldung, bis sie ausgeblendet ist.
  const [drawn, setDrawn] = useState<Shown | null>(shown);
  if (shown && shown !== drawn) setDrawn(shown);

  useEffect(() => {
    // Eine neue Meldung hält ein laufendes Ausblenden an; dessen Abschluss kommt dann nicht mehr.
    if (shown) animate(opacity, 1, enter);
    else animate(opacity, 0, exit, () => setDrawn(null));
    // Die Bewegung gilt für den Wechsel, auf den sie trifft; ein späterer Wechsel der Einstellung animiert nichts neu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  if (!drawn) return null;
  const { line, secondLine, undo } = drawn;
  return (
    <Animated.View
      testID="message-slot"
      pointerEvents={shown ? 'box-none' : 'none'}
      accessibilityElementsHidden={!shown}
      importantForAccessibility={shown ? 'auto' : 'no-hide-descendants'}
      style={[styles.slot, { opacity }]}
    >
      <Toast line={line} secondLine={secondLine} onUndo={undo && shown ? () => pressUndo(undo) : undefined} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  slot: { paddingHorizontal: space[4] },
});
