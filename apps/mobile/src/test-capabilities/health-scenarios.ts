import { healthScenarios, type HealthScenario } from '../health/testing/fake-platform';

// Szenarien des Links `health` (#183, #195): die der Health-Attrappe und `geraet`, die echte Plattform des
// Builds. Eigenes Modul, damit der Link-Parser nicht an der Steuerung der Attrappe (`./health.ts`) hängt.

export const testHealthScenarios = [...healthScenarios, 'geraet'] as const;
export type TestHealthScenario = HealthScenario | 'geraet';
