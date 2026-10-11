// PROTOTYP — wegwerfbar. Runde 2: Momos Insel als ansprechende Inselansicht in drei Stilen (?variant=A|B|C).
// Neu nach Nutzer-Feedback: Momo levelt durch Bauen/Pflanzen (verbaute Energie, 50/50), nicht direkt durch Tagesziele.
// Festgelegt: Jahreszeiten-Deko kommt wieder; verschenkbar sind nur Fundstücke/Deko.
// Alle Zahlen (Energiekosten, Levelbedarf, Projektgrößen, Tagesdeckel) sind Beispielwerte, nicht belegt.

const VARIANTS = { A: 'Isometrisches Diorama', B: 'Illustrierte Karte', C: '3D Low-Poly' };
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
  brunnen: { name: 'Brunnen', emoji: '⛲', cost: 4, cat: 'bau', from: 'Besucher' },
  leuchtfeuer: { name: 'Leuchtfeuer', emoji: '🗼', cost: 5, cat: 'bau', from: 'Entdeckung' },
  palme: { name: 'Palme', emoji: '🌴', cost: 3, cat: 'natur', from: 'Entdeckung' },
  gartenhaus: { name: 'Gartenhäuschen', emoji: '🏡', cost: 0, cat: 'projekt', hidden: true },
};

const DECO = {
  muschel: { name: 'Muschel', emoji: '🐚' }, flaschenpost: { name: 'Flaschenpost', emoji: '🍾' }, treibholz: { name: 'Treibholz', emoji: '🪵' },
  bernstein: { name: 'Bernstein', emoji: '🟠' }, sonnenblume: { name: 'Sonnenblume', emoji: '🌻' },
  kirsch: { name: 'Kirschblütenzweig', emoji: '🌸' }, osterei: { name: 'Bemaltes Ei', emoji: '🥚' },
  schirm: { name: 'Sonnenschirm', emoji: '⛱️' }, eis: { name: 'Eiswagen', emoji: '🍦' },
  kuerbis: { name: 'Kürbis', emoji: '🎃' }, ahorn: { name: 'Ahornkranz', emoji: '🍁' },
  schneemann: { name: 'Schneemann', emoji: '⛄' }, stern: { name: 'Lichterstern', emoji: '🌟' },
};
// Jahreszeiten-Deko: Erstjahr, ab Folgejahr kommt sie wieder plus ein neues Stück
const SEASON_DECO = { Frühling: ['kirsch', 'osterei'], Sommer: ['schirm', 'eis'], Herbst: ['kuerbis', 'ahorn'], Winter: ['schneemann', 'stern'] };

const EVENT_TYPES = { besucher: 'Besucher mit Wunsch', fund: 'Fundstück', momo: 'Momos Wunsch', wetter: 'Inselwetter & Jahreszeit', entdeckung: 'Entdeckung in neuen Gebieten' };

// Inselplan 9×9: n Nordstrand (gesperrt bis Level 5), E Meine Ecke, P Ecke der Partnerin, G Gemeinschaft,
// B Bauen (deine Rolle), N Natur (Rolle Partnerin), M Momos Lichtung, s Strand, . Wasser
const MAP = [
  '..nnn....',
  '.nnnnn...',
  '.sEEGPPs.',
  '.EEGGGPP.',
  'sBBBMNNNs',
  '.BBBMNNN.',
  '..BBsNN..',
  '...sss...',
  '.........',
];
const ZONE = { n: 'nord', E: 'eckeIch', P: 'eckePartner', G: 'gemein', B: 'bau', N: 'natur', M: 'momo', s: 'strand' };
const ZONE_TITLE = { nord: 'Nordstrand', eckeIch: 'Meine Ecke', eckePartner: 'Ecke der Partnerin', gemein: 'Gemeinschaft', bau: 'Bauen', natur: 'Natur', momo: 'Lichtung', strand: 'Strand' };

let seq = 1;
const uid = () => seq++;

function makePlots() {
  const plots = [];
  MAP.forEach((row, r) => [...row].forEach((ch, c) => { if (ch !== '.') plots.push({ id: `${r}-${c}`, r, c, zone: ZONE[ch], item: null }); }));
  const put = (zone, items) => { const free = plots.filter((p) => p.zone === zone); items.forEach((it, i) => { free[i].item = it; }); };
  const P = (id) => ({ t: 'plan', id });
  const D = (id) => ({ t: 'deco', id });
  put('eckeIch', [P('blume'), P('bank')]);
  put('bau', [P('weg'), P('huette'), P('weg'), P('laterne')]);
  put('natur', [P('baum'), P('blume'), P('baum'), P('pilz'), P('baum')]);
  put('eckePartner', [P('pilz'), D('sonnenblume'), P('baum')]);
  return plots;
}

function initialState() {
  return {
    day: 1, year: 2026, season: 'Herbst', level: 4, xp: { me: 7, partner: 11 },
    evening: false, labels: false,
    me: { energy: 9, role: 'bau' }, partner: { energy: 3, role: 'natur' },
    momoAcc: [], extraPlans: [],
    inventory: [{ id: uid(), deco: 'muschel', from: 'Fundstück' }],
    plots: makePlots(),
    project: { name: 'Gartenhäuschen', emoji: '🏡', result: 'gartenhaus', bau: { need: 10, have: 4, label: 'Häuschen' }, natur: { need: 10, have: 6, label: 'Garten drumherum' } },
    projectsDone: [],
    events: [makeEvent('fund', 0, 'Herbst', 2026), makeEvent('besucher', 0, 'Herbst', 2026)],
    log: ['Tag 1: Start mit 9 Energie.'],
    settings: { types: { besucher: true, fund: true, momo: true, wetter: true, entdeckung: true }, cap: 2, goalsToday: 3 },
    seasonOwned: [], pendingDiscovery: false, nordOpen: false,
    placing: null, sheet: null,
  };
}

function makeEvent(type, day, season, year) {
  const base = { id: uid(), type, day, status: 'neu' };
  if (type === 'besucher') {
    const v = [
      { emoji: '🦔', title: 'Igel Ilse ist zu Besuch', text: 'Sie wünscht sich eine Laterne für den Heimweg.', wish: { plan: 'laterne' }, reward: { plan: 'brunnen' } },
      { emoji: '🦊', title: 'Fuchs Fridolin schaut vorbei', text: 'Er hätte gern eine Bank zum Ausruhen.', wish: { plan: 'bank' }, reward: { deco: 'treibholz' } },
      { emoji: '🦢', title: 'Schwan Selma landet am Ufer', text: 'Sie wünscht sich ein Blumenbeet.', wish: { plan: 'blume' }, reward: { plan: 'brunnen' } },
    ];
    return { ...base, ...v[day % v.length] };
  }
  if (type === 'fund') {
    const deco = ['flaschenpost', 'treibholz', 'muschel'][day % 3];
    return { ...base, emoji: DECO[deco].emoji, title: `Fundstück am Strand: ${DECO[deco].name}`, text: 'Liegt einfach da. Einsammeln kostet nichts.', reward: { deco } };
  }
  if (type === 'momo') return { ...base, emoji: '🐣', title: 'Momo hat einen Wunsch', text: 'Momo möchte etwas Neues in deiner Ecke sehen – egal was.', wish: { zone: 'eckeIch' }, reward: { momo: ['🎀', '🎩', '🧣'][day % 3] } };
  if (type === 'wetter') return { ...base, emoji: SEASON_ICON[season], title: `${season}wetter auf der Insel`, text: 'Mit dem Wetter wird Jahreszeiten-Deko angespült.', season, year, reward: { seasonal: true } };
  if (type === 'entdeckung') return { ...base, emoji: '🧭', title: 'Nordstrand entdeckt', text: 'Momo hat den neuen Strand erkundet und bringt Baupläne mit.', reward: { plans: ['leuchtfeuer', 'palme'], deco: 'bernstein' } };
}

let state = initialState();
const app = document.querySelector('#app');
const sheetRoot = document.querySelector('#sheet-root');

// ---------- Regeln ----------
const levelNeed = () => 10 + state.level * 2; // verbaute Energie pro Hälfte und Level (Annahme)
const myPlans = () => Object.keys(PLANS).filter((id) => !PLANS[id].hidden && ((PLANS[id].level && PLANS[id].level <= state.level) || state.extraPlans.includes(id)));
const plot = (id) => state.plots.find((p) => p.id === id);
const myZones = () => ['eckeIch', 'bau', ...(state.nordOpen ? ['nord'] : [])];
const itemInfo = (it) => (it.t === 'plan' ? PLANS[it.id] : DECO[it.id]);

function canPlace(p, placing) {
  if (p.item || !myZones().includes(p.zone)) return false;
  if (placing.t === 'deco' || p.zone === 'eckeIch') return true;
  return PLANS[placing.id].cat === state.me.role;
}
const validPlots = () => (state.placing ? new Set(state.plots.filter((p) => canPlace(p, state.placing)).map((p) => p.id)) : new Set());

const pendingEvents = () => state.events.filter((e) => e.status !== 'wunsch');
const openWishes = () => state.events.filter((e) => e.status === 'wunsch');
function wishMet(e) {
  if (e.wish.plan) return state.plots.some((p) => myZones().includes(p.zone) && p.item?.id === e.wish.plan);
  if (e.wish.zone) return state.plots.filter((p) => p.zone === e.wish.zone && p.item).length > (e.wishBase ?? Infinity);
  return false;
}

function addXp(who, n) {
  state.xp[who] += n;
  const need = levelNeed();
  if (state.xp.me >= need && state.xp.partner >= need) {
    state.xp.me -= need; state.xp.partner -= need; state.level += 1;
    const newPlans = Object.keys(PLANS).filter((p) => PLANS[p].level === state.level).map((p) => `${PLANS[p].emoji} ${PLANS[p].name}`);
    let msg = `✨ Momo ist gewachsen – Level ${state.level}! Neue Baupläne: ${newPlans.join(', ') || '–'}`;
    if (!state.nordOpen && state.level >= 5) { state.nordOpen = true; state.pendingDiscovery = true; msg += ' · Der Nebel über dem Nordstrand lichtet sich'; }
    state.log.unshift(`Tag ${state.day}: ${msg}`);
    setTimeout(() => toast(msg), 1400);
  }
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
  return (e.year === 2026 ? [first] : [first, second]).filter((d) => !state.seasonOwned.includes(d));
}

function checkWishes() {
  openWishes().forEach((e) => {
    if (!wishMet(e)) return;
    const got = grant(e.reward, e);
    state.events = state.events.filter((x) => x !== e);
    setTimeout(() => toast(`${e.emoji} Wunsch erfüllt! ${got.join(', ')}`), 700);
  });
}

// ---------- Aktionen ----------
function placeAt(p) {
  const pl = state.placing;
  if (pl.t === 'deco') {
    state.inventory = state.inventory.filter((i) => i.id !== pl.invId);
    p.item = { t: 'deco', id: pl.id };
    toast(`${DECO[pl.id].emoji} platziert – kostenlos.`);
  } else {
    const plan = PLANS[pl.id];
    if (state.me.energy < plan.cost) { state.placing = null; return toast('Nicht genug Energie.'); }
    state.me.energy -= plan.cost;
    p.item = { t: 'plan', id: pl.id };
    p.fresh = Date.now();
    addXp('me', plan.cost);
    toast(`${plan.emoji} ${plan.name} gebaut · −${plan.cost} ⚡ · Momo +${plan.cost}`);
    state.log.unshift(`Tag ${state.day}: ${plan.name} gebaut (−${plan.cost} Energie, Level +${plan.cost})`);
  }
  state.placing = null;
  checkWishes();
}

function deposit(n) {
  const share = state.project[state.me.role];
  const amount = Math.min(n, state.me.energy, share.need - share.have);
  if (amount <= 0) return toast(share.have >= share.need ? 'Dein Anteil ist schon voll.' : 'Keine Energie übrig.');
  state.me.energy -= amount; share.have += amount;
  addXp('me', amount);
  toast(`+${amount} ⚡ ins Projekt – zählt auch für Momo.`);
  checkProject();
}
function checkProject() {
  const pr = state.project;
  if (pr.bau.have < pr.bau.need || pr.natur.have < pr.natur.need) return;
  const target = state.plots.find((p) => p.zone === 'gemein' && !p.item && p.r === 3 && p.c === 4) || state.plots.find((p) => p.zone === 'gemein' && !p.item);
  if (target) { target.item = { t: 'plan', id: pr.result }; target.fresh = Date.now(); }
  state.projectsDone.push(pr.name);
  toast(`${pr.emoji} ${pr.name} ist fertig!`);
  state.project = { name: 'Brunnenplatz', emoji: '⛲', result: 'brunnen', bau: { need: 12, have: 0, label: 'Brunnen' }, natur: { need: 12, have: 0, label: 'Blumen ringsum' } };
}

function nextDay() {
  const s = state.settings;
  state.day += 1;
  const earned = s.goalsToday + (s.goalsToday === 3 ? 1 : 0);
  state.me.energy += earned; state.partner.energy += [4, 2, 3, 0, 4][state.day % 5];
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
  state.log.unshift(`Tag ${state.day}: +${earned} Energie, ${fresh.length} neue Ereignisse`);
  toast(`Neuer Tag: +${earned} ⚡ aus Tageszielen, ${fresh.length} Neues am Strand.`);
}

function partnerBuilds() {
  const pa = state.partner;
  if (pa.energy < 3) pa.energy += 6; // Simulation: Partnerin hat gespart
  const free = state.plots.find((p) => p.zone === 'natur' && !p.item);
  const id = ['blume', 'baum', 'pilz', 'hase'][state.day % 4];
  if (free) { free.item = { t: 'plan', id }; free.fresh = Date.now(); pa.energy -= PLANS[id].cost; addXp('partner', PLANS[id].cost); }
  const share = state.project.natur;
  const put = Math.max(0, Math.min(pa.energy, share.need - share.have, 3));
  pa.energy -= put; share.have += put; addXp('partner', put);
  checkProject();
  toast(`Die Partnerin hat ${free ? PLANS[id].emoji + ' gepflanzt' : 'nichts gepflanzt (Natur voll)'} und ${put} ⚡ ins Projekt gegeben.`);
}

function gift(invId) {
  const it = state.inventory.find((i) => i.id === invId);
  state.inventory = state.inventory.filter((i) => i.id !== invId);
  const free = state.plots.find((p) => p.zone === 'eckePartner' && !p.item);
  if (free) free.item = { t: 'deco', id: it.deco };
  toast(`🎁 ${DECO[it.deco].name} an die Partnerin verschenkt.`);
}

function nextSeason() {
  state.season = SEASONS[(SEASONS.indexOf(state.season) + 1) % 4];
  if (state.season === 'Frühling') state.year += 1;
  toast(`${SEASON_ICON[state.season]} ${state.season} ${state.year}`);
}

// ---------- Plot-Klick (aus allen drei Inselansichten) ----------
function onPlot(id) {
  const p = plot(id);
  if (!p) return;
  if (state.placing) {
    if (canPlace(p, state.placing)) placeAt(p);
    else toast('Dort geht es nicht – tippe auf ein leuchtendes Feld.');
    return render();
  }
  if (p.zone === 'strand') { const e = pendingEvents()[0]; if (e) state.sheet = { type: 'event', id: e.id }; else toast('Nur Sand und Wellen. 🌊'); }
  else if (p.zone === 'momo') toast(`Momo freut sich, dass du da bist. ${state.momoAcc.at(-1) || '💚'}`);
  else if (p.zone === 'gemein' && !p.item) state.sheet = { type: 'project' };
  else if (p.item) state.sheet = { type: 'item', plot: id };
  else if (p.zone === 'nord' && !state.nordOpen) toast('Nebel. Der Nordstrand öffnet sich mit Level 5.');
  else if (myZones().includes(p.zone)) state.sheet = { type: 'build', plot: id };
  else toast(`${ZONE_TITLE[p.zone]} gestaltet die Partnerin – ansehen ja, bauen nein.`);
  render();
}
window.onPlot = onPlot;

// ---------- HUD ----------
const momoScale = () => 0.8 + state.level * 0.08;
function hud() {
  const need = levelNeed();
  const ev = pendingEvents().length, wishes = openWishes().length;
  const pr = state.project;
  if (state.placing) {
    const what = state.placing.t === 'deco' ? DECO[state.placing.id] : PLANS[state.placing.id];
    return `<div class="hud__top">${hudTop(need)}</div>
      <div class="hud__place"><span>${what.emoji} <b>${what.name}</b> – tippe auf ein leuchtendes Feld</span><button data-action="cancel-place">Abbrechen</button></div>`;
  }
  return `<div class="hud__top">${hudTop(need)}</div>
    <div class="hud__side">
      <button class="hud__round" data-action="toggle-labels" title="Bereiche zeigen">${state.labels ? '🏷️' : '🗺️'}</button>
      <button class="hud__round" data-action="toggle-evening" title="Tag/Abend">${state.evening ? '☀️' : '🌙'}</button>
    </div>
    <div class="hud__bottom">
      <button class="hud__chip" data-action="open-inventory">🎒 ${state.inventory.length}</button>
      <button class="hud__chip" data-action="open-project">${pr.emoji} ${pr.bau.have + pr.natur.have}/${pr.bau.need + pr.natur.need}</button>
      <button class="hud__build" data-action="open-build">🔨 Bauen</button>
      <button class="hud__chip ${ev ? 'hud__chip--new' : ''}" data-action="open-events">✨ ${ev}${wishes ? ` · 💭${wishes}` : ''}</button>
    </div>`;
}
function hudTop(need) {
  return `<div class="hud__card">
    <div class="hud__row"><div><p class="eyebrow">${SEASON_ICON[state.season]} ${state.season} ${state.year} · Tag ${state.day}</p><h1>Momos Insel</h1></div>
      <span class="energy" title="Persönliche Energie aus Tageszielen – verfällt nie">⚡ ${state.me.energy}</span></div>
    <div class="levelbar"><div class="levelbar__half"><i style="width:${Math.min(1, state.xp.me / need) * 100}%"></i></div><div class="levelbar__half levelbar__half--partner"><i style="width:${Math.min(1, state.xp.partner / need) * 100}%"></i></div></div>
    <div class="levelbar__legend"><b>Momo Level ${state.level}</b><span>wächst durch Bauen &amp; Pflanzen · Du ${Math.min(state.xp.me, need)}/${need} · Partnerin ${Math.min(state.xp.partner, need)}/${need}</span></div>
  </div>`;
}

function tabbar() {
  return `<nav class="tabs">${[['🏠', 'Heute'], ['📋', 'Protokoll'], ['＋', ''], ['🏝️', 'Momo'], ['💞', 'Wir']].map(([i, l]) => `<button class="${l === 'Momo' ? 'active' : ''} ${i === '＋' ? 'plus' : ''}" data-action="noop"><i>${i}</i>${l}</button>`).join('')}</nav>`;
}

// ---------- Sheets ----------
function planRow(id) {
  const p = PLANS[id], ok = state.me.energy >= p.cost;
  return `<button class="plan" data-action="pick-plan" data-plan="${id}" ${ok ? '' : 'aria-disabled="true"'}>
    <span class="plan__emoji">${p.emoji}</span><span class="plan__text"><b>${p.name}</b><small>${p.cat === 'bau' ? '🔨 Bauen' : '🌿 Natur – nur in deiner Ecke'}${p.from ? ` · aus ${p.from}` : ''}</small></span><span class="cost ${ok ? '' : 'cost--short'}">${p.cost} ⚡</span></button>`;
}
function inventoryGrid(action) {
  if (!state.inventory.length) return '<p class="muted">Lager leer. Fundstücke und Ereignis-Deko landen hier.</p>';
  return `<div class="inv">${state.inventory.map((i) => `<button class="inv__item" data-action="${action}" data-id="${i.id}"><span>${DECO[i.deco].emoji}</span><small>${DECO[i.deco].name}</small></button>`).join('')}</div>`;
}
function eventRow(e) {
  const wish = e.status === 'wunsch';
  return `<button class="event ${e.status === 'neu' ? 'event--new' : ''}" data-action="open-event" data-id="${e.id}"><span class="event__emoji">${e.emoji}</span>
    <span class="event__text"><b>${e.title}</b><small>${wish ? (wishMet(e) ? 'Erfüllbar!' : 'Offener Wunsch · wartet, bis du magst') : `${EVENT_TYPES[e.type]} · seit Tag ${e.day || 1}`}</small></span>${e.status === 'neu' ? '<span class="dot">neu</span>' : ''}</button>`;
}
function projectCard() {
  const p = state.project, pct = (s) => Math.round((s.have / s.need) * 100);
  return `<div class="project"><div class="project__head"><span class="project__emoji">${p.emoji}</span><div><b>${p.name}</b><small>Gemeinschaftsprojekt · ohne Frist</small></div></div>
    <div class="share"><span>🔨 ${p.bau.label} (du)</span><div class="bar"><i style="width:${pct(p.bau)}%"></i></div><small>${p.bau.have}/${p.bau.need}</small></div>
    <div class="share share--partner"><span>🌿 ${p.natur.label}</span><div class="bar"><i style="width:${pct(p.natur)}%"></i></div><small>${p.natur.have}/${p.natur.need}</small></div></div>`;
}

function renderSheet() {
  const s = state.sheet;
  if (!s) return '';
  let inner = '';
  if (s.type === 'events') {
    const ev = pendingEvents(), w = openWishes();
    inner = `<h2>Neu auf der Insel</h2>${ev.map(eventRow).join('') || `<p class="muted">Gerade nichts Neues – höchstens ${state.settings.cap} pro Tag.</p>`}${w.length ? `<h2>Offene Wünsche</h2>${w.map(eventRow).join('')}` : ''}`;
  } else if (s.type === 'event') {
    const e = state.events.find((x) => x.id === s.id);
    if (!e) { state.sheet = null; return ''; }
    if (e.status === 'neu') e.status = 'gesehen';
    const r = e.reward;
    const reward = r.seasonal
      ? (seasonalItems(e).map((d) => `${DECO[d].emoji} ${DECO[d].name}`).join(', ') || 'nichts Neues – alles schon gesammelt') + (e.year > 2026 ? '<p class="note">Jahreszeiten-Deko kommt jedes Jahr wieder – Verpasstes holst du jetzt nach.</p>' : '')
      : [r.plan && `Bauplan ${PLANS[r.plan].emoji} ${PLANS[r.plan].name}`, r.plans && r.plans.map((p) => `Bauplan ${PLANS[p].emoji} ${PLANS[p].name}`).join(', '), r.deco && `${DECO[r.deco].emoji} ${DECO[r.deco].name}`, r.momo && `Accessoire ${r.momo} für Momo`].filter(Boolean).join(', ');
    let actions;
    if (!e.wish) actions = '<button class="primary" data-action="collect">Einsammeln</button><button class="ghost wide" data-action="close">Liegen lassen</button>';
    else if (wishMet(e)) actions = '<button class="primary" data-action="collect">Wunsch erfüllen</button>';
    else if (e.status === 'wunsch') actions = `<p class="muted">Noch offen: ${e.wish.plan ? `${PLANS[e.wish.plan].emoji} ${PLANS[e.wish.plan].name} bauen` : 'irgendetwas in deine Ecke stellen'}. Kein Zeitdruck.</p>${e.wish.plan && state.me.energy >= PLANS[e.wish.plan].cost ? `<button class="primary" data-action="pick-plan" data-plan="${e.wish.plan}">${PLANS[e.wish.plan].name} jetzt platzieren</button>` : ''}`;
    else actions = '<button class="primary" data-action="accept-wish">Wunsch merken</button><button class="ghost wide" data-action="close">Später</button>';
    inner = `<div class="sheet__emoji">${e.emoji}</div><p class="eyebrow">${EVENT_TYPES[e.type]}</p><h2>${e.title}</h2><p>${e.text}</p><p class="reward"><b>Belohnung:</b> ${reward}</p>${actions}<p class="fine">Ansehen kostet keine Energie. Nichts verfällt.</p>`;
  } else if (s.type === 'build') {
    const p = s.plot && plot(s.plot);
    const plans = myPlans().filter((id) => !p || canPlace(p, { t: 'plan', id }));
    inner = `<p class="eyebrow">${p ? `Bauen in „${ZONE_TITLE[p.zone]}“` : 'Bauen'}</p><h2>${p ? 'Was soll hierhin?' : 'Was willst du bauen?'}</h2>
      <p class="muted">Du hast ${state.me.energy} ⚡. Jede verbaute Energie lässt auch Momo wachsen.</p>
      <div class="plans">${plans.map(planRow).join('')}</div>
      ${state.inventory.length ? `<h3>Aus dem Lager (kostenlos)</h3>${inventoryGrid('pick-inv')}` : ''}`;
  } else if (s.type === 'project') {
    inner = `${projectCard()}<p class="muted">Du füllst nur deinen Anteil. Eingezahltes bleibt für immer und zählt für Momos Level.</p>
      <div class="row"><button class="soft" data-action="deposit" data-n="1">+1 ⚡</button><button class="soft" data-action="deposit" data-n="3">+3 ⚡</button><button class="soft" data-action="deposit" data-n="99">Alles</button></div>
      ${state.projectsDone.length ? `<p class="fine">Fertig: ${state.projectsDone.join(', ')}</p>` : ''}`;
  } else if (s.type === 'inventory') {
    inner = `<h2>🎒 Lager</h2>${inventoryGrid('open-inv')}<p class="muted">Fundstücke und Deko kann man platzieren oder der Partnerin schenken. Energie und Gebautes nicht.</p>`;
  } else if (s.type === 'inv') {
    const it = state.inventory.find((i) => i.id === s.id);
    if (!it) { state.sheet = null; return ''; }
    inner = `<div class="sheet__emoji">${DECO[it.deco].emoji}</div><h2>${DECO[it.deco].name}</h2><p class="muted">Herkunft: ${it.from}</p>
      <button class="soft wide" data-action="pick-inv" data-id="${it.id}">Auf der Insel platzieren</button>
      <button class="soft wide gift" data-action="gift" data-id="${it.id}">🎁 Der Partnerin schenken</button>`;
  } else if (s.type === 'item') {
    const p = plot(s.plot), info = itemInfo(p.item);
    const mine = myZones().includes(p.zone);
    inner = `<div class="sheet__emoji">${info.emoji}</div><h2>${info.name}</h2><p class="muted">Steht in „${ZONE_TITLE[p.zone]}“${p.item.t === 'plan' ? ' · mit Energie gebaut' : ' · Deko'}.</p>
      ${mine && p.item.t === 'deco' ? '<button class="soft wide" data-action="store-item">Zurück ins Lager</button>' : ''}
      ${p.item.t === 'plan' ? '<p class="fine">Gebautes bleibt stehen und ist nicht verschenkbar.</p>' : ''}`;
  }
  return `<div class="sheet-backdrop" data-action="close"></div><div class="sheet" role="dialog"><button class="sheet__close" data-action="close" aria-label="Schließen">✕</button>${inner}</div>`;
}

// ---------- Labor ----------
function renderLab() {
  const s = state.settings;
  return `<p class="lab__hint">Zeit vergehen lassen</p>
    <label class="lab__inline">Heute erfüllte Tagesziele: <select data-setting="goalsToday">${[0, 1, 2, 3].map((n) => `<option ${s.goalsToday === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <div class="lab__actions">
      <button data-sim="day">Nächster Tag</button><button data-sim="partner">Partnerin baut</button>
      <button data-sim="season">Nächste Jahreszeit</button><button data-sim="year">+1 Jahr</button>
      <button data-sim="partner-gift">Partnerin schenkt</button><button data-sim="energy">+10 ⚡ (Test)</button>
      <button data-sim="reset">Zurücksetzen</button>
    </div>
    <p class="lab__hint">Ereignistypen (Kandidaten)</p>
    <div class="lab__checks">${Object.entries(EVENT_TYPES).map(([k, l]) => `<label><input type="checkbox" data-type="${k}" ${s.types[k] ? 'checked' : ''}> ${l}</label>`).join('')}</div>
    <label class="lab__inline">Neue Ereignisse pro Tag höchstens: <select data-setting="cap">${[1, 2, 3].map((n) => `<option ${s.cap === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <details><summary>Verlauf</summary><pre>${state.log.slice(0, 12).join('\n')}</pre></details>
    <details><summary>Vollständiger Zustand</summary><pre>${JSON.stringify({ ...state, sheet: undefined, log: undefined, plots: state.plots.filter((p) => p.item).map((p) => `${p.zone}:${p.item.id}`) }, null, 1)}</pre></details>`;
}

// ---------- Rendering ----------
const params = new URLSearchParams(location.search);
let variant = VARIANTS[params.get('variant')] ? params.get('variant') : 'A';
let mounted = null;
let island3d = null;

function viewOpts() {
  return { valid: validPlots(), events: pendingEvents(), momoAcc: state.momoAcc.at(-1) || '', momoScale: momoScale(), itemInfo };
}

// Ziehen = verschieben, Pinch/Mausrad = zoomen (nur SVG-Varianten A und B)
const VIEW_CENTER = { A: { cx: 287, cy: 205, w: 280 }, B: { cx: 205, cy: 172, w: 300 } };
const views = {};
function applyView() {
  const svg = document.querySelector('#island > svg');
  const el = document.querySelector('#island');
  if (!svg || !el.clientWidth) return;
  const c = VIEW_CENTER[variant];
  const v = (views[variant] ||= { cx: c.cx, cy: c.cy, w: c.w });
  const h = v.w * el.clientHeight / el.clientWidth;
  svg.setAttribute('viewBox', `${v.cx - v.w / 2} ${v.cy - h / 2} ${v.w} ${h}`);
}
function attachPanZoom(el) {
  const pts = new Map();
  let moved = 0, pinch = 0;
  const v = () => views[variant];
  el.addEventListener('pointerdown', (e) => { if (variant === 'C') return; pts.set(e.pointerId, [e.clientX, e.clientY]); moved = 0; pinch = 0; });
  el.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || variant === 'C') return;
    const [px, py] = pts.get(e.pointerId);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    const k = v().w / el.clientWidth;
    if (pts.size === 1) { moved += Math.abs(e.clientX - px) + Math.abs(e.clientY - py); if (moved > 6) { v().cx -= (e.clientX - px) * k; v().cy -= (e.clientY - py) * k; applyView(); } }
    else { const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) zoom(pinch / d); pinch = d; moved = 99; }
  });
  const up = (e) => pts.delete(e.pointerId);
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('click', (e) => { if (moved > 6) { e.stopPropagation(); moved = 0; } }, true);
  el.addEventListener('wheel', (e) => { if (variant === 'C') return; e.preventDefault(); zoom(e.deltaY > 0 ? 1.1 : 0.9); }, { passive: false });
  function zoom(f) { v().w = Math.max(150, Math.min(560, v().w * f)); applyView(); }
}
window.addEventListener('resize', applyView);

function render() {
  if (mounted !== variant) {
    if (island3d && mounted === 'C') island3d.unmount();
    app.innerHTML = `<div class="screen"><div class="stage stage--${variant}"><div id="island"></div><div id="hud" class="hud"></div></div>${tabbar()}</div>`;
    attachPanZoom(document.querySelector('#island'));
    mounted = variant;
  }
  const el = document.querySelector('#island');
  if (variant === 'A') { el.innerHTML = window.IslandIso.render(state, viewOpts()); applyView(); }
  if (variant === 'B') { el.innerHTML = window.IslandMap.render(state, viewOpts()); applyView(); }
  if (variant === 'C') {
    if (!island3d) {
      import('./island-3d.js').then((m) => { island3d = m; if (variant === 'C') { m.mount(el, onPlot); m.update(state, viewOpts()); } })
        .catch((err) => { el.innerHTML = `<p class="muted" style="padding:120px 20px">3D konnte nicht geladen werden (Internet nötig für three.js vom CDN): ${err.message}</p>`; });
    } else {
      if (!island3d.isMounted()) island3d.mount(el, onPlot);
      island3d.update(state, viewOpts());
    }
  }
  document.querySelector('#hud').innerHTML = hud();
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
  if (e.key === 'Escape') { state.sheet = null; state.placing = null; render(); }
});

document.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-action], [data-sim]');
  if (!t) return;
  if (t.dataset.sim) {
    ({ day: nextDay, partner: partnerBuilds, season: nextSeason, year: () => { state.year += 1; toast(`Ein Jahr später: ${state.season} ${state.year}`); },
      'partner-gift': () => { state.inventory.push({ id: uid(), deco: 'sonnenblume', from: 'Geschenk der Partnerin' }); toast('🎁 Die Partnerin hat dir eine Sonnenblume geschenkt.'); },
      energy: () => { state.me.energy += 10; }, reset: () => { state = initialState(); toast('Zurückgesetzt.'); } })[t.dataset.sim]();
    return render();
  }
  const s = state.sheet;
  switch (t.dataset.action) {
    case 'plot': onPlot(t.dataset.plot); return;
    case 'close': state.sheet = null; break;
    case 'open-events': state.sheet = { type: 'events' }; break;
    case 'open-event': state.sheet = { type: 'event', id: +t.dataset.id }; break;
    case 'open-build': state.sheet = { type: 'build' }; break;
    case 'open-project': state.sheet = { type: 'project' }; break;
    case 'open-inventory': state.sheet = { type: 'inventory' }; break;
    case 'open-inv': state.sheet = { type: 'inv', id: +t.dataset.id }; break;
    case 'toggle-labels': state.labels = !state.labels; break;
    case 'toggle-evening': state.evening = !state.evening; break;
    case 'cancel-place': state.placing = null; break;
    case 'pick-plan': {
      const id = t.dataset.plan;
      if (state.me.energy < PLANS[id].cost) { toast(`${PLANS[id].name} kostet ${PLANS[id].cost} ⚡ – du hast ${state.me.energy}. Energie verfällt nie, einfach sammeln.`); break; }
      state.placing = { t: 'plan', id };
      if (s?.plot) placeAt(plot(s.plot));
      state.sheet = null; break;
    }
    case 'pick-inv': {
      const it = state.inventory.find((i) => i.id === +t.dataset.id);
      state.placing = { t: 'deco', id: it.deco, invId: it.id };
      if (s?.plot) placeAt(plot(s.plot));
      state.sheet = null; break;
    }
    case 'gift': gift(+t.dataset.id); state.sheet = null; break;
    case 'store-item': { const p = plot(s.plot); state.inventory.push({ id: uid(), deco: p.item.id, from: 'zurückgelegt' }); p.item = null; state.sheet = null; break; }
    case 'deposit': deposit(+t.dataset.n); break;
    case 'accept-wish': {
      const e = state.events.find((x) => x.id === s.id);
      e.status = 'wunsch'; if (e.wish.zone) e.wishBase = state.plots.filter((p) => p.zone === e.wish.zone && p.item).length;
      toast('Wunsch gemerkt. Er wartet, bis du ihn erfüllst.'); state.sheet = null; break;
    }
    case 'collect': {
      const e = state.events.find((x) => x.id === s.id);
      const got = grant(e.reward, e);
      state.events = state.events.filter((x) => x !== e);
      toast(got.length ? `Erhalten: ${got.join(', ')}` : 'Angesehen – nichts Neues dabei.');
      state.sheet = null; break;
    }
    case 'noop': toast('Andere Tabs sind im Prototyp Platzhalter.'); break;
  }
  render();
});

document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.dataset.type) state.settings.types[t.dataset.type] = t.checked;
  else if (t.dataset.setting) state.settings[t.dataset.setting] = +t.value;
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
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

render();
