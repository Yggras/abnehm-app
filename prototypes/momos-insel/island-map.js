// PROTOTYP — Variante B: Momos Insel als illustrierte Karte von oben (Aquarell-/Schatzkarten-Stil, reines SVG).
(function () {
  const S = 40, OX = 20, OY = 20;
  const pos = (r, c) => [OX + c * S + S / 2, OY + r * S + S / 2];
  const hash = (r, c) => (((r * 73856093) ^ (c * 19349663)) >>> 0) % 1000 / 1000;

  const SEASON = {
    Frühling: { grass: '#a9d98a', grass2: '#8cc56d', leaves: ['#79c25c', '#5aa548'], accent: '#ffb3cf' },
    Sommer: { grass: '#97cf72', grass2: '#76b955', leaves: ['#4fa53f', '#3a8a35'], accent: null },
    Herbst: { grass: '#c7cd7c', grass2: '#adb460', leaves: ['#e8913a', '#c9612a'], accent: null },
    Winter: { grass: '#f1f5f7', grass2: '#d9e4ea', leaves: ['#4f8a5e', '#3c7050'], accent: '#fff' },
  };
  const ZONE_INK = { eckeIch: '#3c9d67', bau: '#7a6a4f', natur: '#3f8a3a', eckePartner: '#e39b3f', gemein: '#b8860b', momo: '#d4a017', nord: '#5f7d8c' };
  const ZONE_NAME = { eckeIch: 'Meine Ecke', bau: 'Bauen', natur: 'Natur', eckePartner: 'Ecke der Partnerin', gemein: 'Gemeinschaft', momo: 'Momos Lichtung' };

  const sh = (x, y, r) => `<circle cx="${x + 3}" cy="${y + 4}" r="${r}" fill="#3b4a2a" opacity=".22" filter="url(#soft)"/>`;

  function tree(x, y, se, apples, k) {
    const [a, b] = se.leaves;
    let s = sh(x, y, 15) + `<circle cx="${x}" cy="${y}" r="11" fill="${b}"/>`;
    for (let i = 0; i < 7; i++) { const a2 = (i / 7) * Math.PI * 2 + k * 3; s += `<circle cx="${(x + Math.cos(a2) * 9).toFixed(1)}" cy="${(y + Math.sin(a2) * 9).toFixed(1)}" r="${(6 + ((i * 7 + k * 10) % 3)).toFixed(1)}" fill="${b}"/>`; }
    s += `<circle cx="${x - 2}" cy="${y - 2}" r="9.5" fill="${a}"/><circle cx="${x - 7}" cy="${y + 3}" r="5" fill="${a}"/><circle cx="${x + 4}" cy="${y - 7}" r="5" fill="${a}"/><circle cx="${x - 5}" cy="${y - 6}" r="4" fill="#fff" opacity=".2"/>`;
    if (se === SEASON.Winter) s += `<circle cx="${x - 3}" cy="${y - 4}" r="7" fill="#fff" opacity=".85"/>`;
    if (apples && se !== SEASON.Winter) [[-6, 3], [5, -4], [3, 7], [-2, -8]].slice(0, 2 + Math.floor(k * 3)).forEach(([dx, dy]) => { s += `<circle cx="${x + dx}" cy="${y + dy}" r="2.3" fill="#d93636" stroke="#fff" stroke-width=".6"/>`; });
    if (se.accent && se !== SEASON.Winter) [[-4, 4], [6, 2], [0, -6]].forEach(([dx, dy]) => { s += `<circle cx="${x + dx}" cy="${y + dy}" r="2" fill="${se.accent}"/>`; });
    return s;
  }
  function palm(x, y) {
    let s = sh(x, y, 13);
    for (let i = 0; i < 6; i++) { const a = i * 60 + 15; s += `<path d="M${x} ${y} q 6 -6 15 -2" transform="rotate(${a} ${x} ${y})" stroke="#3f9a49" stroke-width="5" fill="none" stroke-linecap="round"/>`; }
    return s + `<circle cx="${x}" cy="${y}" r="3.5" fill="#8a5a2f"/>`;
  }
  function flowers(x, y, k) {
    const cols = ['#ff7aa8', '#ffd447', '#ffffff', '#b98cff', '#ff9a4d'];
    let s = `<ellipse cx="${x}" cy="${y}" rx="15" ry="12" fill="#6fae52" opacity=".55"/>`;
    [[-9, -5], [-2, -8], [7, -6], [10, 2], [3, 1], [-6, 3], [-1, 8], [7, 8]].forEach(([dx, dy], i) => {
      s += `<circle cx="${x + dx}" cy="${y + dy}" r="2.8" fill="${cols[(i + Math.floor(k * 5)) % 5]}" stroke="#fff" stroke-width=".6"/><circle cx="${x + dx}" cy="${y + dy}" r=".9" fill="#e0a200"/>`;
    });
    return s;
  }
  function mushrooms(x, y) {
    return [[-7, -4, 6], [6, -2, 5], [1, 8, 7]].map(([dx, dy, r]) => sh(x + dx, y + dy, r) + `<circle cx="${x + dx}" cy="${y + dy}" r="${r}" fill="#df463a"/><circle cx="${x + dx - r / 3}" cy="${y + dy - r / 3}" r="${r / 4}" fill="#fff"/><circle cx="${x + dx + r / 3}" cy="${y + dy}" r="${r / 5}" fill="#fff"/>`).join('');
  }
  function rabbit(x, y) {
    return `<ellipse cx="${x - 6}" cy="${y + 4}" rx="10" ry="6" fill="#4b3322"/>` + sh(x + 5, y - 2, 6)
      + `<ellipse cx="${x + 5}" cy="${y - 2}" rx="6" ry="7.5" fill="#fbfaf7"/><ellipse cx="${x + 3}" cy="${y - 11}" rx="1.8" ry="5" fill="#fbfaf7"/><ellipse cx="${x + 7}" cy="${y - 11}" rx="1.8" ry="5" fill="#fbfaf7"/><circle cx="${x + 5}" cy="${y + 5}" r="2.2" fill="#fff"/>`;
  }
  function pond(x, y) {
    return `<path d="M${x - 17} ${y} q 2 -14 17 -13 q 16 1 15 12 q 0 13 -16 13 q -17 0 -16 -12 z" fill="#5ab4d6" stroke="#3a8fb6" stroke-width="1.5" filter="url(#wobble)"/>`
      + `<circle cx="${x - 5}" cy="${y - 3}" r="4" fill="#4caf50"/><circle cx="${x + 7}" cy="${y + 4}" r="3.5" fill="#5cbf5a"/><circle cx="${x - 5}" cy="${y - 3}" r="1.8" fill="#ff8fb5"/>`
      + `<path d="M${x - 10} ${y + 5} q 4 -2 8 0" stroke="#fff" stroke-width="1" fill="none" opacity=".7"/>`;
  }
  function path(x, y, k) {
    return [[-12, -6], [-3, -10], [7, -7], [13, 2], [-8, 5], [2, 3], [9, 11], [-2, 13]].map(([dx, dy], i) => `<ellipse cx="${x + dx}" cy="${y + dy}" rx="${4.5 + k}" ry="3.6" fill="${i % 2 ? '#cfc7b4' : '#bab19c'}" stroke="#968c76" stroke-width=".6"/>`).join('');
  }
  function bench(x, y) {
    return sh(x, y, 9) + `<rect x="${x - 12}" y="${y - 5}" width="24" height="10" rx="2" fill="#b9783f" stroke="#7a4a2c"/><line x1="${x - 12}" y1="${y - 1.5}" x2="${x + 12}" y2="${y - 1.5}" stroke="#7a4a2c" stroke-width=".8"/><line x1="${x - 12}" y1="${y + 1.8}" x2="${x + 12}" y2="${y + 1.8}" stroke="#7a4a2c" stroke-width=".8"/>`;
  }
  function lantern(x, y, ev) {
    return `<circle cx="${x}" cy="${y}" r="${ev ? 26 : 10}" fill="url(#mglow)" opacity="${ev ? 1 : 0.5}"/><circle cx="${x}" cy="${y}" r="4.5" fill="#3a3a44"/><circle cx="${x}" cy="${y}" r="2.5" fill="#ffe17a"/>`;
  }
  function hut(x, y, ev) {
    return sh(x, y, 15) + `<rect x="${x - 13}" y="${y - 11}" width="26" height="22" rx="2" fill="#e6c35c" stroke="#a88430"/><line x1="${x - 13}" y1="${y}" x2="${x + 13}" y2="${y}" stroke="#a88430" stroke-width="1.5"/>`
      + [-8, -3, 3, 8].map((d) => `<line x1="${x + d}" y1="${y - 10}" x2="${x + d + 2}" y2="${y - 2}" stroke="#c9a33f"/><line x1="${x + d}" y1="${y + 2}" x2="${x + d + 2}" y2="${y + 10}" stroke="#c9a33f"/>`).join('')
      + (ev ? `<circle cx="${x}" cy="${y + 14}" r="8" fill="url(#mglow)"/>` : '');
  }
  function gardenhouse(x, y, ev) {
    return sh(x, y, 19) + `<rect x="${x - 17}" y="${y - 13}" width="34" height="26" rx="2" fill="#d9544a" stroke="#9e3530"/><line x1="${x - 17}" y1="${y}" x2="${x + 17}" y2="${y}" stroke="#9e3530" stroke-width="2"/>`
      + `<path d="M${x - 17} ${y - 13} L${x} ${y} L${x - 17} ${y + 13} M${x + 17} ${y - 13} L${x} ${y} L${x + 17} ${y + 13}" stroke="#b8403c" fill="none"/><rect x="${x + 7}" y="${y - 10}" width="5" height="5" fill="#7a3a2a"/>`
      + flowers(x - 2, y + 20, 0.2).replace(/ellipse[^>]*>/, 'g>') + (ev ? `<circle cx="${x}" cy="${y + 16}" r="12" fill="url(#mglow)"/>` : '');
  }
  function fountain(x, y) {
    return sh(x, y, 15) + `<circle cx="${x}" cy="${y}" r="15" fill="#cfccc2" stroke="#9e9a8e" stroke-width="2"/><circle cx="${x}" cy="${y}" r="11" fill="#6cc3e0"/><circle cx="${x}" cy="${y}" r="4" fill="#cfccc2"/>`
      + [0, 60, 120, 180, 240, 300].map((a) => `<line x1="${x}" y1="${y - 5}" x2="${x}" y2="${y - 9}" transform="rotate(${a} ${x} ${y})" stroke="#fff" stroke-width="1.2" class="spray"/>`).join('');
  }
  function lighthouse(x, y, ev) {
    return sh(x, y, 12) + (ev ? `<path d="M${x} ${y} L${x + 60} ${y - 22} L${x + 60} ${y + 22} z" fill="#ffe9a0" opacity=".35" class="beam"/>` : '')
      + `<circle cx="${x}" cy="${y}" r="12" fill="#d9443c"/><circle cx="${x}" cy="${y}" r="8.5" fill="#fff"/><circle cx="${x}" cy="${y}" r="5" fill="#d9443c"/><circle cx="${x}" cy="${y}" r="2.5" fill="#ffe17a"/>`;
  }
  function dock(x, y) {
    return `<rect x="${x - 4}" y="${y - 6}" width="30" height="12" fill="#b98552" stroke="#7a4a2c"/>` + [0, 6, 12, 18].map((d) => `<line x1="${x - 4 + d + 4}" y1="${y - 6}" x2="${x - 4 + d + 4}" y2="${y + 6}" stroke="#7a4a2c" stroke-width=".7"/>`).join('')
      + `<path d="M${x + 22} ${y + 14} q 8 -3 14 0 l -3 4 h -8 z" fill="#8a5530"/><path d="M${x + 29} ${y + 13} v -12 l 7 10 z" fill="#fff" stroke="#999" stroke-width=".5"/>`;
  }
  function bridge(x, y) {
    return `<rect x="${x - 18}" y="${y - 7}" width="36" height="14" rx="3" fill="#c98a4c" stroke="#7a4a2c"/>` + [-12, -6, 0, 6, 12].map((d) => `<line x1="${x + d}" y1="${y - 7}" x2="${x + d}" y2="${y + 7}" stroke="#7a4a2c" stroke-width=".8"/>`).join('');
  }
  const emoji = (x, y, e) => sh(x, y, 8) + `<text x="${x}" y="${y + 7}" font-size="20" text-anchor="middle">${e}</text>`;
  const DECO_E = { muschel: '🐚', flaschenpost: '🍾', treibholz: '🪵', bernstein: '🟠', sonnenblume: '🌻', kirsch: '🌸', osterei: '🥚', schirm: '⛱️', eis: '🍦', kuerbis: '🎃', ahorn: '🍁', schneemann: '⛄', stern: '🌟' };

  function drawItem(it, x, y, se, k, ev) {
    if (it.t === 'deco') return emoji(x, y, DECO_E[it.id] || '❓');
    return ({
      baum: () => tree(x, y, se, true, k), palme: () => palm(x, y), blume: () => flowers(x, y, k), pilz: () => mushrooms(x, y), hase: () => rabbit(x, y), teich: () => pond(x, y),
      weg: () => path(x, y, k), bank: () => bench(x, y), laterne: () => lantern(x, y, ev), huette: () => hut(x, y, ev), gartenhaus: () => gardenhouse(x, y, ev),
      brunnen: () => fountain(x, y), leuchtfeuer: () => lighthouse(x, y, ev), steg: () => dock(x, y), bruecke: () => bridge(x, y),
    }[it.id] || (() => emoji(x, y, '❓')))();
  }

  function compass(x, y) {
    return `<g transform="translate(${x} ${y})" opacity=".8"><circle r="22" fill="none" stroke="#6b5a3e" stroke-width="1"/><circle r="17" fill="none" stroke="#6b5a3e" stroke-width=".5" stroke-dasharray="2 2"/>
      <path d="M0 -26 L5 0 L0 26 L-5 0 z" fill="#6b5a3e"/><path d="M-26 0 L0 -5 L26 0 L0 5 z" fill="#a8956f"/><path d="M0 -26 L5 0 L0 0 z" fill="#c0392b"/>
      <text y="-30" text-anchor="middle" font-size="12" class="map-label" fill="#6b5a3e">N</text></g>`;
  }

  function render(state, o) {
    const se = SEASON[state.season];
    const ev = state.evening;
    const land = state.plots;
    const grass = land.filter((p) => p.zone !== 'strand');
    const circles = (list, r, fill) => list.map((p) => { const [x, y] = pos(p.r, p.c); return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`; }).join('');

    // Bereichs-Waschungen und Beschriftung
    let washes = '', names = '';
    const groups = {};
    land.forEach((p) => { (groups[p.zone] ||= []).push(p); });
    Object.entries(ZONE_NAME).forEach(([z, n]) => {
      const g = groups[z]; if (!g) return;
      if (state.labels || z === 'eckeIch' || z === 'eckePartner') washes += `<g filter="url(#wash)" opacity="${state.labels ? 0.5 : 0.28}">${circles(g, 17, ZONE_INK[z])}</g>`;
      const r = g.reduce((s, p) => s + p.r, 0) / g.length, c = g.reduce((s, p) => s + p.c, 0) / g.length;
      const [x, y] = pos(r, c);
      const rot = ((r * 7 + c * 3) % 9) - 4;
      if (z !== 'momo' && z !== 'gemein') names += `<text x="${x}" y="${y + S * 0.62}" transform="rotate(${rot} ${x} ${y})" font-size="15" text-anchor="middle" class="map-label" fill="${ZONE_INK[z]}" stroke="#f6eed8" stroke-width="3" paint-order="stroke">${n}</text>`;
    });

    let tiles = '', markerIdx = 0;
    land.forEach((p) => {
      const [x, y] = pos(p.r, p.c);
      const k = hash(p.r, p.c);
      let g = `<rect x="${x - S / 2}" y="${y - S / 2}" width="${S}" height="${S}" fill="transparent"/>`;
      if (o.valid.has(p.id)) g += `<circle cx="${x}" cy="${y}" r="16" fill="#fff" class="valid" stroke="#fff" stroke-width="2" stroke-dasharray="4 3"/>`;
      if (!p.item && p.zone !== 'strand' && p.zone !== 'momo' && k > 0.45) g += `<path d="M${x - 6 + k * 8} ${y + 4} l2 -5 l2 5 M${x + 5 - k * 6} ${y - 6} l1.5 -4 l1.5 4" stroke="${se.grass2}" stroke-width="1.2" fill="none"/>`;
      const pop = p.fresh && Date.now() - p.fresh < 1200 ? ' pop' : '';
      if (p.item) g += `<g class="obj${pop}">${drawItem(p.item, x, y, se, k, ev)}</g>`;
      else if (p.zone === 'gemein' && p.r === 3 && p.c === 4) {
        const pr = state.project;
        g += `<rect x="${x - 15}" y="${y - 13}" width="30" height="26" fill="none" stroke="#8a5530" stroke-width="1.5" stroke-dasharray="4 3"/><line x1="${x - 15}" y1="${y - 13}" x2="${x + 15}" y2="${y + 13}" stroke="#b98552" stroke-width="2"/><line x1="${x + 15}" y1="${y - 13}" x2="${x - 15}" y2="${y + 13}" stroke="#b98552" stroke-width="2"/>`
          + `<g class="bob"><rect x="${x - 24}" y="${y - 34}" width="48" height="17" rx="8.5" fill="#fffdf4" stroke="#b8860b"/><text x="${x}" y="${y - 22}" font-size="11" font-weight="800" text-anchor="middle" fill="#6b4e00">${pr.emoji} ${pr.bau.have + pr.natur.have}/${pr.bau.need + pr.natur.need}</text></g>`;
      } else if (p.zone === 'momo' && p.r === 4) {
        g += `<circle cx="${x}" cy="${y + 2}" r="${17 * o.momoScale}" fill="#fff6c9" stroke="#e7c75a" stroke-width="1.5"/><g class="momo-bounce"><text x="${x}" y="${y + 10}" font-size="${26 * o.momoScale}" text-anchor="middle">🐣</text>${o.momoAcc ? `<text x="${x + 11}" y="${y - 8}" font-size="12">${o.momoAcc}</text>` : ''}</g>`;
      } else if (p.zone === 'momo') g += `<text x="${x}" y="${y + 6}" font-size="15" text-anchor="middle" class="map-label" fill="#a07f12">Momos Lichtung</text>`;
      if (p.zone === 'strand' && markerIdx < o.events.length) {
        const e = o.events[markerIdx++];
        g += `<g class="bob" style="animation-delay:-${markerIdx * 0.4}s"><path d="M${x} ${y + 6} l-7 -12 a 9 9 0 1 1 14 0 z" fill="${e.status === 'neu' ? '#e0435b' : '#8c9aa0'}" stroke="#fff" stroke-width="1.5"/><circle cx="${x}" cy="${y - 11}" r="7" fill="#fff"/><text x="${x}" y="${y - 7}" font-size="10" text-anchor="middle">${e.emoji}</text></g>`;
      }
      tiles += `<g class="plot" role="button" aria-label="Feld ${p.id} ${p.zone}${p.item ? ' ' + p.item.id : ''}${o.valid.has(p.id) ? ' frei' : ''}" data-action="plot" data-plot="${p.id}">${g}</g>`;
    });

    let fog = '';
    if (!state.nordOpen) {
      const nord = land.filter((p) => p.zone === 'nord');
      fog = `<g data-action="plot" data-plot="${nord[0].id}"><g filter="url(#goo)">${circles(nord, 23, '#f6eed8')}</g><g opacity=".5">${circles(nord, 23, 'url(#hatch)')}</g>`
        + `<text x="${pos(0.6, 3)[0]}" y="${pos(0.6, 3)[1] + 4}" font-size="17" text-anchor="middle" class="map-label" fill="#7b6a4c">Unentdeckt · ab Level 5</text>`
        + `<text x="${pos(0.6, 3)[0]}" y="${pos(0.6, 3)[1] - 14}" font-size="16" text-anchor="middle">☁️</text></g>`;
    }

    // Weg-Verbindungen
    let roads = '';
    const isPath = (r, c) => land.some((p) => p.r === r && p.c === c && p.item?.id === 'weg');
    land.filter((p) => p.item?.id === 'weg').forEach((p) => {
      [[0, 1], [1, 0]].forEach(([dr, dc]) => { if (isPath(p.r + dr, p.c + dc)) { const [x1, y1] = pos(p.r, p.c), [x2, y2] = pos(p.r + dr, p.c + dc); roads += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#bab19c" stroke-width="10" stroke-linecap="round" opacity=".7"/>`; } });
    });

    const sea = ev ? '#365a7a' : '#a9d7e3';
    return `<svg class="map" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="goo"><feGaussianBlur stdDeviation="7"/><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -11"/></filter>
        <filter id="coast"><feGaussianBlur stdDeviation="7"/><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -11" result="b"/><feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="2" result="n"/><feDisplacementMap in="b" in2="n" scale="9"/></filter>
        <filter id="wash"><feGaussianBlur stdDeviation="6"/></filter>
        <filter id="soft"><feGaussianBlur stdDeviation="1.6"/></filter>
        <filter id="wobble"><feTurbulence type="fractalNoise" baseFrequency=".08" numOctaves="1" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="3"/></filter>
        <filter id="paper"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3"/><feColorMatrix values="0 0 0 0 .42  0 0 0 0 .36  0 0 0 0 .25  0 0 0 .55 0"/></filter>
        <radialGradient id="mglow"><stop offset="0" stop-color="#ffe9a0" stop-opacity=".95"/><stop offset="1" stop-color="#ffd35c" stop-opacity="0"/></radialGradient>
        <radialGradient id="vignette" cx=".5" cy=".5" r=".75"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#4a3a1a" stop-opacity=".35"/></radialGradient>
        <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#a8956f" stroke-width="1"/></pattern>
      </defs>
      <rect x="-400" y="-400" width="1200" height="1200" fill="${sea}"/>
      <rect x="-400" y="-400" width="1200" height="1200" filter="url(#paper)" opacity=".5"/>
      <g stroke="${ev ? '#7fa5c4' : '#5fa9c0'}" stroke-width="1.1" fill="none" opacity=".7">
        ${Array.from({ length: 22 }, (_, i) => `<path class="wave" style="animation-delay:-${i * 0.5}s" d="M${-60 + (i * 97) % 500} ${-40 + (i * 67) % 470} q 4 -4 8 0 t 8 0 t 8 0"/>`).join('')}
      </g>
      <g filter="url(#coast)">${circles(land, 30, ev ? '#5b86a3' : '#cdeef4')}</g>
      <g filter="url(#coast)">${circles(land, 25, '#c9a868')}</g>
      <g filter="url(#coast)">${circles(land, 23, '#f2e0ad')}</g>
      <g filter="url(#coast)">${circles(grass, 21, se.grass2)}</g>
      <g filter="url(#coast)">${circles(grass, 19, se.grass)}</g>
      ${washes}
      ${roads}
      ${names}
      <g>${tiles}</g>
      ${fog}
      ${compass(28, 330)}
      <g transform="translate(330 372)"><path d="M-46 -12 h92 l-8 12 l8 12 h-92 l8 -12 z" fill="#f6eed8" stroke="#8a7550"/><text y="5" text-anchor="middle" font-size="17" class="map-label" fill="#5a4a2e">Momos Insel</text></g>
      <path d="M380 300 q 20 -30 50 -20" stroke="#8a7550" stroke-dasharray="3 4" fill="none" opacity=".6"/>
      ${ev ? '<rect x="-400" y="-400" width="1200" height="1200" fill="#1b2350" opacity=".3" pointer-events="none" style="mix-blend-mode:multiply"/>' : ''}
      <rect x="-400" y="-400" width="1200" height="1200" fill="url(#vignette)" pointer-events="none"/>
    </svg>`;
  }

  window.IslandMap = { render };
})();
