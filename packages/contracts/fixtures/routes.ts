import { RouteName, RouteTarget, routeParams, UiActionIntent } from '../src/routes.ts';
import { fixtures } from './define.ts';
import { challenge, sharedEvent, suggestion, today } from './ids.ts';

const withoutParams = (route: keyof typeof routeParams) =>
  fixtures(routeParams[route], { valid: { 'ohne Parameter': {} }, invalid: { 'unbekannter Parameter': { id: 1 } } });

const newEntry = (route: 'capture.sport' | 'capture.weight') =>
  fixtures(routeParams[route], {
    valid: { 'Liste': {}, 'neuer Eintrag': { newEntry: true } },
    invalid: { 'newEntry false': { newEntry: false }, 'als Text': { newEntry: 'true' } },
  });

export const routeFixtures = {
  RouteName: fixtures(RouteName, {
    valid: { 'Tab': 'today', 'Erfassung': 'capture.food' },
    invalid: { 'unbekannt': 'capture.steps', 'Pfad': '/today' },
  }),
  'routeParams.today': withoutParams('today'),
  'routeParams.log': withoutParams('log'),
  'routeParams.capture.food': fixtures(routeParams['capture.food'], {
    valid: { 'ohne Vorgabe': {}, 'Mahlzeit und Tag': { meal: 'mittagessen', localDate: today } },
    invalid: { 'unbekannte Mahlzeit': { meal: 'brunch' }, 'Tag als Zeitpunkt': { localDate: '2026-10-14T12:00:00Z' } },
  }),
  'routeParams.capture.water': withoutParams('capture.water'),
  'routeParams.capture.sport': newEntry('capture.sport'),
  'routeParams.capture.weight': newEntry('capture.weight'),
  'routeParams.momo': fixtures(routeParams.momo, {
    valid: { 'Insel': {}, 'Projekt': { view: 'projekt' }, 'Ereignis': { view: 'ereignisse', eventId: sharedEvent } },
    invalid: { 'unbekannte Ansicht': { view: 'shop' }, 'Ereignis ohne UUID': { eventId: 'besuch-1' } },
  }),
  'routeParams.challenge.propose': withoutParams('challenge.propose'),
  'routeParams.challenge.detail': fixtures(routeParams['challenge.detail'], {
    valid: { 'Challenge': { challengeId: challenge } },
    invalid: { 'ohne Challenge': {} },
  }),
  'routeParams.partner': fixtures(routeParams.partner, {
    valid: { 'Wir': {}, 'erhaltene Anfeuerung': { focus: 'received_encouragement' } },
    invalid: { 'unbekannter Fokus': { focus: 'photos' } },
  }),
  'routeParams.partner.invite': withoutParams('partner.invite'),
  'routeParams.partner.redeem': withoutParams('partner.redeem'),
  'routeParams.partner.encourage': withoutParams('partner.encourage'),
  'routeParams.notifications.permission': withoutParams('notifications.permission'),
  'routeParams.settings': fixtures(routeParams.settings, {
    valid: { 'Übersicht': {}, 'Partner & Freigaben': { section: 'partner_sharing' } },
    invalid: { 'unbekannter Abschnitt': { section: 'privacy' } },
  }),
  'routeParams.onboarding': withoutParams('onboarding'),
  'routeParams.plan.budget_suggestion': fixtures(routeParams['plan.budget_suggestion'], {
    valid: { 'Vorschlag': { suggestionId: suggestion } },
    invalid: { 'ohne Vorschlag': {} },
  }),
  'routeParams.plan.goal_reached': withoutParams('plan.goal_reached'),
  RouteTarget: fixtures(RouteTarget, {
    valid: {
      'ohne Parameter': { type: 'today' },
      'mit Parametern': { type: 'capture.weight', newEntry: true },
      'Pflichtparameter': { type: 'challenge.detail', challengeId: challenge },
    },
    invalid: {
      'unbekannte Route': { type: 'capture.steps' },
      'fremder Parameter': { type: 'today', view: 'projekt' },
      'Pflichtparameter fehlt': { type: 'plan.budget_suggestion' },
    },
  }),
  UiActionIntent: fixtures(UiActionIntent, {
    valid: {
      'Einstellungen': { actionId: 'open_settings', target: { type: 'settings' } },
      'Projekt': { actionId: 'momo.open_project', target: { type: 'momo', view: 'projekt' } },
    },
    invalid: {
      'ohne actionId': { target: { type: 'today' } },
      'sichtbarer Text als actionId': { actionId: 'Einstellungen öffnen', target: { type: 'settings' } },
      'Ziel als Pfad': { actionId: 'open_settings', target: '/settings' },
    },
  }),
};
