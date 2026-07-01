/* Generates solvable QuiltDrop levels and injects them into index.html.
   Determinism: seeded mulberry32 PRNG, so re-running produces identical output. */
const fs = require('fs');
const path = require('path');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LETTERS = ['A', 'B', 'C', 'D', 'E'];

function key(r, c) { return r + ',' + c; }
function neighbors(r, c, rows, cols) {
  const out = [];
  if (r > 0) out.push([r - 1, c]);
  if (r < rows - 1) out.push([r + 1, c]);
  if (c > 0) out.push([r, c - 1]);
  if (c < cols - 1) out.push([r, c + 1]);
  return out;
}

// Partition a rows x cols board into `zones` contiguous regions via balanced
// multi-source region growing. Returns 2D array of zone letters (no nulls).
function partition(rows, cols, zones, rng) {
  const total = rows * cols;
  const owner = {}; // "r,c" -> region id
  const sizes = new Array(zones).fill(0);
  const frontier = Array.from({ length: zones }, () => []); // arrays of [r,c]

  // pick distinct seeds
  const seedSet = new Set();
  const seeds = [];
  while (seeds.length < zones) {
    const r = Math.floor(rng() * rows);
    const c = Math.floor(rng() * cols);
    const k = key(r, c);
    if (!seedSet.has(k)) { seedSet.add(k); seeds.push([r, c]); }
  }
  seeds.forEach((s, id) => {
    owner[key(s[0], s[1])] = id;
    sizes[id] = 1;
    neighbors(s[0], s[1], rows, cols).forEach(n => frontier[id].push(n));
  });

  let claimed = zones;
  while (claimed < total) {
    // choose the smallest region that still has unclaimed frontier cells
    let best = -1;
    for (let id = 0; id < zones; id++) {
      // prune frontier of already-owned cells
      frontier[id] = frontier[id].filter(([r, c]) => owner[key(r, c)] === undefined);
      if (frontier[id].length === 0) continue;
      if (best === -1 || sizes[id] < sizes[best]) best = id;
    }
    if (best === -1) break; // shouldn't happen with a connected board
    const fr = frontier[best];
    const pick = fr[Math.floor(rng() * fr.length)];
    const k = key(pick[0], pick[1]);
    if (owner[k] !== undefined) continue;
    owner[k] = best;
    sizes[best]++;
    claimed++;
    neighbors(pick[0], pick[1], rows, cols).forEach(n => {
      if (owner[key(n[0], n[1])] === undefined) frontier[best].push(n);
    });
  }

  const grid = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) row.push(LETTERS[owner[key(r, c)]]);
    grid.push(row);
  }
  return { grid, sizes };
}

// Carve a zone's cells into connected polyomino pieces (a real tiling => solvable).
function tileZone(cells, rng, minSize, maxSize) {
  const remaining = new Set(cells.map(([r, c]) => key(r, c)));
  const coordOf = k => k.split(',').map(Number);
  const pieces = [];
  while (remaining.size > 0) {
    // seed: topmost-leftmost remaining cell (deterministic)
    let seed = null;
    for (const k of remaining) {
      const [r, c] = coordOf(k);
      if (!seed || r < seed[0] || (r === seed[0] && c < seed[1])) seed = [r, c];
    }
    const target = Math.min(
      minSize + Math.floor(rng() * (maxSize - minSize + 1)),
      remaining.size
    );
    const blob = [seed];
    remaining.delete(key(seed[0], seed[1]));
    let frontier = neighbors(seed[0], seed[1], 1e9, 1e9).filter(([r, c]) => remaining.has(key(r, c)));
    while (blob.length < target && frontier.length > 0) {
      const pi = Math.floor(rng() * frontier.length);
      const [r, c] = frontier[pi];
      frontier.splice(pi, 1);
      if (!remaining.has(key(r, c))) continue;
      blob.push([r, c]);
      remaining.delete(key(r, c));
      neighbors(r, c, 1e9, 1e9).forEach(n => {
        if (remaining.has(key(n[0], n[1]))) frontier.push(n);
      });
    }
    pieces.push(blob);
  }
  return pieces;
}

// Fold every 1-cell blob into its smallest edge-adjacent neighbour blob so the
// piece set has few/no trivial single-square pieces. All blobs here belong to a
// single connected zone, so a singleton always has an in-zone neighbour.
function mergeSingletons(blobs) {
  const mapOf = () => {
    const m = {};
    blobs.forEach((b, bi) => b.forEach(([r, c]) => { m[key(r, c)] = bi; }));
    return m;
  };
  let guard = 0;
  while (guard++ < 1000) {
    const si = blobs.findIndex(b => b.length === 1);
    if (si === -1) break;
    const map = mapOf();
    const [r, c] = blobs[si][0];
    let bestBi = -1, bestSize = Infinity;
    for (const [nr, nc] of neighbors(r, c, 1e9, 1e9)) {
      const k = key(nr, nc);
      if (!(k in map) || map[k] === si) continue;
      if (blobs[map[k]].length < bestSize) { bestSize = blobs[map[k]].length; bestBi = map[k]; }
    }
    if (bestBi === -1) break; // isolated singleton (only if zone size is 1)
    blobs[bestBi] = blobs[bestBi].concat(blobs[si]);
    blobs.splice(si, 1);
  }
  return blobs;
}

function blobToShape(blob) {
  const minR = Math.min(...blob.map(b => b[0]));
  const minC = Math.min(...blob.map(b => b[1]));
  const maxR = Math.max(...blob.map(b => b[0]));
  const maxC = Math.max(...blob.map(b => b[1]));
  const h = maxR - minR + 1, w = maxC - minC + 1;
  const shape = Array.from({ length: h }, () => new Array(w).fill(0));
  blob.forEach(([r, c]) => { shape[r - minR][c - minC] = 1; });
  return { shape, area: blob.length, h, w };
}

function labelFor(s) {
  if (s.area === 1) return '1×1';
  const filledRect = s.area === s.h * s.w;
  if (filledRect) return `${s.h}×${s.w}`;
  if (s.area === 3) return 'L-tri';
  if (s.area === 4) return 'tetromino';
  return s.h >= s.w ? 'tall-piece' : 'wide-piece';
}

/* ===================== pure-logic helpers =====================
   A zone is an independent sub-puzzle: tile `cells` with a given multiset of
   non-rotating polyomino shapes. We want exactly ONE tiling (unique solution),
   ideally reachable by forced-move deduction (no guessing). */

function shapeStr(shape) { return shape.map(row => row.join('')).join('/'); }
function relCellsOf(shape) {
  const out = [];
  shape.forEach((row, r) => row.forEach((on, c) => { if (on) out.push([r, c]); }));
  return out;
}
// distinct shapes with multiplicity + their relative occupied cells
function shapeMultiset(shapes) {
  const m = {};
  shapes.forEach(sh => { const k = shapeStr(sh); (m[k] = m[k] || { rel: relCellsOf(sh), count: 0 }).count++; });
  return Object.values(m);
}

// Count distinct tilings (capped at 2 — we only care whether it's exactly 1).
// Always fills the lowest uncovered cell, so each partition is counted once and
// interchangeable identical pieces don't inflate the count.
function countTilings(cells, shapes) {
  const cellSet = new Set(cells.map(([r, c]) => key(r, c)));
  const dist = shapeMultiset(shapes);
  const covered = new Set();
  let solutions = 0;
  const sorted = cells.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  function lowest() {
    for (const [r, c] of sorted) if (!covered.has(key(r, c))) return [r, c];
    return null;
  }
  function rec(remaining) {
    if (solutions > 1) return;
    if (remaining === 0) { solutions++; return; }
    const [cr, cc] = lowest();
    for (const d of dist) {
      if (d.count === 0) continue;
      for (const [ar, ac] of d.rel) {
        const placed = d.rel.map(([rr, ccx]) => [cr - ar + rr, cc - ac + ccx]);
        let ok = true;
        for (const [pr, pc] of placed) { const k = key(pr, pc); if (!cellSet.has(k) || covered.has(k)) { ok = false; break; } }
        if (!ok) continue;
        placed.forEach(([pr, pc]) => covered.add(key(pr, pc)));
        d.count--;
        rec(remaining - placed.length);
        d.count++;
        placed.forEach(([pr, pc]) => covered.delete(key(pr, pc)));
        if (solutions > 1) return;
      }
    }
  }
  rec(cells.length);
  return solutions;
}

// True if the (unique) tiling is reachable by repeatedly placing the only piece
// that can cover some still-empty cell — i.e. solvable by pure deduction.
function forcedDeducible(cells, shapes) {
  const cellSet = new Set(cells.map(([r, c]) => key(r, c)));
  const dist = shapeMultiset(shapes).map(d => ({ rel: d.rel, count: d.count }));
  const covered = new Set();
  let remaining = cells.length;
  function placementsCovering(cr, cc) {
    const res = [];
    for (let di = 0; di < dist.length; di++) {
      const d = dist[di];
      if (d.count === 0) continue;
      for (const [ar, ac] of d.rel) {
        const placed = d.rel.map(([rr, ccx]) => [cr - ar + rr, cc - ac + ccx]);
        let ok = true;
        for (const [pr, pc] of placed) { const k = key(pr, pc); if (!cellSet.has(k) || covered.has(k)) { ok = false; break; } }
        if (ok) res.push({ di, placed });
      }
    }
    return res;
  }
  while (remaining > 0) {
    let forced = null;
    for (const [r, c] of cells) {
      if (covered.has(key(r, c))) continue;
      const pls = placementsCovering(r, c);
      if (pls.length === 0) return false;       // contradiction
      if (pls.length === 1) { forced = pls[0]; break; }
    }
    if (!forced) return false;                  // every empty cell is ambiguous -> needs a guess
    dist[forced.di].count--;
    forced.placed.forEach(([pr, pc]) => covered.add(key(pr, pc)));
    remaining -= forced.placed.length;
  }
  return true;
}

// Find a decomposition of one zone whose tiling is unique (and ideally
// forced-deducible). Returns { shapes, unique, deducible }.
function decomposeUniqueZone(cells, rng, minSize, maxSize) {
  let best = null;
  for (let a = 0; a < 160; a++) {
    const blobs = mergeSingletons(tileZone(cells.map(c => c.slice()), rng, minSize, maxSize));
    const shapes = blobs.map(b => blobToShape(b).shape);
    const tilings = countTilings(cells, shapes);
    if (tilings === 1) {
      const deducible = forcedDeducible(cells, shapes);
      const cand = { shapes, unique: true, deducible };
      if (deducible) return cand;               // perfect: unique + no guessing
      if (!best || !best.unique) best = cand;    // unique but needs look-ahead
    } else if (!best) {
      best = { shapes, unique: false, deducible: false }; // fallback: still solvable
    }
  }
  return best;
}

/* ===================== tetromino-only generation =====================
   Every piece is a real tetromino (4 cells). We tile the WHOLE board with
   tetrominoes, then group adjacent tetrominoes into colored zones — so each
   zone's area is a multiple of 4 and is tetromino-tileable by construction.
   Board area must be a multiple of 4. Pieces do not rotate, so each tetromino
   orientation is its own fixed shape. */
const TETROMINOES = [
  [[1, 1, 1, 1]], [[1], [1], [1], [1]],                                   // I
  [[1, 1], [1, 1]],                                                       // O
  [[1, 1, 1], [0, 1, 0]], [[0, 1], [1, 1], [0, 1]], [[0, 1, 0], [1, 1, 1]], [[1, 0], [1, 1], [1, 0]], // T
  [[0, 1, 1], [1, 1, 0]], [[1, 0], [1, 1], [0, 1]],                       // S
  [[1, 1, 0], [0, 1, 1]], [[0, 1], [1, 1], [1, 0]],                       // Z
  [[1, 0, 0], [1, 1, 1]], [[1, 1], [1, 0], [1, 0]], [[1, 1, 1], [0, 0, 1]], [[0, 1], [0, 1], [1, 1]], // J
  [[0, 0, 1], [1, 1, 1]], [[1, 0], [1, 0], [1, 1]], [[1, 1, 1], [1, 0, 0]], [[1, 1], [0, 1], [0, 1]], // L
];

function shuffledIndices(n, rng) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Backtracking tetromino tiling of the whole board. Returns [{cells, shape}].
// Backtracking tetromino tiling of an arbitrary region (a set of allowed cells,
// so boards can be any shape — hearts, arrows, etc.). Returns [{cells, shape}].
function tileRegionTetromino(cellList, rows, cols, rng) {
  const allowed = new Set(cellList.map(([r, c]) => r * cols + c));
  const order = [...allowed].sort((a, b) => a - b);
  const filled = new Set();
  const oris = TETROMINOES.map(sh => ({ shape: sh, rel: relCellsOf(sh) }));
  const placements = [];
  function lowest() { for (const i of order) if (!filled.has(i)) return i; return -1; }
  function rec() {
    const idx = lowest();
    if (idx === -1) return true;
    const cr = Math.floor(idx / cols), cc = idx % cols;
    for (const oi of shuffledIndices(oris.length, rng)) {
      const o = oris[oi];
      for (const [ar, ac] of o.rel) {
        const cells = []; let ok = true;
        for (const [rr, ccx] of o.rel) {
          const R = cr - ar + rr, C = cc - ac + ccx;
          const ci = R * cols + C;
          if (R < 0 || R >= rows || C < 0 || C >= cols || !allowed.has(ci) || filled.has(ci)) { ok = false; break; }
          cells.push(ci);
        }
        if (!ok) continue;
        cells.forEach(ci => filled.add(ci));
        placements.push({ cells, shape: o.shape });
        if (rec()) return true;
        placements.pop();
        cells.forEach(ci => filled.delete(ci));
      }
    }
    return false;
  }
  return rec() ? placements : null;
}

// Group whole tetrominoes into `zones` contiguous, size-balanced groups.
function groupTetrominoes(placements, zones, rng, rows, cols) {
  const n = placements.length;
  if (n < zones) return null;
  const owner = {};
  placements.forEach((p, i) => p.cells.forEach(ci => { owner[ci] = i; }));
  const adj = Array.from({ length: n }, () => new Set());
  for (let i = 0; i < n; i++)
    for (const ci of placements[i].cells) {
      const r = Math.floor(ci / cols), c = ci % cols;
      for (const [nr, nc] of neighbors(r, c, rows, cols)) {
        const j = owner[nr * cols + nc];
        if (j !== undefined && j !== i) { adj[i].add(j); adj[j].add(i); }
      }
    }
  const group = new Array(n).fill(-1);
  const sizes = new Array(zones).fill(0);
  const frontier = Array.from({ length: zones }, () => []);
  const seedSet = new Set(), seeds = [];
  while (seeds.length < zones) { const s = Math.floor(rng() * n); if (!seedSet.has(s)) { seedSet.add(s); seeds.push(s); } }
  seeds.forEach((s, g) => { group[s] = g; sizes[g] = 1; adj[s].forEach(j => frontier[g].push(j)); });
  let assigned = zones;
  while (assigned < n) {
    let best = -1;
    for (let g = 0; g < zones; g++) {
      frontier[g] = frontier[g].filter(j => group[j] === -1);
      if (!frontier[g].length) continue;
      if (best === -1 || sizes[g] < sizes[best]) best = g;
    }
    if (best === -1) break;
    const fr = frontier[best];
    const pick = fr[Math.floor(rng() * fr.length)];
    if (group[pick] !== -1) continue;
    group[pick] = best; sizes[best]++; assigned++;
    adj[pick].forEach(j => { if (group[j] === -1) frontier[best].push(j); });
  }
  return group.some(g => g === -1) ? null : group;
}

/* ---- board shapes (masks) ---- */
// A mask is an array of strings; '#' = a cell, anything else = empty (void).
function rectMask(h, w) { return Array.from({ length: h }, () => '#'.repeat(w)); }
// Expand a 2x2-block grid into a cell mask. Building shapes out of 2x2 blocks
// guarantees the region is tetromino-tileable (worst case: one O per block).
function blockMask(blockRows) {
  const br = blockRows.length, bc = Math.max(...blockRows.map(s => s.length));
  const mask = Array.from({ length: br * 2 }, () => Array.from({ length: bc * 2 }, () => '.'));
  for (let r = 0; r < br; r++)
    for (let c = 0; c < bc; c++)
      if (blockRows[r][c] === '#') { mask[2*r][2*c] = '#'; mask[2*r][2*c+1] = '#'; mask[2*r+1][2*c] = '#'; mask[2*r+1][2*c+1] = '#'; }
  return mask.map(row => row.join(''));
}
const SHAPES = {
  // plain rectangles (incl. non-square) — the backbone of the game
  r2x4: rectMask(2, 4), r3x4: rectMask(3, 4), r2x6: rectMask(2, 6), r2x8: rectMask(2, 8),
  r4x4: rectMask(4, 4), r4x5: rectMask(4, 5), r5x4: rectMask(5, 4), r4x6: rectMask(4, 6),
  r6x4: rectMask(6, 4), r3x8: rectMask(3, 8), r4x7: rectMask(4, 7), r4x8: rectMask(4, 8), r6x6: rectMask(6, 6),
  // picture shapes (used sparingly, 1-2x each) — all 2x2-block based so they
  // are always tetromino-tileable and their area is a multiple of 4
  L: blockMask(['#.', '#.', '##']),                     // 16
  Z: blockMask(['##.', '.##']),                         // 16
  S: blockMask(['.##', '.#.', '##.']),                  // 20
  T: blockMask(['###', '.#.', '.#.']),                  // 20
  plus: blockMask(['.#.', '###', '.#.']),               // 20
  heart: blockMask(['#.#', '###', '.#.']),              // 24
  arrowUp: blockMask(['.#.', '###', '.#.', '.#.']),     // 24
  arrowDown: blockMask(['.#.', '.#.', '###', '.#.']),   // 24
  arrowRight: blockMask(['#..', '##.', '###']),         // 24 (triangle/play)
  diamond: blockMask(['.#.', '###', '###', '.#.']),     // 32 (gem)
  ring: blockMask(['###', '#.#', '###']),               // 32 (hollow frame)
  letterH: blockMask(['#.#', '###', '#.#']),            // 28
  letterC: blockMask(['###', '#..', '###']),            // 28
  cup: blockMask(['#.#', '#.#', '###']),                // 28 (U)
};

// Build one tetromino-only level from a board mask. Tries a few tilings/
// groupings and keeps the one with the most uniquely-solvable zones.
function buildLevelFromMask(mask, zones, rng) {
  const rows = mask.length, cols = Math.max(...mask.map(s => s.length));
  const cellList = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (mask[r][c] === '#') cellList.push([r, c]);
  if (cellList.length % 4 !== 0) throw new Error(`mask area ${cellList.length} not divisible by 4`);
  zones = Math.min(zones, Math.floor(cellList.length / 4));

  let best = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const placements = tileRegionTetromino(cellList, rows, cols, rng);
    if (!placements || placements.length < zones) continue;
    const group = groupTetrominoes(placements, zones, rng, rows, cols);
    if (!group) continue;

    const zoneTets = Array.from({ length: zones }, () => []);
    placements.forEach((p, i) => zoneTets[group[i]].push(p));
    const grid = Array.from({ length: rows }, () => new Array(cols).fill(null));
    zoneTets.forEach((tets, g) => tets.forEach(p => p.cells.forEach(ci => { grid[Math.floor(ci / cols)][ci % cols] = LETTERS[g]; })));

    const clues = {};
    const pieces = [];
    let uniqueZones = 0, deducibleZones = 0;
    for (let g = 0; g < zones; g++) {
      const L = LETTERS[g];
      const cells = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (grid[r][c] === L) cells.push([r, c]);
      let clue = cells[0];
      cells.forEach(([r, c]) => { if (r < clue[0] || (r === clue[0] && c < clue[1])) clue = [r, c]; });
      clues[L] = clue;
      const shapes = zoneTets[g].map(p => p.shape);
      if (countTilings(cells, shapes) === 1) { uniqueZones++; if (forcedDeducible(cells, shapes)) deducibleZones++; }
      shapes.forEach(shape => pieces.push({ zone: L, shape, label: 'tetromino' }));
    }

    for (let i = pieces.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pieces[i], pieces[j]] = [pieces[j], pieces[i]]; }

    const moves = pieces.length * 2 + 2;
    const lvl = { cols, rows, moves, hearts: 3, grid, clues, pieces };
    lvl._unique = uniqueZones === zones;
    lvl._deducible = deducibleZones === zones;
    if (lvl._unique && lvl._deducible) return lvl;
    const score = uniqueZones * 100 + deducibleZones;
    if (!best || score > best._score) { lvl._score = score; best = lvl; }
  }
  return best;
}

// ---- verify a level is solvable & well-formed ----
function verify(lvl, name) {
  const { rows, cols, grid, clues } = lvl;
  // zone areas
  const areas = {};
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const z = grid[r][c];
      if (z) areas[z] = (areas[z] || 0) + 1;
    }
  // piece area per zone must equal zone area
  const pieceArea = {};
  lvl.pieces.forEach(p => {
    const a = p.shape.flat().reduce((x, y) => x + y, 0);
    pieceArea[p.zone] = (pieceArea[p.zone] || 0) + a;
  });
  for (const z of Object.keys(areas)) {
    if (pieceArea[z] !== areas[z])
      throw new Error(`${name}: zone ${z} area ${areas[z]} != piece area ${pieceArea[z] || 0}`);
    if (!clues[z]) throw new Error(`${name}: zone ${z} missing clue`);
    const [cr, cc] = clues[z];
    if (grid[cr][cc] !== z) throw new Error(`${name}: clue for ${z} not in zone`);
  }
  // actually attempt a solve via the real tryPlace logic to be 100% sure
  if (!simulateSolvable(lvl))
    throw new Error(`${name}: simulation could not solve the level`);
  return true;
}

// Mirror of the game's tryPlace + a backtracking solver.
function simulateSolvable(lvl) {
  const { rows, cols, grid } = lvl;
  const filled = new Array(rows * cols).fill(false);
  const zones = {};
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const z = grid[r][c];
      (zones[z] = zones[z] || []).push(r * cols + c);
    }
  const pieces = lvl.pieces.map(p => p.shape);

  function placements(shape, zone) {
    const shapeCells = [];
    shape.forEach((row, r) => row.forEach((on, c) => { if (on) shapeCells.push([r, c]); }));
    const res = [];
    const zoneCellIdx = zones[zone];
    for (const ci of zoneCellIdx) {
      const cr = Math.floor(ci / cols), cc = ci % cols;
      for (const [sr, sc] of shapeCells) {
        const pos = shapeCells.map(([r, c]) => [cr - sr + r, cc - sc + c]);
        const ok = pos.every(([r, c]) =>
          r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c] === zone);
        if (ok) res.push(pos.map(([r, c]) => r * cols + c).sort((a, b) => a - b));
      }
    }
    // dedupe
    const seen = new Set(), uniq = [];
    for (const p of res) { const k = p.join('|'); if (!seen.has(k)) { seen.add(k); uniq.push(p); } }
    return uniq;
  }

  const order = lvl.pieces.map((p, i) => i);
  function solve(used) {
    // all pieces placed (each within its zone, no overlaps) => zone cells all
    // covered. Void cells outside the shape are intentionally never filled.
    if (used.length === pieces.length) return true;
    // pick first unused piece
    let pi = -1;
    for (const i of order) if (!used.includes(i)) { pi = i; break; }
    const opts = placements(pieces[pi], lvl.pieces[pi].zone);
    for (const opt of opts) {
      if (opt.some(i => filled[i])) continue;
      opt.forEach(i => filled[i] = true);
      if (solve(used.concat(pi))) return true;
      opt.forEach(i => filled[i] = false);
    }
    return false;
  }
  return solve([]);
}

// ===================== generate =====================
function gen() {
  const LEVELS = [];
  const rng = mulberry32(20240628);

  // SLOW progression: start tiny, grow gently, mix in picture shapes (hearts,
  // arrows, gems). Small boards throughout so the player is never overwhelmed.
  // Each spec = { shape, zones }.
  // Mostly squares/rectangles, with picture shapes sprinkled in (each used at
  // most twice) so there's variety without spam. Slow size/zone ramp.
  const specs = [
    { shape: 'r2x4', zones: 2 }, { shape: 'r3x4', zones: 2 }, { shape: 'r2x6', zones: 2 }, { shape: 'r4x4', zones: 2 },
    { shape: 'L', zones: 2 }, { shape: 'r4x4', zones: 3 }, { shape: 'r3x4', zones: 3 }, { shape: 'Z', zones: 2 },
    { shape: 'r2x8', zones: 2 }, { shape: 'r4x4', zones: 3 }, { shape: 'r4x5', zones: 3 }, { shape: 'T', zones: 3 },
    { shape: 'r5x4', zones: 3 }, { shape: 'r4x6', zones: 3 }, { shape: 'plus', zones: 3 }, { shape: 'r6x4', zones: 3 },
    { shape: 'r4x5', zones: 3 }, { shape: 'S', zones: 3 }, { shape: 'r4x6', zones: 4 }, { shape: 'r4x4', zones: 3 },
    { shape: 'heart', zones: 3 }, { shape: 'r4x6', zones: 3 }, { shape: 'r3x8', zones: 3 }, { shape: 'arrowUp', zones: 3 },
    { shape: 'r4x6', zones: 4 }, { shape: 'r6x4', zones: 4 }, { shape: 'arrowRight', zones: 3 }, { shape: 'r4x7', zones: 4 },
    { shape: 'r4x8', zones: 4 }, { shape: 'diamond', zones: 4 }, { shape: 'r6x6', zones: 4 }, { shape: 'letterH', zones: 4 },
    { shape: 'r4x6', zones: 4 }, { shape: 'ring', zones: 4 }, { shape: 'r4x8', zones: 4 }, { shape: 'letterC', zones: 4 },
    { shape: 'r6x6', zones: 4 }, { shape: 'cup', zones: 4 }, { shape: 'r4x8', zones: 5 }, { shape: 'heart', zones: 4 },
    { shape: 'r6x6', zones: 5 }, { shape: 'T', zones: 4 }, { shape: 'r4x8', zones: 4 }, { shape: 'arrowDown', zones: 4 },
    { shape: 'r6x6', zones: 4 }, { shape: 'plus', zones: 4 }, { shape: 'r4x7', zones: 4 }, { shape: 'diamond', zones: 5 },
    { shape: 'r6x6', zones: 5 }, { shape: 'Z', zones: 3 }, { shape: 'r4x8', zones: 5 }, { shape: 'arrowRight', zones: 4 },
    { shape: 'r6x6', zones: 4 }, { shape: 'letterH', zones: 4 }, { shape: 'r4x8', zones: 5 }, { shape: 'ring', zones: 5 },
    { shape: 'r6x6', zones: 5 }, { shape: 'arrowUp', zones: 4 }, { shape: 'r4x8', zones: 5 }, { shape: 'letterC', zones: 4 },
  ];
  let lvlUniq = 0, lvlDed = 0;
  specs.forEach((s, i) => {
    const lvl = buildLevelFromMask(SHAPES[s.shape], s.zones, rng);
    if (!lvl) throw new Error(`LEVEL ${i + 1}: could not build shape ${s.shape}`);
    if (lvl._unique) lvlUniq++;
    if (lvl._deducible) lvlDed++;
    delete lvl._unique; delete lvl._deducible; delete lvl._score;
    verify(lvl, `LEVEL ${i + 1}`);
    LEVELS.push(lvl);
  });
  console.log(`Levels: ${LEVELS.length} total, ${lvlUniq} unique solution, ${lvlDed} forced-deducible`);

  // 30 daily puzzles — a fun mix of shapes
  const DAILY = [];
  const drng = mulberry32(99887766);
  const dailyPool = [
    { shape: 'heart', zones: 3 }, { shape: 'arrowUp', zones: 3 }, { shape: 'diamond', zones: 4 },
    { shape: 'ring', zones: 4 }, { shape: 'r6x6', zones: 4 }, { shape: 'r4x6', zones: 3 },
    { shape: 'letterH', zones: 4 }, { shape: 'cup', zones: 4 }, { shape: 'arrowRight', zones: 3 }, { shape: 'r4x8', zones: 4 },
  ];
  let dUniq = 0, dDed = 0;
  for (let i = 0; i < 30; i++) {
    const s = dailyPool[i % dailyPool.length];
    const lvl = buildLevelFromMask(SHAPES[s.shape], s.zones, drng);
    if (!lvl) throw new Error(`DAILY ${i + 1}: could not build shape ${s.shape}`);
    if (lvl._unique) dUniq++;
    if (lvl._deducible) dDed++;
    delete lvl._unique; delete lvl._deducible; delete lvl._score;
    verify(lvl, `DAILY ${i + 1}`);
    DAILY.push(lvl);
  }
  console.log(`Daily: ${dUniq}/30 unique solution, ${dDed}/30 forced-deducible`);

  return { LEVELS, DAILY };
}

const { LEVELS, DAILY } = gen();

// pretty-compact JSON for embedding
function fmt(arr) {
  return JSON.stringify(arr, null, 0);
}

const htmlPath = path.join(__dirname, '..', '..', '..', '..', '..', 'Users', 'athanwang', 'Desktop', 'Vibe Code Projects', 'quilt-drop', 'index.html');
// safer: resolve from arg
const target = process.argv[2];
if (!target) { console.error('pass index.html path as arg'); process.exit(1); }
let html = fs.readFileSync(target, 'utf8');
// Works for the original placeholder AND for re-injecting over already-generated
// data, since the arrays are emitted on a single line with no inner semicolons.
html = html.replace(/const LEVELS = [^\n]*;/, 'const LEVELS = /*generated*/' + fmt(LEVELS) + ';');
html = html.replace(/const DAILY_LEVELS = [^\n]*;/, 'const DAILY_LEVELS = /*generated*/' + fmt(DAILY) + ';');
fs.writeFileSync(target, html);

console.log(`Injected ${LEVELS.length} levels and ${DAILY.length} daily puzzles. All verified solvable.`);
console.log('Level piece counts:', LEVELS.map(l => l.pieces.length).join(','));
console.log('Level zone counts:', LEVELS.map(l => Object.keys(l.clues).length).join(','));
