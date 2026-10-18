import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button, space, Text } from '../../design';
import { routeScreen } from '../../navigation';
import { Placeholder } from '../../shell/Placeholder';
import { shellTexts } from '../../shell/texts';

// „Heute“ setzt die Heute-Registry (#109) aus festen Slots zusammen; bis dahin ein Platzhalter.
// Im Development Build führt er zu den Werkzeugen des Fundaments.
export default routeScreen('today', ({ target }) => (
  <Placeholder target={target}>
    {__DEV__ ? (
      <View style={styles.developer}>
        <Text variant="headline" accessibilityRole="header">
          {shellTexts.developer}
        </Text>
        <Button label={shellTexts.componentCatalog} variant="text" icon="layers" onPress={() => router.push('/katalog')} />
        <Button label={shellTexts.technicalCheck} variant="text" icon="pulse" onPress={() => router.push('/technik')} />
      </View>
    ) : null}
  </Placeholder>
));

const styles = StyleSheet.create({
  developer: { gap: space[2], paddingTop: space[4] },
});
