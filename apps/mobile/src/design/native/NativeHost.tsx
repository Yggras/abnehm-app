import { Host } from '@expo/ui';
import type { ComponentProps } from 'react';

import { color } from '../tokens';

/**
 * Host für native `@expo/ui`-Elemente: immer hell (V1 hat keinen Dunkelmodus) und mit `primary` als
 * Ausgangsfarbe. Auf iOS wird sie zur SwiftUI-Tönung, auf Android zur Material-3-Palette.
 */
export function NativeHost(props: Omit<ComponentProps<typeof Host>, 'colorScheme' | 'seedColor'>) {
  return <Host colorScheme="light" seedColor={color.primary} {...props} />;
}
