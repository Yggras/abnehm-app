import { Rubik_400Regular } from '@expo-google-fonts/rubik/400Regular';
import { Rubik_500Medium } from '@expo-google-fonts/rubik/500Medium';
import { Rubik_600SemiBold } from '@expo-google-fonts/rubik/600SemiBold';
import { Rubik_700Bold } from '@expo-google-fonts/rubik/700Bold';
import { useFonts } from 'expo-font';

import { fontFamily } from './tokens';

/**
 * Lädt Rubik in 400, 500, 600 und 700 unter den Familiennamen der Tokens. Jeder Schnitt ist eine
 * eigene Familie, damit Android den Schnitt nicht über `fontWeight` erraten muss. Importiert werden
 * nur die vier Schnitte, nicht alle 14 Dateien des Pakets.
 *
 * Liefert `true`, sobald die Schriften bereitstehen oder das Laden gescheitert ist; dann zeigt die App
 * die Systemschrift, statt hängen zu bleiben.
 */
export function useDesignFonts(): boolean {
  const [loaded, error] = useFonts({
    [fontFamily.regular]: Rubik_400Regular,
    [fontFamily.medium]: Rubik_500Medium,
    [fontFamily.semibold]: Rubik_600SemiBold,
    [fontFamily.bold]: Rubik_700Bold,
  });
  return loaded || error !== null;
}
