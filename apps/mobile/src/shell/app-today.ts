import { createTodayRegistry } from './today-registry';

/** Composition Root der Heute-Beiträge. Bereiche registrieren genau ihren Slot, bevor Heute gerendert wird. */
export const appTodayRegistry = createTodayRegistry();
