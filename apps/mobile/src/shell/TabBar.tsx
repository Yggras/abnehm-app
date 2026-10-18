import type { RouteTarget } from '@abnehm/contracts/routes';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { boxShadow, color, fontFamily, Icon, pressedEdge, radius, size, space, Text, type IconName } from '../design';
import { openTarget } from '../navigation';
import { CaptureSheet } from './CaptureSheet';
import type { QuickCommand } from './quick-commands';
import { shellTexts, titleOf } from './texts';
import { useQuickCommand } from './use-quick-command';

type TabName = 'index' | 'log' | 'momo' | 'partner';

/** Tabs nach Routendatei in `app/(tabs)/`: Ziel für Titel und Symbol. */
const tabs: Record<TabName, { target: RouteTarget; icon: IconName }> = {
  index: { target: { type: 'today' }, icon: 'sun' },
  log: { target: { type: 'log' }, icon: 'book' },
  momo: { target: { type: 'momo' }, icon: 'island' },
  partner: { target: { type: 'partner' }, icon: 'people' },
};

/** Wie weit das ＋ über die Leiste ragt (Design-System, Komponente „Tab-Leiste“). */
const plusOverhang = 14;

export type TabBarProps = Pick<BottomTabBarProps, 'state' | 'emitter' | 'navigateToTab' | 'insets'> & {
  /** Punkt am Tab „Momo“ für ein neues Insel-Ereignis (`TabBadge`). */
  momoBadge?: boolean;
  /** Höhe der Leiste samt Überstand; darüber steht der Meldungs-Host. */
  onLayout?: (event: LayoutChangeEvent) => void;
};

/**
 * Eigene Tab-Leiste: Heute · Protokoll · ＋ · Momo · Wir. Das ＋ ist kein Tab, es öffnet das
 * ＋-Sheet. Die Leiste ist oben um den Überstand höher als ihre Fläche, sodass das ＋ ganz in ihr
 * liegt: Android nimmt Berührungen außerhalb des Elternelements nicht an.
 */
export function TabBar({ state, emitter, navigateToTab, insets, momoBadge = false, onLayout }: TabBarProps) {
  const [captureOpen, setCaptureOpen] = useState(false);
  const runQuickCommand = useQuickCommand();
  const items = state.routes.map((route, index) => {
    const tab = tabs[route.name as TabName];
    const focused = index === state.index;
    const onPress = () => {
      const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
      if (!focused && !event.defaultPrevented) navigateToTab(route.key);
    };
    return (
      <TabItem
        key={route.key}
        title={titleOf(tab.target)}
        icon={tab.icon}
        focused={focused}
        badge={route.name === 'momo' && momoBadge}
        onPress={onPress}
      />
    );
  });
  const middle = Math.ceil(items.length / 2);

  const choose = (target: RouteTarget) => {
    setCaptureOpen(false);
    openTarget(target);
  };
  const quickCommand = (command: QuickCommand) => {
    setCaptureOpen(false);
    runQuickCommand(command);
  };

  return (
    <View
      testID="tab-bar"
      accessibilityRole="tablist"
      onLayout={onLayout}
      style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space[2]) }]}
    >
      <View style={styles.surface} pointerEvents="none" />
      {items.slice(0, middle)}
      <View style={styles.plusSlot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={shellTexts.capture}
          accessibilityState={{ expanded: captureOpen }}
          onPress={() => setCaptureOpen(true)}
          style={({ pressed }) => [styles.plus, pressed ? styles.plusPressed : styles.plusResting]}
        >
          <Icon name="plus" size="lg" tone="onPrimary" />
        </Pressable>
      </View>
      {items.slice(middle)}
      <CaptureSheet visible={captureOpen} onClose={() => setCaptureOpen(false)} onChoose={choose} onQuickCommand={quickCommand} />
    </View>
  );
}

type TabItemProps = { title: string; icon: IconName; focused: boolean; badge: boolean; onPress: () => void };

/** Ein Tab: aktiv mit Farbe, Pille und fetter Beschriftung, nie nur über Farbe. */
function TabItem({ title, icon, focused, badge, onPress }: TabItemProps) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={shellTexts.tab(title, badge)}
      accessibilityState={{ selected: focused }}
      onPress={onPress}
      style={styles.tab}
    >
      {({ pressed }) => (
        <>
          <View style={[styles.pill, focused && styles.pillFocused, pressed && (focused ? styles.pillFocusedPressed : styles.pillPressed)]}>
            <Icon name={icon} size="lg" tone={focused ? 'primary' : 'inkMuted'} />
            {badge ? <View testID="tab-badge" style={styles.badge} /> : null}
          </View>
          <Text
            variant="tabLabel"
            tone={focused ? 'primary' : 'inkMuted'}
            numberOfLines={1}
            adjustsFontSizeToFit
            style={focused && styles.labelFocused}
          >
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const pillWidth = 56;
const pillHeight = 32;
const badgeSize = 10;
const badgeInset = 3;

const styles = StyleSheet.create({
  // Die Leiste reicht bis an die Oberkante des ＋; ihre Fläche beginnt erst unter dem Überstand.
  bar: { flexDirection: 'row', paddingHorizontal: space[1], backgroundColor: color.surfaceBase },
  surface: {
    ...StyleSheet.absoluteFill,
    top: plusOverhang,
    backgroundColor: color.surfaceCard,
    boxShadow: boxShadow.sheet,
  },
  tab: {
    flex: 1,
    minWidth: size.touchMin,
    minHeight: size.touchMin,
    marginTop: plusOverhang + space[2],
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1],
  },
  pill: {
    width: pillWidth,
    height: pillHeight,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillFocused: { backgroundColor: color.primarySoft },
  pillPressed: { backgroundColor: color.surfaceSunken },
  pillFocusedPressed: { backgroundColor: color.primarySoftPressed },
  badge: {
    position: 'absolute',
    top: badgeInset,
    right: space[3],
    width: badgeSize,
    height: badgeSize,
    borderRadius: badgeSize / 2,
    borderWidth: 2,
    borderColor: color.surfaceCard,
    backgroundColor: color.hint,
  },
  labelFocused: { fontFamily: fontFamily.bold },
  plusSlot: { flex: 1, minWidth: size.plusButton, alignItems: 'center' },
  plus: {
    width: size.plusButton,
    height: size.plusButton,
    borderRadius: size.plusButton / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusResting: { backgroundColor: color.primary, boxShadow: boxShadow.floating },
  plusPressed: { backgroundColor: color.primaryPressed, ...pressedEdge('floating', 'buttonPressed') },
});
