import {
  EncouragementKey,
  EncouragementPushStatus,
  EncouragementRecord,
  PartnerDailyGoalStage,
  PartnerDailyGoalStatus,
  PartnerPhotoList,
  PartnerPhotoRequest,
  PartnerSummaryEnvelope,
  RevocationNotice,
  SendEncouragement,
} from '../src/partner.ts';
import { fixtures, without } from './define.ts';
import { anna, coupling, encouragement, notice, now, philipp, projection, timeZone, today } from './ids.ts';

const envelopeBase = {
  id: projection,
  generation: 1,
  ownerPersonId: anna,
  recipientPersonId: philipp,
  couplingId: coupling,
  dataAsOf: now,
  serverVersion: '1834',
} as const;

const sendEncouragement = {
  encouragementId: encouragement,
  messageKey: 'stark_heute',
  createdAt: now,
  localDate: today,
  timeZone,
  utcOffsetMinutes: 120,
} as const;

const encouragementRecord = {
  couplingId: coupling,
  senderPersonId: philipp,
  recipientPersonId: anna,
  messageKey: 'stark_heute',
  sentAt: now,
  localDate: today,
  timeZone,
  utcOffsetMinutes: 120,
  pushStatus: 'ausstehend',
  thankedAt: null,
  createdAt: now,
  updatedAt: now,
} as const;

const water = {
  type: 'wasser',
  ...envelopeBase,
  period: { type: 'tag', localDate: today },
  content: { progressPercent: 64 },
} as const;

const weight = {
  type: 'gewicht',
  ...envelopeBase,
  period: { type: 'vierzehn_tage', from: '2026-10-01', to: today },
  content: { changeKg: -0.4, direction: 'sinkend' },
} as const;

const status = {
  id: projection,
  ownerPersonId: anna,
  recipientPersonId: philipp,
  couplingId: coupling,
  localDate: today,
  dataAsOf: now,
  stage: 'unterwegs',
  serverVersion: '1835',
} as const;

const revocation = {
  id: notice,
  recipientPersonId: philipp,
  couplingId: coupling,
  target: { type: 'partner_summary', projectionId: projection },
  reason: 'freigabe_entzogen',
  serverVersion: '1840',
} as const;

export const partnerFixtures = {
  PartnerSummaryEnvelope: fixtures(PartnerSummaryEnvelope, {
    valid: {
      'Ernährung ohne Mahlzeit': {
        type: 'ernaehrung',
        ...envelopeBase,
        period: { type: 'tag', localDate: today },
        content: { recordedMealCategories: 0 },
      },
      'Wasser': water,
      'Sport in der Woche': {
        type: 'sport',
        ...envelopeBase,
        period: { type: 'woche', from: '2026-10-12', to: '2026-10-18' },
        content: { countedMinutes: 45, weeklyTargetMinutes: 150 },
      },
      'Gewicht sinkend': weight,
      'Gewicht stabil': { ...weight, content: { changeKg: 0, direction: 'stabil' } },
      'Gewicht noch nicht verfügbar': { ...weight, content: { changeKg: null, direction: 'noch_nicht_verfuegbar' } },
    },
    invalid: {
      'absolutes Gewicht': { ...weight, content: { ...weight.content, weightKg: 79.6 } },
      'Rohdatensatz-ID': { ...water, content: { progressPercent: 64, entryIds: [projection] } },
      'fremdes Wasserziel': { ...water, content: { progressPercent: 64, waterTargetMl: 2000 } },
      'fremdes Kalorienbudget': {
        type: 'ernaehrung',
        ...envelopeBase,
        period: { type: 'tag', localDate: today },
        content: { recordedMealCategories: 2, calorieBudgetKcal: 1800 },
      },
      'fremdes Zielgewicht': { ...weight, content: { ...weight.content, goalWeightKg: 72 } },
      'Wasser über 100 %': { ...water, content: { progressPercent: 120 } },
      'Woche ab Mittwoch': {
        type: 'sport',
        ...envelopeBase,
        period: { type: 'woche', from: today, to: '2026-10-20' },
        content: { countedMinutes: 45, weeklyTargetMinutes: 150 },
      },
      'Gewicht mit zwei Nachkommastellen': { ...weight, content: { changeKg: -0.45, direction: 'sinkend' } },
      'Gewicht steigt, Richtung sinkend': { ...weight, content: { changeKg: 0.3, direction: 'sinkend' } },
      'Gewicht über 13 Tage': { ...weight, period: { type: 'vierzehn_tage', from: '2026-10-02', to: today } },
      'Wasser mit Wochenzeitraum': { ...water, period: { type: 'woche', from: '2026-10-12', to: '2026-10-18' } },
      'an sich selbst': { ...water, recipientPersonId: anna },
    },
  }),
  PartnerDailyGoalStage: fixtures(PartnerDailyGoalStage, {
    valid: { 'eine Erfüllung': 'unterwegs', 'alle drei': 'geschafft' },
    invalid: { 'exakte Zahl': '1 von 3', 'Zahl': 1 },
  }),
  PartnerDailyGoalStatus: fixtures(PartnerDailyGoalStatus, {
    valid: { 'unterwegs': status, 'noch nichts': { ...status, stage: 'noch_nichts' } },
    invalid: {
      'exakte Zahl der Erfüllungen': { ...status, completedCount: 1 },
      'Rohdatensatz-ID der Erfüllung': { ...status, dailyGoalCompletionId: projection },
      'an sich selbst': { ...status, recipientPersonId: anna },
    },
  }),
  RevocationNotice: fixtures(RevocationNotice, {
    valid: {
      'Freigabe entzogen': revocation,
      'Entkopplung': { ...revocation, target: { type: 'kopplung' }, reason: 'entkopplung' },
      'Tageszielstand nach Entkopplung': {
        ...revocation,
        target: { type: 'partner_daily_goal_status', projectionId: projection },
        reason: 'entkopplung',
      },
    },
    invalid: {
      'mit Inhalt': { ...revocation, content: { progressPercent: 64 } },
      'Freigabeentzug für den Tageszielstand': {
        ...revocation,
        target: { type: 'partner_daily_goal_status', projectionId: projection },
      },
      'unbekannter Grund': { ...revocation, reason: 'abgelaufen' },
    },
  }),
  PartnerPhotoList: fixtures(PartnerPhotoList, {
    valid: {
      'zwei Fotos': {
        photos: [
          { handle: 'ph_7Kq2mZ9xVt3LwR8b', meal: 'fruehstueck' },
          { handle: 'ph_Q4nT1sYc6HgP0eJd', meal: 'mittagessen' },
        ],
        dataAsOf: now,
      },
      'keine Fotos': { photos: [], dataAsOf: now },
    },
    invalid: {
      'Mahlzeitenfoto-ID als Handle': { photos: [{ handle: projection, meal: 'snacks' }], dataAsOf: now },
      'mit Aufnahmezeit': {
        photos: [{ handle: 'ph_7Kq2mZ9xVt3LwR8b', meal: 'fruehstueck', takenAt: now }],
        dataAsOf: now,
      },
      '13 Fotos': {
        photos: Array.from({ length: 13 }, (_, index) => ({ handle: `ph_handle_${String(index).padStart(8, '0')}`, meal: 'snacks' })),
        dataAsOf: now,
      },
      'mit kcal': { photos: [{ handle: 'ph_7Kq2mZ9xVt3LwR8b', meal: 'fruehstueck', kcal: 540 }], dataAsOf: now },
    },
  }),
  PartnerPhotoRequest: fixtures(PartnerPhotoRequest, {
    valid: {
      'Vorschau': { handle: 'ph_7Kq2mZ9xVt3LwR8b', variant: 'vorschau' },
      'vergrößert': { handle: 'ph_7Kq2mZ9xVt3LwR8b', variant: 'gross' },
    },
    invalid: { 'Original': { handle: 'ph_7Kq2mZ9xVt3LwR8b', variant: 'original' }, 'kurzes Handle': { handle: 'abc', variant: 'gross' } },
  }),
  EncouragementKey: fixtures(EncouragementKey, {
    valid: { 'Du schaffst das': 'du_schaffst_das', 'Gemeinsam für Momo': 'gemeinsam_fuer_momo' },
    invalid: { 'Freitext': 'Kleiner Stups: Trink was 💧' },
  }),
  EncouragementPushStatus: fixtures(EncouragementPushStatus, {
    valid: { 'ohne Push': 'ohne_push', 'ausstehend': 'ausstehend', 'zugestellt': 'zugestellt' },
    invalid: { 'gelesen gibt es nicht': 'gelesen' },
  }),
  SendEncouragement: fixtures(SendEncouragement, {
    valid: {
      'Stark heute': sendEncouragement,
      // Unbekannte Schlüssel lehnt erst der Server mit `unknown_catalog_key` ab.
      'unbekannter Katalogschlüssel': { ...sendEncouragement, messageKey: 'kleiner_stups' },
    },
    invalid: {
      'mit Empfänger': { ...sendEncouragement, recipientPersonId: anna },
      'Freitext': { ...sendEncouragement, messageKey: 'Kleiner Stups: Trink was 💧' },
      'ohne Zeitzone': without(sendEncouragement, 'timeZone'),
    },
  }),
  EncouragementRecord: fixtures(EncouragementRecord, {
    valid: {
      'gesendet, mit Push': encouragementRecord,
      'vierte des Tages, bedankt': { ...encouragementRecord, pushStatus: 'ohne_push', thankedAt: now },
    },
    invalid: {
      'unbekannter Schlüssel': { ...encouragementRecord, messageKey: 'kleiner_stups' },
      'ohne Danke-Feld': without(encouragementRecord, 'thankedAt'),
    },
  }),
};
