// PROTOTYP — Variante A: Momos Insel als isometrisches Diorama (reines SVG, keine Bibliothek).
(function () {
  const TW = 60, TH = 30, DEPTH = 16, X0 = 270, Y0 = 120;
  const pos = (r, c) => [(c - r) * (TW / 2) + X0, (c + r) * (TH / 2) + Y0];
  const hash = (r, c) => (((r * 73856093) ^ (c * 19349663)) >>> 0) % 1000 / 1000;
  const pts = (a) => a.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const poly = (a, fill, extra = '') => `<polygon points="${pts(a)}" fill="${fill}" ${extra}/>`;
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => Math.max(0, Math.min(255, Math.round(f > 1 ? v + (255 - v) * (f - 1) : v * f)));
    return '#' + [ch(n >> 16), ch((n >> 8) & 255), ch(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  const SEASON = {
    Frühling: { grass: '#9fd774', leaves: ['#7cc35a', '#5aa548', '#a8dd7d'], accent: '#ffb3cf', water: ['#58c3dc', '#2d8fbf'] },
    Sommer: { grass: '#86ca5c', leaves: ['#4fa53f', '#3a8a35', '#7cc35a'], accent: null, water: ['#4cc4e0', '#1f88c2'] },
    Herbst: { grass: '#b9c46a', leaves: ['#e8913a', '#c9612a', '#f2b84b'], accent: null, water: ['#5bb8cf', '#2c7fa8'] },
    Winter: { grass: '#eef4f7', leaves: ['#4f8a5e', '#3c7050', '#6aa37a'], accent: '#ffffff', water: ['#79b9cf', '#3b7d9c'] },
  };

  function isoBox(x, y, hw, h, top, left, right) {
    return poly([[x - hw, y], [x, y + hw / 2], [x, y + hw / 2 - h], [x - hw, y - h]], left)
      + poly([[x, y + hw / 2], [x + hw, y], [x + hw, y - h], [x, y + hw / 2 - h]], right)
      + poly([[x, y - hw / 2 - h], [x + hw, y - h], [x, y + hw / 2 - h], [x - hw, y - h]], top);
  }
  function pyramid(x, y, e, rh, l, r) {
    const apex = [x, y - rh];
    return poly([apex, [x - e, y], [x, y + e / 2]], l) + poly([apex, [x, y + e / 2], [x + e, y]], r);
  }
  function gable(x, y, e, rh, front, back, end) {
    const B = [x, y - e / 2], R = [x + e, y], F = [x, y + e / 2], L = [x - e, y];
    const r1 = [x - e / 2, y - e / 4 - rh], r2 = [x + e / 2, y + e / 4 - rh];
    return poly([B, R, r2, r1], back) + poly([F, R, r2], end) + poly([L, F, r2, r1], front);
  }
  const shadow = (x, y, rx = 15, ry = 6) => `<ellipse cx="${x + 3}" cy="${y + 2}" rx="${rx}" ry="${ry}" fill="rgba(20,40,20,.22)"/>`;

  // ---------- Objekte ----------
  function tree(x, y, S, apples, k) {
    const [a, b, c] = S.leaves;
    let s = shadow(x, y, 16, 6) + `<rect x="${x - 2.5}" y="${y - 17}" width="5" height="17" rx="2" fill="#7a4a2c"/><rect x="${x}" y="${y - 17}" width="2.5" height="17" fill="#5e3820"/>`;
    s += `<circle cx="${x - 8}" cy="${y - 21}" r="10" fill="${b}"/><circle cx="${x + 8}" cy="${y - 22}" r="10" fill="${shade(b, 0.9)}"/><circle cx="${x}" cy="${y - 28}" r="13" fill="${a}"/><circle cx="${x - 4}" cy="${y - 33}" r="7.5" fill="${c}"/><circle cx="${x - 6}" cy="${y - 35}" r="2.8" fill="#fff" opacity=".35"/>`;
    if (S === SEASON.Winter) s += `<ellipse cx="${x - 1}" cy="${y - 38}" rx="10" ry="4" fill="#fff"/><ellipse cx="${x - 9}" cy="${y - 28}" rx="5" ry="2.4" fill="#fff"/>`;
    if (S.accent && S !== SEASON.Winter) [[-6, -26], [5, -31], [7, -20], [-2, -21]].forEach(([dx, dy]) => { s += `<circle cx="${x + dx}" cy="${y + dy}" r="2" fill="${S.accent}"/>`; });
    if (apples && S !== SEASON.Winter) [[-7, -22], [6, -27], [2, -18], [9, -19]].slice(0, 2 + Math.floor(k * 3)).forEach(([dx, dy]) => { s += `<circle cx="${x + dx}" cy="${y + dy}" r="2.4" fill="#e23b3b"/><circle cx="${x + dx - 0.7}" cy="${y + dy - 0.8}" r=".8" fill="#fff" opacity=".7"/>`; });
    return s;
  }
  function palm(x, y) {
    let s = shadow(x, y, 14, 5) + `<path d="M${x} ${y} q 4 -18 -2 -36" stroke="#9b6b3f" stroke-width="5" fill="none" stroke-linecap="round"/>`;
    [[-18, -30], [16, -32], [-12, -46], [12, -46], [0, -24]].forEach(([dx, dy]) => { s += `<path d="M${x - 2} ${y - 36} q ${dx / 2} -10 ${dx} ${dy + 36}" stroke="#3f9a49" stroke-width="5" fill="none" stroke-linecap="round"/>`; });
    return s + `<circle cx="${x - 3}" cy="${y - 34}" r="2.5" fill="#6b4423"/><circle cx="${x + 1}" cy="${y - 33}" r="2.5" fill="#6b4423"/>`;
  }
  function flowers(x, y, k) {
    const cols = ['#ff7aa8', '#ffd447', '#ffffff', '#b98cff', '#ff9a4d'];
    let s = '';
    [[-12, -1], [-5, -5], [3, -7], [10, -2], [-6, 3], [2, 1], [9, 5], [-1, 6]].forEach(([dx, dy], i) => {
      const cx = x + dx, cy = y + dy, col = cols[(i + Math.floor(k * 5)) % cols.length];
      s += `<line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - 6}" stroke="#3f8a3a" stroke-width="1.4"/><ellipse cx="${cx - 2}" cy="${cy - 2}" rx="2" ry="1" fill="#4f9d45"/>`;
      s += [[-1.8, 0], [1.8, 0], [0, -1.8], [0, 1.8]].map(([px, py]) => `<circle cx="${cx + px}" cy="${cy - 7 + py}" r="1.7" fill="${col}"/>`).join('') + `<circle cx="${cx}" cy="${cy - 7}" r="1.1" fill="#f5b400"/>`;
    });
    return s;
  }
  function mushrooms(x, y) {
    let s = '';
    [[-8, 0, 1], [5, -4, 0.8], [9, 4, 1.15], [-2, 6, 0.7]].forEach(([dx, dy, f]) => {
      const cx = x + dx, cy = y + dy;
      s += `<ellipse cx="${cx + 1}" cy="${cy + 1}" rx="${6 * f}" ry="${2.4 * f}" fill="rgba(0,0,0,.18)"/><rect x="${cx - 2 * f}" y="${cy - 7 * f}" width="${4 * f}" height="${7 * f}" rx="1.5" fill="#f4ead6"/>`;
      s += `<path d="M${cx - 7 * f} ${cy - 6 * f} q ${7 * f} -${10 * f} ${14 * f} 0 z" fill="#e0453a"/><circle cx="${cx - 2.5 * f}" cy="${cy - 9 * f}" r="${1.3 * f}" fill="#fff"/><circle cx="${cx + 2.5 * f}" cy="${cy - 8 * f}" r="${1.1 * f}" fill="#fff"/>`;
    });
    return s;
  }
  function rabbit(x, y) {
    return `<ellipse cx="${x - 6}" cy="${y + 3}" rx="10" ry="5" fill="#5b3d26"/><ellipse cx="${x - 6}" cy="${y + 3}" rx="7" ry="3" fill="#2d1d12"/>`
      + shadow(x + 5, y - 2, 8, 3) + `<ellipse cx="${x + 6}" cy="${y - 5}" rx="7" ry="5.5" fill="#fbfaf7"/><circle cx="${x + 12}" cy="${y - 10}" r="4.2" fill="#fbfaf7"/>`
      + `<ellipse cx="${x + 11}" cy="${y - 18}" rx="1.6" ry="5" fill="#fbfaf7" transform="rotate(-12 ${x + 11} ${y - 18})"/><ellipse cx="${x + 14}" cy="${y - 17}" rx="1.6" ry="5" fill="#fbfaf7" transform="rotate(14 ${x + 14} ${y - 17})"/>`
      + `<ellipse cx="${x + 11}" cy="${y - 18}" rx=".7" ry="3.5" fill="#f5b8c4" transform="rotate(-12 ${x + 11} ${y - 18})"/><circle cx="${x + 13.5}" cy="${y - 11}" r=".9" fill="#222"/><circle cx="${x - 1}" cy="${y - 5}" r="2.4" fill="#fff"/>`;
  }
  function pond(x, y) {
    let s = `<ellipse cx="${x}" cy="${y + 1}" rx="22" ry="11" fill="#8f8f86"/><ellipse cx="${x}" cy="${y}" rx="20" ry="9.5" fill="url(#pondGrad)"/>`;
    [[-22, 0], [-14, -8], [0, -10], [14, -8], [21, 0], [12, 8], [-12, 8]].forEach(([dx, dy]) => { s += `<ellipse cx="${x + dx}" cy="${y + dy}" rx="3" ry="2" fill="#a9a99c"/>`; });
    return s + `<ellipse cx="${x - 6}" cy="${y - 1}" rx="4.5" ry="2.2" fill="#4caf50"/><ellipse cx="${x + 7}" cy="${y + 3}" rx="4" ry="2" fill="#5cbf5a"/><circle cx="${x - 6}" cy="${y - 3}" r="2.2" fill="#ff8fb5"/><path d="M${x - 14} ${y - 2} q 4 -2 8 0" stroke="#fff" stroke-width=".8" fill="none" opacity=".7"/>`;
  }
  function path(x, y, k) {
    let s = '';
    [[-12, -2], [-4, -5], [5, -3], [13, 1], [-6, 3], [3, 5]].forEach(([dx, dy], i) => {
      const tone = i % 2 ? '#c9c2b2' : '#b5ad9c';
      s += `<ellipse cx="${x + dx}" cy="${y + dy + 1}" rx="${5 + (k * 2)}" ry="2.6" fill="rgba(0,0,0,.15)"/><ellipse cx="${x + dx}" cy="${y + dy}" rx="${5 + (k * 2)}" ry="2.6" fill="${tone}"/>`;
    });
    return s;
  }
  function bench(x, y) {
    let s = shadow(x, y, 13, 4);
    [[-8, 2], [8, -2], [-3, 5], [12, 1]].forEach(([dx, dy]) => { s += `<rect x="${x + dx - 1}" y="${y + dy - 6}" width="2" height="6" fill="#5e3820"/>`; });
    s += poly([[x - 11, y - 4], [x + 3, y - 11], [x + 14, y - 6], [x, y + 1]], '#b9783f') + poly([[x - 11, y - 4], [x, y + 1], [x, y + 3], [x - 11, y - 2]], '#8a5530') + poly([[x, y + 1], [x + 14, y - 6], [x + 14, y - 4], [x, y + 3]], '#9c6236');
    s += poly([[x - 11, y - 4], [x + 3, y - 11], [x + 3, y - 20], [x - 11, y - 13]], '#c98a4c') + `<line x1="${x - 11}" y1="${y - 9}" x2="${x + 3}" y2="${y - 16}" stroke="#8a5530" stroke-width="1"/>`;
    return s;
  }
  function lantern(x, y, evening) {
    return `<circle cx="${x}" cy="${y - 34}" r="${evening ? 26 : 12}" fill="url(#glow)" opacity="${evening ? 1 : 0.35}" class="glow"/>`
      + shadow(x, y, 6, 2.5) + `<rect x="${x - 1.6}" y="${y - 30}" width="3.2" height="30" fill="#3a3a44"/><rect x="${x - 4}" y="${y - 2}" width="8" height="3" rx="1" fill="#3a3a44"/>`
      + isoBox(x, y - 30, 5, 9, '#ffe69a', evening ? '#ffd35c' : '#f5e3a8', evening ? '#ffc93a' : '#e8d391') + pyramid(x, y - 39, 6.5, 6, '#3a3a44', '#2a2a32');
  }
  function hut(x, y, evening) {
    let s = shadow(x, y + 2, 22, 9) + isoBox(x, y, 17, 15, '#e7c793', '#e2bd85', '#c99f63');
    s += poly([[x + 5, y + 6], [x + 11, y + 3], [x + 11, y - 7], [x + 5, y - 4]], '#6b4423');
    s += poly([[x - 12, y - 4], [x - 6, y - 1], [x - 6, y - 7], [x - 12, y - 10]], evening ? '#ffd35c' : '#8fc7d8');
    return s + pyramid(x, y - 15, 21, 18, '#e6c35c', '#c9a33f') + `<path d="M${x - 21} ${y - 15} L${x} ${y - 4.5} L${x + 21} ${y - 15}" stroke="#a88430" stroke-width="1.2" fill="none"/>`;
  }
  function gardenhouse(x, y, evening) {
    let s = shadow(x, y + 3, 28, 11) + isoBox(x, y, 22, 20, '#f7f1e6', '#f1e9da', '#d8ccb6');
    s += poly([[x + 7, y + 8], [x + 14, y + 4.5], [x + 14, y - 9], [x + 7, y - 5.5]], '#7a4a2c');
    const win = evening ? '#ffd35c' : '#9fd3e3';
    s += poly([[x - 17, y - 5], [x - 9, y - 1], [x - 9, y - 9], [x - 17, y - 13]], win) + poly([[x + 16, y - 5], [x + 20, y - 7], [x + 20, y - 14], [x + 16, y - 12]], win);
    s += `<rect x="${x + 8}" y="${y - 52}" width="6" height="14" fill="#a5523d"/>` + gable(x, y - 20, 26, 18, '#d9544a', '#b8403c', '#f1e9da');
    return s + flowers(x - 20, y + 10, 0.3);
  }
  function fountain(x, y) {
    return shadow(x, y, 20, 8) + `<ellipse cx="${x}" cy="${y}" rx="19" ry="9.5" fill="#a7a59c"/><ellipse cx="${x}" cy="${y - 3}" rx="19" ry="9.5" fill="#cfccc2"/><ellipse cx="${x}" cy="${y - 3}" rx="15" ry="7" fill="url(#pondGrad)"/>`
      + `<rect x="${x - 2.5}" y="${y - 22}" width="5" height="19" fill="#bdb9ad"/><ellipse cx="${x}" cy="${y - 22}" rx="7" ry="3" fill="#cfccc2"/>`
      + `<path d="M${x} ${y - 24} q -9 -6 -12 14 M${x} ${y - 24} q 9 -6 12 14" stroke="#bfefff" stroke-width="1.6" fill="none" class="spray"/>`;
  }
  function lighthouse(x, y, evening) {
    let s = shadow(x, y, 14, 6);
    for (let i = 0; i < 4; i++) {
      const y1 = y - i * 12, w1 = 10 - i * 1.3, w2 = 10 - (i + 1) * 1.3;
      s += poly([[x - w1, y1], [x + w1, y1], [x + w2, y1 - 12], [x - w2, y1 - 12]], i % 2 ? '#fff' : '#d9443c');
    }
    return s + `<circle cx="${x}" cy="${y - 54}" r="${evening ? 34 : 14}" fill="url(#glow)" opacity="${evening ? 1 : 0.4}" class="glow"/><rect x="${x - 6}" y="${y - 58}" width="12" height="9" fill="#ffe17a"/>` + pyramid(x, y - 58, 8, 8, '#d9443c', '#a8322c');
  }
  function dock(x, y) {
    let s = '';
    for (let i = 0; i < 5; i++) { const dx = -14 + i * 7, dy = -7 + i * 3.5; s += poly([[x + dx - 6, y + dy], [x + dx, y + dy - 3], [x + dx + 6, y + dy], [x + dx, y + dy + 3]], i % 2 ? '#b98552' : '#a77443'); }
    return s + `<rect x="${x + 12}" y="${y - 8}" width="2.5" height="12" fill="#6b4423"/><path d="M${x + 10} ${y + 10} q 6 -16 2 -26 l 10 18 z" fill="#fff"/><path d="M${x + 2} ${y + 10} q 12 6 22 0 z" fill="#d9443c"/>`;
  }
  function bridge(x, y) {
    return `<path d="M${x - 22} ${y + 4} Q ${x} ${y - 22} ${x + 22} ${y - 4}" stroke="#8a5530" stroke-width="8" fill="none"/><path d="M${x - 22} ${y + 4} Q ${x} ${y - 22} ${x + 22} ${y - 4}" stroke="#c98a4c" stroke-width="4" fill="none"/>`
      + `<path d="M${x - 22} ${y - 6} Q ${x} ${y - 32} ${x + 22} ${y - 14}" stroke="#6b4423" stroke-width="1.5" fill="none"/>` + [-16, -6, 4, 14].map((d) => `<line x1="${x + d}" y1="${y - 6 - (d < 0 ? 12 + d / 2 : 14 - d / 2)}" x2="${x + d}" y2="${y + 4 - (d < 0 ? 12 + d / 2 : 14 - d / 2)}" stroke="#6b4423" stroke-width="1.5"/>`).join('');
  }
  const emojiItem = (x, y, e, size = 22) => shadow(x - 2, y, 10, 4) + `<text x="${x}" y="${y - 2}" font-size="${size}" text-anchor="middle">${e}</text>`;
  function scaffold(x, y, pr) {
    const done = pr.bau.have + pr.natur.have, need = pr.bau.need + pr.natur.need;
    let s = shadow(x, y + 2, 22, 9) + poly([[x - 18, y], [x, y + 9], [x + 18, y], [x, y - 9]], '#d7c19a');
    [[-16, 0], [0, 8], [16, 0], [0, -8]].forEach(([dx, dy]) => { s += `<rect x="${x + dx - 1.2}" y="${y + dy - 28}" width="2.4" height="28" fill="#9c6b3d"/>`; });
    s += `<line x1="${x - 16}" y1="${y - 18}" x2="${x}" y2="${y - 10}" stroke="#b98552" stroke-width="2.5"/><line x1="${x}" y1="${y - 10}" x2="${x + 16}" y2="${y - 18}" stroke="#b98552" stroke-width="2.5"/>`;
    s += `<rect x="${x + 6}" y="${y - 2}" width="12" height="5" fill="#c98a4c"/><rect x="${x + 8}" y="${y - 6}" width="12" height="5" fill="#b9783f"/>`;
    return s + `<g class="bob"><rect x="${x - 26}" y="${y - 56}" width="52" height="18" rx="9" fill="#fff" stroke="#f2c14e" stroke-width="2"/><text x="${x}" y="${y - 43}" font-size="11" font-weight="800" text-anchor="middle" fill="#5a4210">${pr.emoji} ${done}/${need}</text></g>`;
  }
  function momo(x, y, scale, acc, evening) {
    const fs = 34 * scale;
    return `<ellipse cx="${x}" cy="${y + 2}" rx="${20 * scale}" ry="${8 * scale}" fill="${evening ? 'rgba(255,230,140,.35)' : 'rgba(255,255,255,.45)'}"/>`
      + `<ellipse cx="${x}" cy="${y + 1}" rx="${12 * scale}" ry="${4 * scale}" fill="rgba(0,0,0,.2)"/>`
      + `<g class="momo-bounce"><text x="${x}" y="${y}" font-size="${fs}" text-anchor="middle">🐣</text>${acc ? `<text x="${x + fs * 0.32}" y="${y - fs * 0.62}" font-size="${fs * 0.45}" text-anchor="middle">${acc}</text>` : ''}</g>`;
  }
  function nest(x, y) {
    return `<ellipse cx="${x}" cy="${y}" rx="14" ry="6" fill="#c9a24f"/><ellipse cx="${x}" cy="${y - 1}" rx="10" ry="4" fill="#a8822f"/><path d="M${x - 14} ${y} q 6 -4 12 -1 q 6 -3 14 1" stroke="#e2c26a" fill="none"/>`;
  }

  function drawItem(it, x, y, S, k, evening) {
    if (it.t === 'deco') return emojiItem(x, y, ({ muschel: '🐚', flaschenpost: '🍾', treibholz: '🪵', bernstein: '🟠', sonnenblume: '🌻', kirsch: '🌸', osterei: '🥚', schirm: '⛱️', eis: '🍦', kuerbis: '🎃', ahorn: '🍁', schneemann: '⛄', stern: '🌟' })[it.id] || '❓');
    switch (it.id) {
      case 'baum': return tree(x, y, S, true, k);
      case 'palme': return palm(x, y);
      case 'blume': return flowers(x, y, k);
      case 'pilz': return mushrooms(x, y);
      case 'hase': return rabbit(x, y);
      case 'teich': return pond(x, y);
      case 'weg': return path(x, y, k);
      case 'bank': return bench(x, y);
      case 'laterne': return lantern(x, y, evening);
      case 'huette': return hut(x, y, evening);
      case 'gartenhaus': return gardenhouse(x, y, evening);
      case 'brunnen': return fountain(x, y);
      case 'leuchtfeuer': return lighthouse(x, y, evening);
      case 'steg': return dock(x, y);
      case 'bruecke': return bridge(x, y);
      default: return emojiItem(x, y, '❓');
    }
  }

  function particles(season) {
    const kind = { Frühling: ['#ffc0d6', 'petal'], Sommer: ['#fff6a8', 'spark'], Herbst: ['#e8913a', 'leaf'], Winter: ['#ffffff', 'snow'] }[season];
    let s = '';
    for (let i = 0; i < 14; i++) {
      const x = 90 + ((i * 137) % 380), d = (i * 0.83) % 7, dur = 7 + (i % 5);
      s += kind[1] === 'leaf'
        ? `<ellipse class="fall" style="animation-delay:-${d}s;animation-duration:${dur}s" cx="${x}" cy="-160" rx="4" ry="2" fill="${i % 2 ? kind[0] : '#c9612a'}"/>`
        : `<circle class="${kind[1] === 'spark' ? 'twinkle' : 'fall'}" style="animation-delay:-${d}s;animation-duration:${dur}s" cx="${x}" cy="${kind[1] === 'spark' ? (i * 53) % 400 : -160}" r="${kind[1] === 'snow' ? 2.2 : 1.8}" fill="${kind[0]}"/>`;
    }
    return s;
  }

  function render(state, o) {
    const S = SEASON[state.season];
    const ev = state.evening;
    const zoneTint = { eckeIch: 'rgba(60,157,103,.28)', bau: 'rgba(60,157,103,.16)', natur: 'rgba(227,155,63,.2)', eckePartner: 'rgba(227,155,63,.3)', gemein: 'rgba(255,255,255,.35)', nord: 'rgba(120,180,220,.25)' };
    const plots = [...state.plots].sort((a, b) => (a.r + a.c) - (b.r + b.c) || a.c - b.c);
    let foam = '', tiles = '';
    plots.forEach((p) => {
      const [x, y] = pos(p.r, p.c);
      foam += poly([[x, y - TH / 2 - 4 + DEPTH], [x + TW / 2 + 8, y + DEPTH], [x, y + TH / 2 + 4 + DEPTH], [x - TW / 2 - 8, y + DEPTH]], '#c8f1f7', 'class="foam"');
    });
    let markerIdx = 0;
    const strand = plots.filter((p) => p.zone === 'strand');
    plots.forEach((p) => {
      const [x, y] = pos(p.r, p.c);
      const k = hash(p.r, p.c);
      const sand = p.zone === 'strand';
      const base = sand ? '#f1dca2' : (p.zone === 'gemein' ? shade(S.grass, 1.06) : S.grass);
      const top = shade(base, 0.96 + k * 0.08);
      const sideL = sand ? '#d9bd7a' : '#b07a4f', sideR = sand ? '#c4a565' : '#8f5e3a';
      const T = [[x, y - TH / 2], [x + TW / 2, y], [x, y + TH / 2], [x - TW / 2, y]];
      let g = poly([[x - TW / 2, y], [x, y + TH / 2], [x, y + TH / 2 + DEPTH], [x - TW / 2, y + DEPTH]], sideL)
        + poly([[x, y + TH / 2], [x + TW / 2, y], [x + TW / 2, y + DEPTH], [x, y + TH / 2 + DEPTH]], sideR);
      if (!sand) g += poly([[x - TW / 2, y], [x, y + TH / 2], [x, y + TH / 2 + 4], [x - TW / 2, y + 4]], shade(base, 0.82)) + poly([[x, y + TH / 2], [x + TW / 2, y], [x + TW / 2, y + 4], [x, y + TH / 2 + 4]], shade(base, 0.72));
      g += poly(T, top);
      if (!sand && k > 0.55 && !p.item) g += `<path d="M${x - 8 + k * 10} ${y + 2} l1.5 -4 l1.5 4 M${x + 4 - k * 6} ${y - 4} l1.2 -3 l1.2 3" stroke="${shade(base, 0.75)}" stroke-width="1" fill="none"/>`;
      if (sand && k > 0.5) g += `<circle cx="${x - 6 + k * 8}" cy="${y + 2}" r="1.2" fill="#e5c98a"/><circle cx="${x + 8 - k * 4}" cy="${y - 3}" r="1" fill="#e5c98a"/>`;
      if (state.labels && zoneTint[p.zone]) g += poly(T, zoneTint[p.zone]);
      if (o.valid.has(p.id)) g += poly(T, '#fff', 'class="valid" stroke="#fff" stroke-width="2"');
      const pop = p.fresh && Date.now() - p.fresh < 1200 ? ' pop' : '';
      if (p.item) g += `<g class="obj${pop}">${drawItem(p.item, x, y, S, k, ev)}</g>`;
      else if (p.zone === 'gemein' && p.r === 3 && p.c === 4) g += scaffold(x, y, state.project);
      else if (p.zone === 'momo') g += p.r === 4 ? momo(x, y + 2, o.momoScale, o.momoAcc, ev) : nest(x, y);
      if (sand && markerIdx < o.events.length && strand.indexOf(p) % 1 === 0) {
        const e = o.events[markerIdx++];
        g += `<g class="bob" style="animation-delay:-${markerIdx * 0.4}s"><circle cx="${x}" cy="${y - 20}" r="14" fill="#fff" stroke="${e.status === 'neu' ? '#f2c14e' : '#cfd8dc'}" stroke-width="2.5"/><text x="${x}" y="${y - 14.5}" font-size="16" text-anchor="middle">${e.emoji}</text>${e.status === 'neu' ? `<circle cx="${x + 11}" cy="${y - 31}" r="4" fill="#e0435b"/>` : ''}</g>`;
      }
      tiles += `<g class="plot" role="button" aria-label="Feld ${p.id} ${p.zone}${p.item ? ' ' + p.item.id : ''}${o.valid.has(p.id) ? ' frei' : ''}" data-action="plot" data-plot="${p.id}">${g}</g>`;
    });

    // Nebel über gesperrtem Nordstrand
    let fog = '';
    if (!state.nordOpen) {
      state.plots.filter((p) => p.zone === 'nord').forEach((p, i) => {
        const [x, y] = pos(p.r, p.c);
        fog += `<g class="drift" style="animation-delay:-${i * 0.9}s" data-action="plot" data-plot="${p.id}"><ellipse cx="${x}" cy="${y - 8}" rx="34" ry="18" fill="#fff" opacity=".82"/><ellipse cx="${x - 14}" cy="${y - 16}" rx="18" ry="12" fill="#fff" opacity=".9"/><ellipse cx="${x + 16}" cy="${y - 14}" rx="20" ry="11" fill="#fff" opacity=".85"/></g>`;
      });
      const [fx, fy] = pos(0.6, 3.2);
      fog += `<text x="${fx}" y="${fy - 30}" font-size="12" font-weight="800" fill="#5f7d8c" text-anchor="middle">☁️ Nordstrand · ab Level 5</text>`;
    }

    // Bereichsnamen
    let labels = '';
    if (state.labels) {
      const groups = {};
      state.plots.forEach((p) => { (groups[p.zone] ||= []).push(p); });
      const names = { eckeIch: 'Meine Ecke', bau: 'Bauen 🔨', natur: 'Natur 🌿', eckePartner: 'Ecke Partnerin', gemein: 'Gemeinschaft', momo: 'Momo' };
      Object.entries(names).forEach(([z, n]) => {
        const g = groups[z]; if (!g) return;
        const r = g.reduce((s, p) => s + p.r, 0) / g.length, c = g.reduce((s, p) => s + p.c, 0) / g.length;
        const [x, y] = pos(r, c);
        labels += `<g><rect x="${x - n.length * 3.4 - 6}" y="${y - 48}" width="${n.length * 6.8 + 12}" height="17" rx="8.5" fill="rgba(23,33,27,.72)"/><text x="${x}" y="${y - 36}" font-size="11" font-weight="700" fill="#fff" text-anchor="middle">${n}</text></g>`;
      });
    }

    const [w1, w2] = ev ? ['#2b4f7a', '#16294a'] : S.water;
    const stars = ev ? Array.from({ length: 26 }, (_, i) => `<circle class="twinkle" style="animation-delay:-${i % 5}s" cx="${90 + (i * 97) % 380}" cy="${-140 + (i * 61) % 200}" r="${i % 3 ? 0.9 : 1.5}" fill="#fff"/>`).join('') : '';
    return `<svg class="iso" viewBox="112 -95 346 580" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${w1}"/><stop offset="1" stop-color="${w2}"/></linearGradient>
        <radialGradient id="pondGrad"><stop offset="0" stop-color="#7fd3ea"/><stop offset="1" stop-color="#3a9cc4"/></radialGradient>
        <radialGradient id="glow"><stop offset="0" stop-color="#ffe9a0" stop-opacity=".95"/><stop offset=".4" stop-color="#ffd35c" stop-opacity=".45"/><stop offset="1" stop-color="#ffd35c" stop-opacity="0"/></radialGradient>
        <radialGradient id="shallow" cx=".5" cy=".55" r=".5"><stop offset=".55" stop-color="#9fe3ef" stop-opacity=".55"/><stop offset="1" stop-color="#9fe3ef" stop-opacity="0"/></radialGradient>
      </defs>
      <rect x="-300" y="-500" width="1200" height="1400" fill="url(#sea)"/>
      ${stars}
      <g class="waves" stroke="#fff" stroke-opacity=".28" stroke-width="1.5" fill="none" stroke-linecap="round">
        ${Array.from({ length: 12 }, (_, i) => `<path class="wave" style="animation-delay:-${i * 0.7}s" d="M${90 + (i * 83) % 360} ${-120 + (i * 41) % 600} q 8 -5 16 0 t 16 0"/>`).join('')}
      </g>
      <ellipse cx="${X0 + 10}" cy="${Y0 + 140}" rx="300" ry="170" fill="url(#shallow)"/>
      <g class="boat"><path d="M-14 0 q 14 8 28 0 z" fill="#8a5530"/><path d="M0 -2 l0 -22 l13 20 z" fill="#fff"/><path d="M-1 -4 l0 -16 l-9 15 z" fill="#f2c14e"/></g>
      <g>${foam}</g>
      <g>${tiles}</g>
      ${fog}
      ${labels}
      ${ev ? '<rect x="-300" y="-500" width="1200" height="1400" fill="#1b2350" opacity=".28" pointer-events="none" style="mix-blend-mode:multiply"/>' : ''}
      <g pointer-events="none">${particles(state.season)}</g>
    </svg>`;
  }

  window.IslandIso = { render };
})();
