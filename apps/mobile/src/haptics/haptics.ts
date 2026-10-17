/** Die drei Erfolge mit dezenter Haptik (Design-System, offene Frage 4). */
export type HapticKind = 'tageszielerfuellung' | 'tagesbonus' | 'levelaufstieg';

/**
 * Haptik als kleiner Plattformadapter: Jeder Aufruf löst genau ein Feedback aus. Der Adapter kennt
 * keine Ereignisse und dedupliziert nichts. Einziger Aufrufer ist die Reaktion auf Tageszielerfüllung,
 * Tagesbonus und Levelaufstieg in Spezifikation 4; sie verantwortet höchstens eine Auslösung je
 * dauerhaftem Ereignis.
 */
export interface Haptics {
  feedback(kind: HapticKind): void;
}
