// PROTOTYP — wegwerfbar. Drei Varianten des Tabs „Momo“ = Momos Insel, umschaltbar über ?variant=A|B|C.
// Frage: Wie fühlt sich eine Spielrunde an, welche Insel-Ereignisse gibt es, kehrt Jahreszeiten-Deko wieder, darf man schenken?
// Alle Zahlen (Energiekosten, Projektgrößen, Tagesdeckel) sind Beispielwerte, nicht belegt.

const VARIANTS = { A: 'Inselkarte', B: 'Inselbuch', C: 'Panorama mit Momo' };
const SEASONS = ['Frühling', 'Sommer', 'Herbst', 'Winter'];
const SEASON_ICON = { Frühling: '🌱', Sommer: '☀️', Herbst: '🍂', Winter: '❄️' };

const PLANS = {
  weg: { name: 'Steinweg', emoji: '🪨', cost: 1, cat: 'bau', level: 1 },
  bank: { name: 'Bank', emoji: '🪑', cost: 2, cat: 'bau', level: 1 },
  huette: { name: 'Hütte', emoji: '🛖', cost: 5, cat: 'bau', level: 2 },
  laterne: { name: 'Laterne', emoji: '🏮', cost: 2, cat: 'bau', level: 3 },
  steg: { name: 'Bootssteg', emoji: '⛵', cost: 4, cat: 'bau', level: 4 },
  bruecke: { name: 'Brücke', emoji: '🌉', cost: 6, cat: 'bau', level: 5 },
  blume: { name: 'Blumenbeet', emoji: '🌷', cost: 1, cat: 'natur', level: 1 },
  baum: { name: 'Apfelbaum', emoji: '🌳', cost: 3, cat: 'natur', level: 1 },
  pilz: { name: 'Pilzkreis', emoji: '🍄', cost: 2, cat: 'natur', level: 3 },
  hase: { name: 'Hasenbau', emoji: '🐇', cost: 4, cat: 'natur', level: 4 },
  teich: { name: 'Seerosenteich', emoji: '🪷', cost: 5, cat: 'natur', level: 5 },
  // nur über Ereignisse
  brunnen: { name: 'Brunnen', emoji: '⛲', cost: 4, cat: 'bau', from: 'Besucher' },
  leuchtfeuer: { name: 'Leuchtfeuer', emoji: '🗼', cost: 5, cat: 'bau', from: 'Entdeckung' },
  palme: { name: 'Palme', emoji: '🌴', cost: 3, cat: 'natur', from: 'Entdeckung' },
};

const DECO = {
  muschel: { name: 'Muschel', emoji: '🐚' },
  flaschenpost: { name: 'Flaschenpost', emoji: '🍾' },
  treibholz: { name: 'Treibholz', emoji: '🪵' },
  bernstein: { name: 'Bernstein', emoji: '🟠' },
  sonnenblume: { name: 'Sonnenblume', emoji: '🌻' },
  kirsch: { name: 'Kirschblütenzweig', emoji: '🌸' },
  osterei: { name: 'Bemaltes Ei', emoji: '🥚' },
  schirm: { name: 'Sonnenschirm', emoji: '⛱️' },
  eis: { name: 'Eiswagen', emoji: '🍦' },
  kuerbis: { name: 'Kürbis', emoji: '🎃' },
  ahorn: { name: 'Ahornkranz', emoji: '🍁' },
  schneemann: { name: 'Schneemann', emoji: '⛄' },
  stern: { name: 'Lichterstern', emoji: '🌟' },
};
// Jahreszeiten-Deko: [Erstjahr, Folgejahr]
const SEASON_DECO = { Frühling: ['kirsch', 'osterei'], Sommer: ['schirm', 'eis'], Herbst: ['kuerbis', 'ahorn'], Winter: ['schneemann', 'stern'] };

const EVENT_TYPES = {
  besucher: 'Besucher mit Wunsch',
  fund: 'Fundstück',
  momo: 'Momos Wunsch',
  wetter: 'Inselwetter & Jahreszeit',
  entdeckung: 'Entdeckung in neuen Gebieten',
};

const ZONE_ORDER = ['eckeIch', 'bau', 'gemein', 'natur', 'eckePartner', 'nord'];

let seq = 1;
const uid = () => seq++;

function initialState() {
  return {
    day: 1, year: 2026, season: 'Herbst', level: 4, levelMe: 0.55, levelPartner: 0.4,
    me: { name: 'Du', role: 'bau', energy: 7 },
    partner: { name: 'Partnerin', role: 'natur', energy: 3 },
    momoAcc: [],
    extraPlans: [],
    inventory: [{ id: uid(), deco: 'muschel', from: 'Fundstück (Tag 0)' }],
    zones: {
      eckeIch: { title: 'Meine Ecke', owner: 'me', slots: 6, items: ['blume', 'bank'] },
      bau: { title: 'Bauen', owner: 'me', role: 'bau', slots: 8, items: ['weg', 'weg', 'huette', 'laterne'] },
      gemein: { title: 'Gemeinschaft', owner: 'both', slots: 4, items: [] },
      natur: { title: 'Natur', owner: 'partner', role: 'natur', slots: 8, items: ['baum', 'blume', 'baum', 'pilz', 'blume'] },
      eckePartner: { title: 'Ecke der Partnerin', owner: 'partner', slots: 6, items: ['pilz', 'sonnenblume'] },
      nord: { title: 'Nordstrand', owner: 'shared-roles', slots: 6, items: [], locked: true, unlockLevel: 5 },
    },
    project: { name: 'Gartenhäuschen', emoji: '🏡', bau: { need: 10, have: 4, label: 'Häuschen' }, natur: { need: 10, have: 6, label: 'Garten drumherum' } },
    projectsDone: [],
    events: [
      makeEvent('fund', 0, 'Herbst', 2026),
      { ...makeEvent('besucher', 0, 'Herbst', 2026), status: 'gesehen' },
    ],
    log: ['Tag 1: Du hast 7 Energie gespart, die Partnerin 3.'],
    settings: {
      types: { besucher: true, fund: true, momo: true, wetter: true, entdeckung: true },
      cap: 2,
      seasonRepeat: 'wiederkehrend', // | 'einmalig'
      gifting: 'deko', // 'aus' | 'deko' | 'alles'
      goalsToday: 3,
    },
    seasonOwned: [],
    pendingDiscovery: false,
    bTab: 'ereignisse',
    cStep: 0,
    sheet: null,
  };
}

function makeEvent(type, day, season, year) {
  const base = { id: uid(), type, day, status: 'neu' };
  if (type === 'besucher') {
    const visitors = [
      { emoji: '🦔', title: 'Igel Ilse ist zu Besuch', text: 'Sie wünscht sich eine Bank zum Ausruhen.', wish: { plan: 'bank' }, reward: { plan: 'brunnen' } },
      { emoji: '🦊', title: 'Fuchs Fridolin schaut vorbei', text: 'Er hätte gern eine Laterne für den Heimweg.', wish: { plan: 'laterne' }, reward: { deco: 'treibholz' } },
      { emoji: '🦢', title: 'Schwan Selma landet am Ufer', text: 'Sie wünscht sich ein Blumenbeet in der Nähe.', wish: { plan: 'blume' }, reward: { plan: 'brunnen' } },
    ];
    return { ...base, ...visitors[day % visitors.length] };
  }
  if (type === 'fund') {
    const finds = ['flaschenpost', 'treibholz', 'muschel'];
    const deco = finds[day % finds.length];
    return { ...base, emoji: DECO[deco].emoji, title: `Fundstück am Strand: ${DECO[deco].name}`, text: 'Liegt einfach da. Einsammeln kostet nichts.', reward: { deco } };
  }
  if (type === 'momo') {
    return { ...base, emoji: '🐣', title: 'Momo hat einen Wunsch', text: 'Momo möchte etwas Neues in deiner Ecke sehen – egal was.', wish: { zone: 'eckeIch' }, reward: { momo: ['🎀', '🎩', '🧣'][day % 3] } };
  }
  if (type === 'wetter') {
    return { ...base, emoji: SEASON_ICON[season], title: `${season}wetter auf der Insel`, text: 'Mit dem Wetter wird Jahreszeiten-Deko angespült.', season, year, reward: { seasonal: true } };
  }
  if (type === 'entdeckung') {
    return { ...base, emoji: '🧭', title: 'Nordstrand entdeckt', text: 'Momo hat den neuen Strand erkundet und bringt Baupläne mit.', reward: { plans: ['leuchtfeuer', 'palme'], deco: 'bernstein' } };
  }
}

let state = initialState();
const app = document.querySelector('#app');
const sheetRoot = document.querySelector('#sheet-root');

// ---------- Regeln ----------
const myPlans = () => Object.keys(PLANS).filter((id) => (PLANS[id].level && PLANS[id].level <= state.level) || state.extraPlans.includes(id));
const itemEmoji = (it) => (PLANS[it] || DECO[it] || { emoji: '❓' }).emoji;
const itemName = (it) => (PLANS[it] || DECO[it] || { name: it }).name;

function canBuildIn(zoneId, planId) {
  const z = state.zones[zoneId];
  if (!z || z.locked || z.items.length >= z.slots) return false;
  if (zoneId === 'eckeIch') return true;
  if (zoneId === 'bau' || zoneId === 'nord') return !planId || PLANS[planId]?.cat === state.me.role || !!DECO[planId];
  return false;
}
const buildZones = () => ['eckeIch', 'bau', 'nord'].filter((z) => !state.zones[z].locked);

function pendingEvents() { return state.events.filter((e) => e.status !== 'wunsch'); }
function openWishes() { return state.events.filter((e) => e.status === 'wunsch'); }

function wishMet(e) {
  if (e.wish.plan) return Object.values(state.zones).some((z) => z.owner !== 'partner' && z.items.includes(e.wish.plan));
  if (e.wish.zone) return state.zones[e.wish.zone].items.length > (e.wishBase ?? Infinity);
  return false;
}

function grant(reward, e) {
  const got = [];
  if (reward.plan) { state.extraPlans.push(reward.plan); got.push(`Bauplan ${PLANS[reward.plan].emoji} ${PLANS[reward.plan].name}`); }
  if (reward.plans) reward.plans.forEach((p) => { state.extraPlans.push(p); got.push(`Bauplan ${PLANS[p].emoji} ${PLANS[p].name}`); });
  if (reward.deco) { state.inventory.push({ id: uid(), deco: reward.deco, from: e.title }); got.push(`${DECO[reward.deco].emoji} ${DECO[reward.deco].name}`); }
  if (reward.momo) { state.momoAcc.push(reward.momo); got.push(`Accessoire ${reward.momo} für Momo`); }
  if (reward.seasonal) seasonalItems(e).forEach((d) => { state.inventory.push({ id: uid(), deco: d, from: `${e.season} ${e.year}` }); state.seasonOwned.push(d); got.push(`${DECO[d].emoji} ${DECO[d].name}`); });
  return got;
}

function seasonalItems(e) {
  const [first, second] = SEASON_DECO[e.season];
  const isFirstYear = e.year === 2026;
  if (isFirstYear) return state.seasonOwned.includes(first) ? [] : [first];
  if (state.settings.seasonRepeat === 'einmalig') return state.seasonOwned.includes(second) ? [] : [second];
  return [first, second].filter((d) => !state.seasonOwned.includes(d));
}
function seasonalPreview(e) {
  const items = seasonalItems(e);
  const [first] = SEASON_DECO[e.season];
  let note = '';
  if (e.year > 2026 && state.settings.seasonRepeat === 'einmalig' && !state.seasonOwned.includes(first)) note = `${DECO[first].emoji} ${DECO[first].name} gab es nur ${e.season} 2026 – verpasst, kommt nie wieder.`;
  if (e.year > 2026 && state.settings.seasonRepeat === 'wiederkehrend' && items.includes(first)) note = `${DECO[first].emoji} ${DECO[first].name} aus dem letzten Jahr kommt wieder – nichts verpasst.`;
  return { items, note };
}

function checkWishes() {
  openWishes().forEach((e) => {
    if (wishMet(e)) {
      const got = grant(e.reward, e);
      state.events = state.events.filter((x) => x !== e);
      toast(`${e.emoji} Wunsch erfüllt! Du bekommst ${got.join(', ')}.`);
      state.log.unshift(`Tag ${state.day}: Wunsch „${e.title}“ erfüllt → ${got.join(', ')}`);
    }
  });
}

// ---------- Aktionen ----------
function build(planOrDeco, zoneId, invId) {
  const z = state.zones[zoneId];
  if (invId) {
    state.inventory = state.inventory.filter((i) => i.id !== invId);
    z.items.push(planOrDeco);
    toast(`${itemEmoji(planOrDeco)} in „${z.title}“ platziert – kostenlos.`);
  } else {
    const p = PLANS[planOrDeco];
    if (state.me.energy < p.cost) return toast('Nicht genug Energie – kommt mit den nächsten Tageszielen.');
    state.me.energy -= p.cost;
    z.items.push(planOrDeco);
    toast(`${p.emoji} ${p.name} gebaut (−${p.cost} ⚡).`);
    state.log.unshift(`Tag ${state.day}: ${p.name} in „${z.title}“ gebaut (−${p.cost} Energie)`);
  }
  state.cStep = 2;
  checkWishes();
}

function deposit(n) {
  const share = state.project[state.me.role];
  const amount = Math.min(n, state.me.energy, share.need - share.have);
  if (amount <= 0) return toast(share.have >= share.need ? 'Dein Anteil ist schon voll.' : 'Keine Energie übrig.');
  state.me.energy -= amount; share.have += amount;
  toast(`+${amount} ⚡ in „${share.label}“ – bleibt drin, keine Frist.`);
  checkProject();
}
function checkProject() {
  const p = state.project;
  if (p.bau.have >= p.bau.need && p.natur.have >= p.natur.need) {
    state.zones.gemein.items.push('__projekt__' + p.emoji);
    state.projectsDone.push(p.name);
    toast(`${p.emoji} ${p.name} ist fertig! Steht jetzt in der Gemeinschaft.`);
    state.log.unshift(`Tag ${state.day}: Gemeinschaftsprojekt ${p.name} fertig`);
    state.project = { name: 'Brücke zum Nordstrand', emoji: '🌉', bau: { need: 14, have: 0, label: 'Brückenbogen' }, natur: { need: 14, have: 0, label: 'Ranken & Blumen' } };
  }
}

const giftable = () => state.settings.gifting !== 'aus';
function gift(invId) {
  const it = state.inventory.find((i) => i.id === invId);
  state.inventory = state.inventory.filter((i) => i.id !== invId);
  state.zones.eckePartner.items.push(it.deco); // Geschenk landet immer an, nie verloren
  toast(`🎁 ${DECO[it.deco].name} an die Partnerin verschenkt.`);
  state.log.unshift(`Tag ${state.day}: ${DECO[it.deco].name} verschenkt`);
}
function giftBuilt(zoneId, idx) {
  const z = state.zones[zoneId];
  const [it] = z.items.splice(idx, 1);
  state.zones.eckePartner.items.push(it);
  toast(`🎁 ${itemName(it)} (mit Energie gebaut) an die Partnerin verschenkt.`);
}

function nextDay() {
  const s = state.settings;
  state.day += 1;
  const earned = s.goalsToday + (s.goalsToday === 3 ? 1 : 0);
  const partnerEarned = [4, 2, 3, 0, 4][state.day % 5];
  state.me.energy += earned; state.partner.energy += partnerEarned;
  state.levelMe = Math.min(1, state.levelMe + earned * 0.04); state.levelPartner = Math.min(1, state.levelPartner + partnerEarned * 0.04);
  // neue Ereignisse, gedeckelt pro Tag
  const pool = Object.keys(s.types).filter((t) => s.types[t] && t !== 'entdeckung');
  const fresh = [];
  if (state.pendingDiscovery && s.types.entdeckung) { fresh.push(makeEvent('entdeckung', state.day, state.season, state.year)); state.pendingDiscovery = false; }
  for (let i = 0; fresh.length < s.cap && i < pool.length; i++) {
    const t = pool[(state.day + i) % pool.length];
    if (t === 'wetter' && state.events.some((e) => e.type === 'wetter' && e.season === state.season && e.year === state.year)) continue;
    if (t === 'momo' && state.events.some((e) => e.type === 'momo')) continue;
    fresh.push(makeEvent(t, state.day, state.season, state.year));
  }
  state.events.push(...fresh);
  state.cStep = 0;
  state.log.unshift(`Tag ${state.day}: +${earned} Energie (${s.goalsToday} Ziele${s.goalsToday === 3 ? ' + Tagesbonus' : ''}), ${fresh.length} neue Ereignisse`);
  toast(`Neuer Tag: +${earned} ⚡, ${fresh.length} neue${fresh.length === 1 ? 's' : ''} Ereignis${fresh.length === 1 ? '' : 'se'}.`);
}

function nextSeason() {
  const i = SEASONS.indexOf(state.season);
  state.season = SEASONS[(i + 1) % 4];
  if (state.season === 'Frühling') state.year += 1;
  toast(`${SEASON_ICON[state.season]} ${state.season} ${state.year}`);
}
function yearLater() {
  state.year += 1;
  toast(`Ein Jahr später: ${state.season} ${state.year}`);
}

function levelUp() {
  state.level += 1; state.levelMe = 0.1; state.levelPartner = 0.05;
  const newPlans = Object.keys(PLANS).filter((p) => PLANS[p].level === state.level);
  const n = state.zones.nord;
  let msg = `Level ${state.level}! Neue Baupläne: ${newPlans.map((p) => PLANS[p].emoji + ' ' + PLANS[p].name).join(', ') || '–'}`;
  if (n.locked && state.level >= n.unlockLevel) { n.locked = false; state.pendingDiscovery = true; msg += ' · Neues Gebiet: Nordstrand'; }
  toast(msg);
  state.log.unshift(`Tag ${state.day}: ${msg}`);
}

function partnerPlays() {
  const p = state.partner;
  const share = state.project.natur;
  if (p.energy >= 2 && state.zones.natur.items.length < 8) { p.energy -= 2; state.zones.natur.items.push(['blume', 'baum', 'pilz'][state.day % 3]); }
  const put = Math.min(p.energy, share.need - share.have, 3); p.energy -= put; share.have += put;
  checkProject();
  toast('Die Partnerin hat gespielt: etwas gepflanzt und ins Projekt eingezahlt.');
}
function partnerGift() {
  state.inventory.push({ id: uid(), deco: 'sonnenblume', from: 'Geschenk der Partnerin' });
  toast('🎁 Die Partnerin hat dir eine Sonnenblume geschenkt.');
}

// ---------- Darstellung: gemeinsame Bausteine ----------
const energyChip = () => `<span class="energy" title="Persönliche Energie – verfällt nie">⚡ ${state.me.energy}</span>`;
const momoFig = (size = 'big') => `<div class="momo momo--${size}"><span>🐣</span>${state.momoAcc.length ? `<i>${state.momoAcc.at(-1)}</i>` : ''}</div>`;
const levelbar = () => `
  <div class="levelbar" aria-label="Gemeinsamer Levelbalken"><div class="levelbar__half"><i style="width:${state.levelMe * 100}%"></i></div><div class="levelbar__half levelbar__half--partner"><i style="width:${state.levelPartner * 100}%"></i></div></div>
  <div class="levelbar__legend"><b>Level ${state.level}</b><span>Du · Partnerin</span></div>`;

function zoneItems(zoneId, { clickable = true } = {}) {
  const z = state.zones[zoneId];
  if (z.locked) return `<div class="zone__fog">🌫️ ab Level ${z.unlockLevel}</div>`;
  const cells = z.items.map((it, idx) => it.startsWith('__projekt__') ? `<span class="cell cell--project">${it.slice(11)}</span>` : `<button class="cell" data-action="item" data-zone="${zoneId}" data-idx="${idx}" ${z.owner === 'partner' ? 'disabled' : ''}>${itemEmoji(it)}</button>`);
  const mine = clickable && canBuildIn(zoneId);
  for (let i = z.items.length; i < z.slots; i++) cells.push(mine ? `<button class="cell cell--empty" data-action="open-build" data-zone="${zoneId}" aria-label="Hier bauen">＋</button>` : '<span class="cell cell--void"></span>');
  return `<div class="cells">${cells.join('')}</div>`;
}

function projectCard(compact) {
  const p = state.project;
  const pct = (s) => Math.round((s.have / s.need) * 100);
  return `
  <div class="project ${compact ? 'project--compact' : ''}" >
    <div class="project__head"><span class="project__emoji">${p.emoji}</span><div><b>${p.name}</b><small>Gemeinschaftsprojekt · ohne Frist</small></div></div>
    <div class="share"><span>🔨 ${p.bau.label}</span><div class="bar"><i style="width:${pct(p.bau)}%"></i></div><small>${p.bau.have}/${p.bau.need}</small></div>
    <div class="share share--partner"><span>🌿 ${p.natur.label}</span><div class="bar"><i style="width:${pct(p.natur)}%"></i></div><small>${p.natur.have}/${p.natur.need}</small></div>
    <button class="soft" data-action="open-project">Energie einzahlen</button>
  </div>`;
}

function eventRow(e) {
  const wish = e.status === 'wunsch';
  return `<button class="event ${e.status === 'neu' ? 'event--new' : ''}" data-action="open-event" data-id="${e.id}">
    <span class="event__emoji">${e.emoji}</span>
    <span class="event__text"><b>${e.title}</b><small>${wish ? (wishMet(e) ? 'Erfüllbar!' : 'Offener Wunsch · bleibt, bis du magst') : `${EVENT_TYPES[e.type]} · seit Tag ${e.day || 1}`}</small></span>
    ${e.status === 'neu' ? '<span class="dot">neu</span>' : ''}
  </button>`;
}

function inventoryList() {
  if (!state.inventory.length) return '<p class="muted">Lager leer. Fundstücke und Ereignis-Deko landen hier.</p>';
  return `<div class="inv">${state.inventory.map((i) => `<button class="inv__item" data-action="open-inv" data-id="${i.id}"><span>${DECO[i.deco].emoji}</span><small>${DECO[i.deco].name}</small></button>`).join('')}</div>`;
}

function tabbar() {
  return `<nav class="tabs">${[['🏠', 'Heute'], ['📋', 'Protokoll'], ['＋', ''], ['🏝️', 'Momo'], ['💞', 'Wir']].map(([i, l]) => `<button class="${l === 'Momo' ? 'active' : ''} ${i === '＋' ? 'plus' : ''}" data-action="noop"><i>${i}</i>${l}</button>`).join('')}</nav>`;
}

// ---------- Variante A: Inselkarte ----------
function renderA() {
  const ev = pendingEvents();
  const wishes = openWishes();
  const zone = (id, cls = '') => {
    const z = state.zones[id];
    return `<section class="zone zone--${id} ${cls}"><header>${z.title}${z.role ? ` <small>${z.role === 'bau' ? '🔨 deine Rolle' : '🌿 Rolle Partnerin'}</small>` : ''}</header>${zoneItems(id)}</section>`;
  };
  return `<div class="screen">
    <div class="a-top">
      <div><p class="eyebrow">${SEASON_ICON[state.season]} ${state.season} ${state.year} · Tag ${state.day}</p><h1>Momos Insel</h1></div>
      ${energyChip()}
    </div>
    <div class="scroll a-sea">
      ${zone('nord', 'zone--wide')}
      <div class="a-grid">
        ${zone('eckeIch')}
        <section class="zone zone--gemein"><header>Gemeinschaft</header>${projectCard(true)}${state.zones.gemein.items.length ? zoneItems('gemein', { clickable: false }) : ''}</section>
        ${zone('eckePartner')}
        ${zone('bau')}
        <section class="zone zone--momo"><header>Lichtung</header>${momoFig('big')}${levelbar()}</section>
        ${zone('natur')}
      </div>
      <section class="a-beach">
        <header>Strand · ${ev.length} Ereignis${ev.length === 1 ? '' : 'se'} warten <small>(verfallen nie)</small></header>
        <div class="a-beach__row">${ev.map((e) => `<button class="marker ${e.status === 'neu' ? 'marker--new' : ''}" data-action="open-event" data-id="${e.id}" title="${e.title}">${e.emoji}</button>`).join('') || '<span class="muted">Ruhig heute.</span>'}
        </div>
        ${wishes.length ? `<div class="a-wishes">${wishes.map(eventRow).join('')}</div>` : ''}
      </section>
      <button class="ghost" data-action="open-inventory">🎒 Lager (${state.inventory.length})</button>
    </div>
    ${tabbar()}
  </div>`;
}

// ---------- Variante B: Inselbuch ----------
function renderB() {
  const tabs = [['ereignisse', `Ereignisse (${pendingEvents().length})`], ['bauen', 'Bauen'], ['projekt', 'Projekt'], ['lager', `Lager (${state.inventory.length})`]];
  const strip = ZONE_ORDER.map((id) => {
    const z = state.zones[id];
    if (z.locked) return '<span class="b-strip__z b-strip__z--fog">🌫️</span>';
    const items = id === 'gemein' ? [state.project.emoji] : z.items.slice(0, 4).map(itemEmoji);
    return `<span class="b-strip__z b-strip__z--${id}">${items.join('')}</span>`;
  }).join('');
  let body = '';
  if (state.bTab === 'ereignisse') {
    const ev = pendingEvents(), w = openWishes();
    body = `${ev.length ? `<h2>Neu auf der Insel</h2>${ev.map(eventRow).join('')}` : '<p class="muted">Gerade nichts Neues. Ereignisse kommen mit neuen Tagen – höchstens ${state.settings.cap} pro Tag.</p>'}
      ${w.length ? `<h2>Offene Wünsche</h2>${w.map(eventRow).join('')}` : ''}`;
  } else if (state.bTab === 'bauen') {
    body = `<h2>Baupläne</h2><p class="muted">Deine Rolle: 🔨 Bauen. Natur-Pläne gehen nur in deine Ecke.</p>
      <div class="plans">${myPlans().map((id) => planRow(id)).join('')}</div>`;
  } else if (state.bTab === 'projekt') {
    body = `${projectCard(false)}${state.projectsDone.length ? `<p class="muted">Fertig: ${state.projectsDone.join(', ')}</p>` : ''}`;
  } else {
    body = `<h2>Lager</h2>${inventoryList()}<p class="muted">${giftNote()}</p>`;
  }
  return `<div class="screen">
    <div class="b-head">
      <div class="b-head__row"><div><p class="eyebrow">${SEASON_ICON[state.season]} ${state.season} · Tag ${state.day}</p><h1>Inselbuch</h1></div>${momoFig('small')}${energyChip()}</div>
      <div class="b-strip">${strip}</div>
      ${levelbar()}
    </div>
    <div class="b-seg">${tabs.map(([k, l]) => `<button class="${state.bTab === k ? 'active' : ''}" data-action="b-tab" data-tab="${k}">${l}</button>`).join('')}</div>
    <div class="scroll">${body}</div>
    ${tabbar()}
  </div>`;
}
function planRow(id) {
  const p = PLANS[id];
  const ok = state.me.energy >= p.cost;
  return `<button class="plan" data-action="pick-plan" data-plan="${id}" ${ok ? '' : 'aria-disabled="true"'}>
    <span class="plan__emoji">${p.emoji}</span><span class="plan__text"><b>${p.name}</b><small>${p.cat === 'bau' ? '🔨 Bauen' : '🌿 Natur'}${p.from ? ` · aus ${p.from}` : ''}</small></span><span class="cost ${ok ? '' : 'cost--short'}">${p.cost} ⚡</span></button>`;
}
function giftNote() {
  return { aus: 'Schenken ist ausgeschaltet.', deko: 'Fundstücke und Ereignis-Deko kann man verschenken – Energie und mit Energie Gebautes nicht.', alles: 'Alles verschenkbar, auch mit Energie Gebautes. Energie selbst nie.' }[state.settings.gifting];
}

// ---------- Variante C: Panorama mit Momo ----------
function momoSays() {
  const ev = pendingEvents();
  const metWish = openWishes().find(wishMet);
  if (metWish) return `Oh! ${metWish.emoji} Der Wunsch ist erfüllbar.`;
  if (state.cStep === 0 && ev.length) return `Schau mal, ${ev.length} ${ev.length === 1 ? 'Sache wartet' : 'Sachen warten'} am Strand!`;
  if (state.me.energy >= 1 && state.cStep < 2) return `Du hast ${state.me.energy} Energie. Wollen wir etwas bauen?`;
  if (state.cStep >= 2) return 'Schön geworden! Morgen gibt’s neue Energie. 💚';
  return 'Heute ist es ruhig. Du kannst dich einfach umsehen.';
}
function renderC() {
  const steps = [['Neues', pendingEvents().length], ['Bauen', null], ['Ansehen', null]];
  const panel = (id) => {
    const z = state.zones[id];
    const extra = id === 'gemein' ? projectCard(false) : '';
    return `<section class="c-panel c-panel--${id}"><header><b>${z.title}</b>${z.role ? `<small>${z.role === 'bau' ? '🔨 deine Rolle' : '🌿 Rolle Partnerin'}</small>` : ''}${z.owner === 'partner' ? '<small>nur ansehen</small>' : ''}</header>${extra}${id !== 'gemein' || z.items.length ? zoneItems(id) : ''}</section>`;
  };
  return `<div class="screen">
    <div class="c-head">
      <div class="c-momo">${momoFig('big')}<div class="bubble">${momoSays()}</div></div>
      <div class="c-meta"><span>${SEASON_ICON[state.season]} ${state.season} · Tag ${state.day}</span>${energyChip()}</div>
      ${levelbar()}
    </div>
    <div class="c-pano">${ZONE_ORDER.map(panel).join('')}</div>
    <div class="c-dots">${ZONE_ORDER.map((id) => `<span>${state.zones[id].title.split(' ')[0]}</span>`).join(' · ')} → wischen</div>
    <div class="c-round">${steps.map(([l, n], i) => `<button class="${state.cStep === i ? 'active' : ''}" data-action="c-step" data-step="${i}"><b>${i + 1}</b>${l}${n ? ` <span class="dot">${n}</span>` : ''}</button>`).join('')}</div>
    ${tabbar()}
  </div>`;
}

// ---------- Sheets ----------
function renderSheet() {
  const s = state.sheet;
  if (!s) return '';
  let inner = '';
  if (s.type === 'event') {
    const e = state.events.find((x) => x.id === s.id);
    if (!e) { state.sheet = null; return ''; }
    if (e.status === 'neu') e.status = 'gesehen';
    let reward = '';
    if (e.reward.seasonal) {
      const { items, note } = seasonalPreview(e);
      reward = `${items.length ? items.map((d) => `${DECO[d].emoji} ${DECO[d].name}`).join(', ') : 'nichts Neues – alles schon gesammelt'}${note ? `<p class="note">${note}</p>` : ''}`;
    } else {
      const r = e.reward;
      reward = [r.plan && `Bauplan ${PLANS[r.plan].emoji} ${PLANS[r.plan].name}`, r.plans && r.plans.map((p) => `Bauplan ${PLANS[p].emoji} ${PLANS[p].name}`).join(', '), r.deco && `${DECO[r.deco].emoji} ${DECO[r.deco].name}`, r.momo && `Accessoire ${r.momo} für Momo`].filter(Boolean).join(', ');
    }
    const actions = e.wish
      ? (e.status === 'wunsch'
        ? (wishMet(e) ? '<button class="primary" data-action="fulfil">Wunsch erfüllen</button>' : `<p class="muted">Noch offen: ${e.wish.plan ? `${PLANS[e.wish.plan].emoji} ${PLANS[e.wish.plan].name} bauen (Ecke oder Bauen-Bereich)` : 'irgendetwas in deine Ecke stellen'}. Kein Zeitdruck.</p>${e.wish.plan && canAfford(e.wish.plan) ? `<button class="primary" data-action="pick-plan" data-plan="${e.wish.plan}">${PLANS[e.wish.plan].name} jetzt bauen (${PLANS[e.wish.plan].cost} ⚡)</button>` : ''}`)
        : `${wishMet(e) ? '<button class="primary" data-action="fulfil">Wunsch sofort erfüllen</button>' : '<button class="primary" data-action="accept-wish">Wunsch merken</button>'}<button class="ghost wide" data-action="close">Später ansehen</button>`)
      : `<button class="primary" data-action="collect">Einsammeln</button><button class="ghost wide" data-action="close">Liegen lassen</button>`;
    inner = `<div class="sheet__emoji">${e.emoji}</div><p class="eyebrow">${EVENT_TYPES[e.type]}</p><h2>${e.title}</h2><p>${e.text}</p>
      <p class="reward"><b>Belohnung:</b> ${reward}</p>${actions}
      <p class="fine">Ansehen kostet keine Energie. Nichts verfällt.</p>`;
  } else if (s.type === 'build') {
    if (!s.plan) {
      const zoneTitle = s.zone ? state.zones[s.zone].title : '';
      const plans = myPlans().filter((id) => !s.zone || canBuildIn(s.zone, id));
      const decos = s.zone ? state.inventory : [];
      inner = `<p class="eyebrow">Bauen${zoneTitle ? ' in „' + zoneTitle + '“' : ''}</p><h2>${s.zone ? 'Was soll hierhin?' : 'Was willst du bauen?'}</h2>
        <p class="muted">Du hast ${state.me.energy} ⚡.</p>
        <div class="plans">${plans.map(planRow).join('')}</div>
        ${decos.length ? `<h3>Aus dem Lager (kostenlos)</h3><div class="inv">${decos.map((i) => `<button class="inv__item" data-action="place-inv" data-id="${i.id}"><span>${DECO[i.deco].emoji}</span><small>${DECO[i.deco].name}</small></button>`).join('')}</div>` : ''}`;
    } else if (!s.zone) {
      const zs = buildZones().filter((z) => canBuildIn(z, s.plan));
      inner = `<p class="eyebrow">${PLANS[s.plan].emoji} ${PLANS[s.plan].name} · ${PLANS[s.plan].cost} ⚡</p><h2>Wohin?</h2>
        ${zs.map((z) => `<button class="plan" data-action="pick-zone" data-zone="${z}"><span class="plan__emoji">${z === 'eckeIch' ? '🏡' : z === 'nord' ? '🏖️' : '🔨'}</span><span class="plan__text"><b>${state.zones[z].title}</b><small>${state.zones[z].items.length}/${state.zones[z].slots} belegt</small></span></button>`).join('') || '<p class="muted">Kein freier Platz.</p>'}`;
    }
  } else if (s.type === 'project') {
    inner = `${projectCard(false).replace('<button class="soft" data-action="open-project">Energie einzahlen</button>', '')}
      <p class="muted">Du füllst nur deinen Anteil (🔨). Eingezahltes bleibt für immer.</p>
      <div class="row"><button class="soft" data-action="deposit" data-n="1">+1 ⚡</button><button class="soft" data-action="deposit" data-n="3">+3 ⚡</button><button class="soft" data-action="deposit" data-n="99">Alles</button></div>`;
  } else if (s.type === 'inventory') {
    inner = `<h2>🎒 Lager</h2>${inventoryList()}<p class="muted">${giftNote()}</p>`;
  } else if (s.type === 'inv') {
    const it = state.inventory.find((i) => i.id === s.id);
    if (!it) { state.sheet = null; return ''; }
    inner = `<div class="sheet__emoji">${DECO[it.deco].emoji}</div><h2>${DECO[it.deco].name}</h2><p class="muted">Herkunft: ${it.from}</p>
      ${buildZones().filter((z) => canBuildIn(z, it.deco)).map((z) => `<button class="soft wide" data-action="place-inv-in" data-zone="${z}">In „${state.zones[z].title}“ stellen</button>`).join('')}
      ${giftable(it) ? '<button class="soft wide gift" data-action="gift">🎁 Der Partnerin schenken</button>' : '<p class="fine">Schenken ist im Prototyp gerade ausgeschaltet.</p>'}`;
  } else if (s.type === 'item') {
    const z = state.zones[s.zone];
    const it = z.items[s.idx];
    const built = !!PLANS[it];
    inner = `<div class="sheet__emoji">${itemEmoji(it)}</div><h2>${itemName(it)}</h2><p class="muted">Steht in „${z.title}“.${built ? ' Mit Energie gebaut.' : ' Deko.'}</p>
      ${state.settings.gifting === 'alles' || (!built && state.settings.gifting === 'deko') ? '<button class="soft wide gift" data-action="gift-built">🎁 Der Partnerin schenken</button>' : `<p class="fine">${built ? 'Mit Energie Gebautes kann man in dieser Einstellung nicht verschenken (wäre indirekt übertragene Energie).' : 'Schenken ist ausgeschaltet.'}</p>`}`;
  }
  return `<div class="sheet-backdrop" data-action="close"></div><div class="sheet" role="dialog"><button class="sheet__close" data-action="close" aria-label="Schließen">✕</button>${inner}</div>`;
}
const canAfford = (p) => state.me.energy >= PLANS[p].cost;

// ---------- Labor ----------
function renderLab() {
  const s = state.settings;
  const radio = (name, val, label) => `<label><input type="radio" name="${name}" value="${val}" ${s[name] === val ? 'checked' : ''}> ${label}</label>`;
  return `
    <p class="lab__hint">Zeit vergehen lassen</p>
    <label class="lab__inline">Heute erfüllte Tagesziele: <select data-setting="goalsToday">${[0, 1, 2, 3].map((n) => `<option ${s.goalsToday === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <div class="lab__actions">
      <button data-sim="day">Nächster Tag</button>
      <button data-sim="partner">Partnerin spielt</button>
      <button data-sim="level">Levelaufstieg</button>
      <button data-sim="partner-gift">Partnerin schenkt</button>
      <button data-sim="season">Nächste Jahreszeit</button>
      <button data-sim="year">+1 Jahr</button>
      <button data-sim="reset">Zurücksetzen</button>
    </div>
    <p class="lab__hint">Ereignistypen (Kandidaten)</p>
    <div class="lab__checks">${Object.entries(EVENT_TYPES).map(([k, l]) => `<label><input type="checkbox" data-type="${k}" ${s.types[k] ? 'checked' : ''}> ${l}</label>`).join('')}</div>
    <label class="lab__inline">Neue Ereignisse pro Tag höchstens: <select data-setting="cap">${[1, 2, 3].map((n) => `<option ${s.cap === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <p class="lab__hint">Offene Frage: Jahreszeiten-Deko im Folgejahr</p>
    <div class="lab__checks">${radio('seasonRepeat', 'wiederkehrend', 'kommt wieder (Verpasstes nachholen)')}${radio('seasonRepeat', 'einmalig', 'einmalig (pro Jahr eigene Deko)')}</div>
    <p class="lab__hint">Offene Frage: Schenken</p>
    <div class="lab__checks">${radio('gifting', 'aus', 'aus')}${radio('gifting', 'deko', 'nur Fundstücke/Ereignis-Deko')}${radio('gifting', 'alles', 'auch mit Energie Gebautes')}</div>
    <details><summary>Verlauf</summary><pre>${state.log.slice(0, 12).join('\n')}</pre></details>
    <details><summary>Vollständiger Zustand</summary><pre>${JSON.stringify({ ...state, sheet: undefined, log: undefined }, null, 1)}</pre></details>`;
}

// ---------- Rendering & Events ----------
const params = new URLSearchParams(location.search);
let variant = VARIANTS[params.get('variant')] ? params.get('variant') : 'A';

function render() {
  app.innerHTML = { A: renderA, B: renderB, C: renderC }[variant]();
  app.className = `v-${variant}`;
  sheetRoot.innerHTML = renderSheet();
  document.querySelector('#lab-body').innerHTML = renderLab();
  document.querySelector('#variant-label').textContent = `${variant} — ${VARIANTS[variant]}`;
}

function setVariant(v) {
  variant = v;
  const u = new URL(location.href); u.searchParams.set('variant', v); history.replaceState(null, '', u);
  state.sheet = null; render();
}
const keys = Object.keys(VARIANTS);
const cycle = (d) => setVariant(keys[(keys.indexOf(variant) + d + keys.length) % keys.length]);
document.querySelector('#previous').onclick = () => cycle(-1);
document.querySelector('#next').onclick = () => cycle(1);
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select, [contenteditable]')) return;
  if (e.key === 'ArrowLeft') cycle(-1);
  if (e.key === 'ArrowRight') cycle(1);
  if (e.key === 'Escape') { state.sheet = null; render(); }
});

document.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-action], [data-sim]');
  if (!t) return;
  const a = t.dataset.action;
  const s = state.sheet;
  if (t.dataset.sim) {
    ({ day: nextDay, partner: partnerPlays, level: levelUp, 'partner-gift': partnerGift, season: nextSeason, year: yearLater, reset: () => { state = initialState(); toast('Zurückgesetzt.'); } })[t.dataset.sim]();
    return render();
  }
  switch (a) {
    case 'close': state.sheet = null; break;
    case 'open-event': state.sheet = { type: 'event', id: +t.dataset.id }; break;
    case 'open-build': state.sheet = { type: 'build', zone: t.dataset.zone }; break;
    case 'open-project': state.sheet = { type: 'project' }; break;
    case 'open-inventory': state.sheet = { type: 'inventory' }; break;
    case 'open-inv': state.sheet = { type: 'inv', id: +t.dataset.id }; break;
    case 'item': state.sheet = { type: 'item', zone: t.dataset.zone, idx: +t.dataset.idx }; break;
    case 'b-tab': state.bTab = t.dataset.tab; break;
    case 'c-step': {
      state.cStep = +t.dataset.step;
      if (state.cStep === 0) { const e = pendingEvents()[0]; e ? (state.sheet = { type: 'event', id: e.id }) : toast('Gerade nichts Neues.'); }
      if (state.cStep === 1) state.sheet = { type: 'build' };
      if (state.cStep === 2) document.querySelector('.c-pano')?.scrollTo({ left: 0, behavior: 'smooth' });
      break;
    }
    case 'pick-plan': {
      const plan = t.dataset.plan;
      if (!canAfford(plan)) { toast(`${PLANS[plan].name} kostet ${PLANS[plan].cost} ⚡ – du hast ${state.me.energy}. Energie verfällt nicht, einfach sammeln.`); break; }
      const zone = s?.type === 'build' ? s.zone : null;
      if (zone) { build(plan, zone); state.sheet = null; } else state.sheet = { type: 'build', plan };
      break;
    }
    case 'pick-zone': build(s.plan, t.dataset.zone); state.sheet = null; break;
    case 'place-inv': { const it = state.inventory.find((i) => i.id === +t.dataset.id); build(it.deco, s.zone, it.id); state.sheet = null; break; }
    case 'place-inv-in': { const it = state.inventory.find((i) => i.id === s.id); build(it.deco, t.dataset.zone, it.id); state.sheet = null; break; }
    case 'gift': gift(s.id); state.sheet = null; break;
    case 'gift-built': giftBuilt(s.zone, s.idx); state.sheet = null; break;
    case 'deposit': deposit(+t.dataset.n); break;
    case 'accept-wish': {
      const e = state.events.find((x) => x.id === s.id);
      e.status = 'wunsch'; if (e.wish.zone) e.wishBase = state.zones[e.wish.zone].items.length;
      toast('Wunsch gemerkt. Er wartet, bis du ihn erfüllst.'); state.sheet = null; break;
    }
    case 'fulfil': case 'collect': {
      const e = state.events.find((x) => x.id === s.id);
      const got = grant(e.reward, e);
      state.events = state.events.filter((x) => x !== e);
      toast(got.length ? `Erhalten: ${got.join(', ')}` : 'Angesehen – nichts Neues dabei.');
      state.log.unshift(`Tag ${state.day}: ${e.title} → ${got.join(', ') || 'nichts Neues'}`);
      state.sheet = null; state.cStep = Math.max(state.cStep, 1); break;
    }
    case 'noop': toast('Andere Tabs sind im Prototyp Platzhalter.'); break;
  }
  render();
});

document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.dataset.type) state.settings.types[t.dataset.type] = t.checked;
  else if (t.dataset.setting) state.settings[t.dataset.setting] = +t.value;
  else if (t.name) state.settings[t.name] = t.value;
  render();
});

document.querySelector('#lab-toggle').onclick = () => {
  const lab = document.querySelector('#lab');
  lab.classList.toggle('collapsed');
  document.querySelector('#lab-toggle').setAttribute('aria-expanded', !lab.classList.contains('collapsed'));
};

let toastTimer;
function toast(msg) {
  const el = document.querySelector('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

render();
