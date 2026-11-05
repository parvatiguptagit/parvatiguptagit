// world.js — shared by the browser (index.html) and server.js, so players and computer bots see exactly the same building.
//
// Every theme has its own multi-floor structure (a "layout"). All layouts use the same three floor heights (0, 4, 8)
// and the same building blocks: slabs (rectangular or round platforms), ramps, animated lifts, solid blocks (walls, columns, crates),
// and railings. W.make('glass' | 'mushroom' | 'ruins' | 'manor' | 'graveyard') returns one layout with all the physics helpers.
(function (root) {
  'use strict';
  const W = { MAP: 30, T: 0.4, STEP: 0.6, BODY_H: 1.7, levelTop: [0, 4, 8] };
  W.levelOf = y => y < 2 ? 0 : y < 6 ? 1 : 2;
  const ease = s => s * s * (3 - 2 * s);
  const box = (x, z, hw, hd, y0, h, extra) => Object.assign({ x, z, hw, hd, y0, h }, extra);
  const slabRect = (name, x, z, hw, hd, top) => ({ name, x, z, hw, hd, top });
  const slabRound = (name, x, z, r, top) => ({ name, x, z, hw: r, hd: r, r, top });
  const ramp = (name, from, to, x0, z0, y0, x1, z1, y1, hw, app) => ({ name, from, to, x0, z0, y0, x1, z1, y1, hw, app: app || 3 });

  // pieces along the four edges of a rectangular slab, skipping the gaps. gaps = { N:[[a,b]], S:..., W:..., E:... }  (a,b along the edge)
  function edgeSegs(s, gaps, make) {
    gaps = gaps || {};
    const sides = {
      N: ['x', s.z - s.hd, s.x - s.hw, s.x + s.hw, 1], S: ['x', s.z + s.hd, s.x - s.hw, s.x + s.hw, -1],
      W: ['z', s.x - s.hw, s.z - s.hd, s.z + s.hd, 1], E: ['z', s.x + s.hw, s.z - s.hd, s.z + s.hd, -1]
    };
    const out = [];
    for (const k in sides) {
      const [axis, c, lo, hi, inward] = sides[k];
      let iv = [[lo, hi]];
      for (const [ga, gb] of (gaps[k] || [])) iv = iv.flatMap(([a, b]) => {
        if (gb <= a || ga >= b) return [[a, b]];
        const r = []; if (ga > a) r.push([a, ga]); if (gb < b) r.push([gb, b]); return r;
      });
      for (const [a, b] of iv) if (b - a > 0.2) out.push(make(axis, c, a, b, inward));
    }
    return out;
  }
  const rails = (s, gaps) => edgeSegs(s, gaps, (axis, c, a, b, inw) => axis === 'x'
    ? box((a + b) / 2, c + inw * 0.07, (b - a) / 2, 0.07, s.top, 1.1, { rail: true })
    : box(c + inw * 0.07, (a + b) / 2, 0.07, (b - a) / 2, s.top, 1.1, { rail: true }));
  const walls = (s, gaps, h, t, kind) => edgeSegs(s, gaps, (axis, c, a, b, inw) => axis === 'x'
    ? box((a + b) / 2, c + inw * t, (b - a) / 2, t, s.top, h, { kind: kind || 'wall' })
    : box(c + inw * t, (a + b) / 2, t, (b - a) / 2, s.top, h, { kind: kind || 'wall' }));
  const ALL = [[-100, 100]];
  const mirror = (b, extra) => Object.assign({}, b, { x: -b.x }, extra);

  // ======================= the five layouts =======================
  const defs = {};

  // 1) GLASS VILLA: a wide glass building with a smaller top floor
  (function () {
    const f2 = slabRect('f2', 0, -18.5, 26, 9.5, 4), f3 = slabRect('f3', 0, -21, 12, 7, 8), blocks = [];
    const bx = (x, z, hw, hd, y0, h, kind) => blocks.push(box(x, z, hw, hd, y0, h, { kind }));
    [-20, -10, 0, 10, 20].forEach(x => [-24, -14].forEach(z => bx(x, z, 0.5, 0.5, 0, 3.6, 'column')));
    [[-17, -19, 3, 0.3], [5, -21, 0.3, 3], [17, -17, 3, 0.3], [-5, -12, 2.5, 0.3]].forEach(([x, z, hw, hd]) => bx(x, z, hw, hd, 0, 3, 'wall'));
    [[-20, -13.5], [20, -13.5], [-20, -24], [20, -24]].forEach(([x, z]) => bx(x, z, 1.2, 1.2, 4, 1.6, 'crate'));
    [[-6, -12, 0.4, 2.5], [6, -12, 0.4, 2.5], [0, -10.5, 3, 0.4]].forEach(([x, z, hw, hd]) => bx(x, z, hw, hd, 4, 2.4, 'wall'));
    [[-11, -15], [11, -15], [-11, -27], [11, -27], [0, -27]].forEach(([x, z]) => bx(x, z, 0.5, 0.5, 4, 3.6, 'column'));
    [[-8, -16.5], [8, -16.5], [-8, -25], [8, -25]].forEach(([x, z]) => bx(x, z, 1, 1, 8, 1.6, 'crate'));
    bx(0, -21, 3, 0.35, 8, 2.2, 'wall'); bx(0, -26, 0.35, 2, 8, 2.2, 'wall');
    defs.glass = { id: 'glass', style: 'glass', slabs: [f2, f3], blocks,
      ramps: [ramp('A1', 'g', 'f2', -14, 6, 0, -14, -9, 4, 1.6), ramp('A2', 'g', 'f2', 14, 6, 0, 14, -9, 4, 1.6),
        ramp('B1', 'f2', 'f3', 24, -19.5, 4, 12, -19.5, 8, 1.6, 1.2), ramp('B2', 'f2', 'f3', -24, -19.5, 4, -12, -19.5, 8, 1.6, 1.2)],
      lifts: [{ name: 'L1', x: 27.7, z: -18, hw: 1.7, hd: 1.7, phase: 0 }, { name: 'L2', x: -27.7, z: -18, hw: 1.7, hd: 1.7, phase: 5 }],
      rails: rails(f2, { S: [[-15.6, -12.4], [12.4, 15.6]], W: [[-19.7, -16.3]], E: [[-19.7, -16.3]] })
        .concat(rails(f3, { W: [[-21.1, -17.9]], E: [[-21.1, -17.9]] })) };
  })();

  // 2) FAIRY FOREST: three giant round mushroom caps joined by mossy log bridges
  (function () {
    const capW = slabRound('capW', -17, -9, 7, 4), capE = slabRound('capE', 17, -9, 7, 4), capN = slabRound('capN', 0, -21.5, 7.5, 8), blocks = [];
    const bx = (x, z, hw, hd, y0, h, kind) => blocks.push(box(x, z, hw, hd, y0, h, { kind }));
    bx(-17, -9, 1.4, 1.4, 0, 3.6, 'stem'); bx(17, -9, 1.4, 1.4, 0, 3.6, 'stem'); bx(0, -21.5, 1.7, 1.7, 0, 7.6, 'stem');
    [[-20, -11], [-14, -5], [-15, -12.5]].forEach(([x, z]) => { bx(x, z, 0.9, 0.9, 4, 1.4, 'crate'); bx(-x, z, 0.9, 0.9, 4, 1.4, 'crate'); });
    [[-3.5, -21.5], [3.5, -24], [0, -18.5], [-2.5, -25]].forEach(([x, z]) => bx(x, z, 0.9, 0.9, 8, 1.4, 'crate'));
    bx(-8, -3, 1.2, 1.2, 0, 2.6, 'stone'); bx(8, -3, 1.2, 1.2, 0, 2.6, 'stone'); bx(0, -9, 1.5, 1.5, 0, 2.2, 'stone');
    defs.mushroom = { id: 'mushroom', style: 'mushroom', slabs: [capW, capE, capN], blocks, pond: { x: -9, z: 15, r: 5 },
      ramps: [ramp('A1', 'g', 'capW', -17, 9, 0, -17, -3, 4, 1.6), ramp('A2', 'g', 'capE', 17, 9, 0, 17, -3, 4, 1.6),
        ramp('B1', 'capW', 'capN', -14, -15, 4, -2.2, -15, 8, 1.6), ramp('B2', 'capE', 'capN', 14, -15, 4, 2.2, -15, 8, 1.6)],
      lifts: [{ name: 'L1', x: -25.4, z: -9, hw: 1.7, hd: 1.7, phase: 0 }, { name: 'L2', x: 25.4, z: -9, hw: 1.7, hd: 1.7, phase: 5 }],
      rails: [] };
  })();

  // 3) SUNKEN CITY: two ruined terraces joined by a high stone bridge
  (function () {
    const tw = slabRect('tw', -15, -19, 10, 7, 4), te = slabRect('te', 15, -19, 10, 7, 4), br = slabRect('br', 0, -19, 8, 2.2, 8), blocks = [];
    const bx = (x, z, hw, hd, y0, h, kind) => blocks.push(box(x, z, hw, hd, y0, h, { kind }));
    [[-23, -14], [-23, -24], [-9, -14], [-9, -24]].forEach(([x, z]) => { bx(x, z, 0.5, 0.5, 4, 3.6, 'column'); bx(-x, z, 0.5, 0.5, 4, 3.6, 'column'); });
    [[-15, -25.4, 3, 0.3], [-11, -13, 2, 0.3]].forEach(([x, z, hw, hd]) => { bx(x, z, hw, hd, 4, 2.6, 'wall'); bx(-x, z, hw, hd, 4, 2.6, 'wall'); });
    [[-20, -22], [-18, -14.5], [-16, -23]].forEach(([x, z]) => { bx(x, z, 0.9, 0.9, 4, 1.3, 'crate'); bx(-x, z, 0.9, 0.9, 4, 1.3, 'crate'); });
    bx(-3, -20.2, 0.8, 0.8, 8, 1.3, 'crate'); bx(3, -17.8, 0.8, 0.8, 8, 1.3, 'crate');
    [[-20, -15], [-10, -15], [-20, -23], [-10, -23]].forEach(([x, z]) => { bx(x, z, 0.6, 0.6, 0, 3.6, 'column'); bx(-x, z, 0.6, 0.6, 0, 3.6, 'column'); });
    bx(-15, -19, 3, 0.3, 0, 3, 'wall'); bx(15, -19, 3, 0.3, 0, 3, 'wall');
    bx(-4, -19, 0.6, 0.6, 0, 7.6, 'column'); bx(4, -19, 0.6, 0.6, 0, 7.6, 'column');
    defs.ruins = { id: 'ruins', style: 'ruins', slabs: [tw, te, br], blocks,
      ramps: [ramp('A1', 'g', 'tw', -17, 7, 0, -17, -11.6, 4, 1.6), ramp('A2', 'g', 'te', 17, 7, 0, 17, -11.6, 4, 1.6),
        ramp('B1', 'tw', 'br', -20, -19, 4, -7.9, -19, 8, 1.6), ramp('B2', 'te', 'br', 20, -19, 4, 7.9, -19, 8, 1.6)],
      lifts: [{ name: 'L1', x: -26.2, z: -19, hw: 1.7, hd: 1.7, phase: 0 }, { name: 'L2', x: 26.2, z: -19, hw: 1.7, hd: 1.7, phase: 5 }],
      rails: rails(tw, { S: [[-18.6, -15.4], [-12, -9]], W: [[-20.7, -17.3]], E: ALL })
        .concat(rails(te, { S: [[15.4, 18.6], [9, 12]], E: [[-20.7, -17.3]], W: ALL }))
        .concat(rails(br, { E: ALL, W: ALL })) };
  })();

  // 4) HAUNTED MANOR: a walled two-storey house with doorways, a narrow stair to the attic, and a roof
  (function () {
    const f2 = slabRect('f2', 0, -18, 14, 8, 4), f3 = slabRect('f3', 3, -19, 7, 5, 8), blocks = [];
    const bx = (x, z, hw, hd, y0, h, kind) => blocks.push(box(x, z, hw, hd, y0, h, { kind }));
    walls(f2, { S: [[-9.6, -6.4], [6.4, 9.6]], W: [[-19.7, -16.3]], E: [[-19.7, -16.3]] }, 7, 0.4).forEach(b => blocks.push(b));   // outer walls
    walls(f3, { W: [[-20.6, -17.4]] }, 3, 0.3).forEach(b => blocks.push(b));                                                          // attic walls
    bx(-8, -24, 0.3, 2.5, 4, 3.8, 'wall'); bx(8.5, -12.3, 3.5, 0.3, 4, 3.8, 'wall'); bx(-9, -13, 0.3, 2.6, 4, 3.8, 'wall');
    [[-11, -23.5], [12, -24], [12, -13], [-3, -12.5], [-12, -13.5]].forEach(([x, z]) => bx(x, z, 0.9, 0.9, 4, 1.3, 'crate'));
    [[6, -22], [8.5, -16], [0, -23]].forEach(([x, z]) => bx(x, z, 0.8, 0.8, 8, 1.3, 'crate'));
    [[-10, -14], [0, -14], [10, -14], [-10, -22], [0, -22], [10, -22]].forEach(([x, z]) => bx(x, z, 0.5, 0.5, 0, 3.6, 'column'));
    bx(-4, 7, 1, 1, 0, 1.6, 'stone'); bx(4, 7, 1, 1, 0, 1.6, 'stone');   // gravestones by the door
    defs.manor = { id: 'manor', style: 'manor', slabs: [f2, f3], blocks,
      ramps: [ramp('A1', 'g', 'f2', -8, 5.8, 0, -8, -10.2, 4, 1.6), ramp('A2', 'g', 'f2', 8, 5.8, 0, 8, -10.2, 4, 1.6),
        ramp('B1', 'f2', 'f3', -11.2, -19, 4, -3.9, -19, 8, 1.6, 1.4)],
      lifts: [{ name: 'L1', x: -15.4, z: -18, hw: 1.7, hd: 1.7, phase: 0 }, { name: 'L2', x: 15.4, z: -18, hw: 1.7, hd: 1.7, phase: 5 }],
      rails: [] };
  })();

  // 5) GARGOYLE GATE: a gated graveyard courtyard in front of a mansion porch and tower
  (function () {
    const f2 = slabRect('f2', 0, -21, 21, 6, 4), f3 = slabRect('f3', 0, -23.5, 5, 3.5, 8), blocks = [];
    const bx = (x, z, hw, hd, y0, h, kind, extra) => blocks.push(box(x, z, hw, hd, y0, h, Object.assign({ kind }, extra)));
    bx(-6.8, -3.5, 0.9, 0.9, 0, 4.4, 'pillar'); bx(6.8, -3.5, 0.9, 0.9, 0, 4.4, 'pillar');                                                 // the gate
    bx(-11.05, -3.5, 3.45, 0.12, 0, 2.4, 'fence', { seeThrough: true }); bx(11.05, -3.5, 3.45, 0.12, 0, 2.4, 'fence', { seeThrough: true });
    [[-20, -8.5], [-17, -8.5], [-8.3, -8.5], [8.3, -8.5], [17, -8.5], [20, -8.5], [-19, -12], [-16.5, -12], [-8.5, -12], [8.5, -12], [16.5, -12], [19, -12]]
      .forEach(([x, z]) => bx(x, z, 0.6, 0.22, 0, 1.5, 'tomb'));
    bx(-19.5, -10, 2.2, 1.8, 0, 3, 'crypt'); bx(19.5, -10, 2.2, 1.8, 0, 3, 'crypt');
    walls(f2, { S: ALL, W: ALL, E: ALL }, 5, 0.4).forEach(b => blocks.push(b));                                                              // the mansion front wall behind the porch
    [-18, -9, 9, 18].forEach(x => bx(x, -15.8, 0.5, 0.5, 4, 3.6, 'column'));
    [[-16, -24], [16, -24], [-4, -18], [4, -18], [-19, -18], [19, -18]].forEach(([x, z]) => bx(x, z, 0.9, 0.9, 4, 1.3, 'crate'));
    bx(-9, -19.5, 0.3, 0.9, 4, 2.6, 'wall'); bx(9, -19.5, 0.3, 0.9, 4, 2.6, 'wall');
    bx(0, -26, 0.8, 0.8, 8, 1.3, 'crate'); bx(3.4, -21, 0.7, 0.7, 8, 1.3, 'crate'); bx(-3.4, -21, 0.7, 0.7, 8, 1.3, 'crate');
    [[-12, -21], [12, -21], [0, -21]].forEach(([x, z]) => bx(x, z, 0.5, 0.5, 0, 3.6, 'column'));
    defs.graveyard = { id: 'graveyard', style: 'graveyard', slabs: [f2, f3], blocks, zones: [[-8, 8, -15, -3]],
      ramps: [ramp('A1', 'g', 'f2', -12, -6.5, 0, -12, -14.8, 4, 1.6, 2), ramp('A2', 'g', 'f2', 12, -6.5, 0, 12, -14.8, 4, 1.6, 2),
        ramp('B1', 'f2', 'f3', -14, -23.5, 4, -4.7, -23.5, 8, 1.6), ramp('B2', 'f2', 'f3', 14, -23.5, 4, 4.7, -23.5, 8, 1.6)],
      lifts: [{ name: 'L1', x: -22.2, z: -21, hw: 1.7, hd: 1.7, phase: 0 }, { name: 'L2', x: 22.2, z: -21, hw: 1.7, hd: 1.7, phase: 5 }],
      rails: rails(f2, { N: ALL, S: [[-13.6, -10.4], [10.4, 13.6]], W: [[-22.7, -19.3]], E: [[-22.7, -19.3]] })
        .concat(rails(f3, { W: [[-25.1, -21.9]], E: [[-25.1, -21.9]] })) };
  })();

  // 6) REAL FOREST: tree-house decks built round three giant trunks, joined by rope-bridge ramps, with boulders on the forest floor
  (function () {
    const capW = slabRound('deckW', -17, -9, 7, 4), capE = slabRound('deckE', 17, -9, 7, 4), capN = slabRound('deckN', 0, -21.5, 7.5, 8), blocks = [];
    const bx = (x, z, hw, hd, y0, h, kind) => blocks.push(box(x, z, hw, hd, y0, h, { kind }));
    bx(-17, -9, 1.4, 1.4, 0, 3.6, 'trunk'); bx(17, -9, 1.4, 1.4, 0, 3.6, 'trunk'); bx(0, -21.5, 1.7, 1.7, 0, 7.6, 'trunk');
    bx(-17, -9, 1.0, 1.0, 4, 4, 'trunk'); bx(17, -9, 1.0, 1.0, 4, 4, 'trunk'); bx(0, -21.5, 1.2, 1.2, 8, 4, 'trunk');   // the trunks carry on through the decks
    [[-20, -11], [-14, -5], [-15, -12.5]].forEach(([x, z]) => { bx(x, z, 0.9, 0.9, 4, 1.2, 'crate'); bx(-x, z, 0.9, 0.9, 4, 1.2, 'crate'); });
    [[-3.5, -21.5], [3.5, -24], [-2.5, -25]].forEach(([x, z]) => bx(x, z, 0.9, 0.9, 8, 1.2, 'crate'));
    bx(-8, -3, 1.3, 1.3, 0, 2.2, 'stone'); bx(8, -3, 1.3, 1.3, 0, 2.2, 'stone'); bx(0, -9, 1.6, 1.4, 0, 2.0, 'stone');
    defs.forest = { id: 'forest', style: 'forest', slabs: [capW, capE, capN], blocks, pond: { x: -9, z: 15, r: 5 },
      ramps: [ramp('A1', 'g', 'deckW', -17, 9, 0, -17, -3, 4, 1.6), ramp('A2', 'g', 'deckE', 17, 9, 0, 17, -3, 4, 1.6),
        ramp('B1', 'deckW', 'deckN', -14, -15, 4, -2.2, -15, 8, 1.6), ramp('B2', 'deckE', 'deckN', 14, -15, 4, 2.2, -15, 8, 1.6)],
      lifts: [{ name: 'L1', x: -25.4, z: -9, hw: 1.7, hd: 1.7, phase: 0 }, { name: 'L2', x: 25.4, z: -9, hw: 1.7, hd: 1.7, phase: 5 }],
      rails: [] };
  })();

  // 7) REAL HOUSE: a family home – garage and workshop downstairs, living room / kitchen / bedroom, then the loft
  (function () {
    const f2 = slabRect('f2', 0, -18, 14, 8, 4), f3 = slabRect('f3', 3, -19, 7, 5, 8), blocks = [];
    const bx = (x, z, hw, hd, y0, h, kind) => blocks.push(box(x, z, hw, hd, y0, h, { kind }));
    walls(f2, { S: [[-9.6, -6.4], [6.4, 9.6]], W: [[-19.7, -16.3]], E: [[-19.7, -16.3]] }, 7, 0.4).forEach(b => blocks.push(b));    // first-floor outer walls (up to the eaves)
    walls({ x: 0, z: -18, hw: 14, hd: 8, top: 0 }, { S: [[-3, 3]], W: [[-19.7, -16.3]], E: [[-19.7, -16.3]] }, 3.8, 0.35).forEach(b => blocks.push(b));   // ground-floor walls: the garage door faces the drive
    walls(f3, { W: [[-20.6, -17.4]] }, 3, 0.3).forEach(b => blocks.push(b));                                                          // loft walls
    bx(-8, -24, 0.2, 2.5, 4, 3.2, 'wall'); bx(8.5, -12.3, 3.5, 0.2, 4, 3.2, 'wall'); bx(-9, -13, 0.2, 2.6, 4, 3.2, 'wall');           // bedroom, bathroom partitions
    // downstairs: a garage with a car, a workshop and storage between the pillars
    [[-10, -14], [10, -14], [-10, -22], [10, -22]].forEach(([x, z]) => bx(x, z, 0.45, 0.45, 0, 3.6, 'column'));
    bx(-4.5, -18, 1.05, 2.3, 0, 1.45, 'car'); bx(0.5, -23.8, 2.2, 0.45, 0, 1.0, 'bench'); bx(7, -24.4, 1.0, 0.4, 0, 2.0, 'shelf'); bx(-12.6, -24.2, 0.7, 0.7, 0, 1.0, 'box'); bx(12.4, -12.6, 0.9, 0.9, 0, 0.9, 'box');
    // first floor
    bx(-11.6, -23.9, 1.0, 1.15, 4, 0.7, 'bed'); bx(-13.5, -21.8, 0.4, 0.45, 4, 1.9, 'wardrobe');
    bx(9, -24.5, 1.2, 0.55, 4, 0.8, 'sofa'); bx(9, -22.4, 0.8, 0.45, 4, 0.45, 'table'); bx(3.5, -14.3, 1.2, 0.7, 4, 0.8, 'dining'); bx(-1.5, -24.8, 2.0, 0.4, 4, 1.0, 'counter');
    bx(5.5, -24.8, 0.45, 0.4, 4, 1.9, 'fridge'); bx(12.9, -13.5, 0.35, 1.0, 4, 1.9, 'shelf'); bx(-3, -12.2, 0.5, 0.5, 4, 1.4, 'plant'); bx(-12.8, -11.3, 0.45, 0.8, 4, 0.8, 'tub');
    // loft
    bx(8.2, -22.2, 1.0, 1.15, 8, 0.7, 'bed'); bx(-2.2, -22.6, 0.4, 0.9, 8, 1.9, 'wardrobe'); bx(8.6, -15.2, 0.9, 0.4, 8, 0.8, 'desk'); bx(3, -22.8, 1.1, 0.5, 8, 0.8, 'sofa'); bx(-2.4, -15.2, 0.5, 0.5, 8, 0.9, 'box'); bx(3, -15.3, 0.5, 0.45, 8, 1.4, 'plant');
    // the garden
    bx(-4, 7, 1.0, 0.4, 0, 0.9, 'bench'); bx(4, 7, 0.9, 0.9, 0, 0.9, 'planter');
    defs.house = { id: 'house', style: 'house', slabs: [f2, f3], blocks,
      ramps: [ramp('A1', 'g', 'f2', -8, 5.8, 0, -8, -10.2, 4, 1.6), ramp('A2', 'g', 'f2', 8, 5.8, 0, 8, -10.2, 4, 1.6),
        ramp('B1', 'f2', 'f3', -11.2, -19, 4, -3.9, -19, 8, 1.6, 1.4)],
      lifts: [{ name: 'L1', x: -15.4, z: -18, hw: 1.7, hd: 1.7, phase: 0 }, { name: 'L2', x: 15.4, z: -18, hw: 1.7, hd: 1.7, phase: 5 }],
      rails: [] };
  })();

  // 8) REAL COMPANY: an office tower – reception lobby, an open-plan office floor, and the executive boardroom upstairs
  (function () {
    const f2 = slabRect('f2', 0, -18.5, 26, 9.5, 4), f3 = slabRect('f3', 0, -21, 12, 7, 8), blocks = [];
    const bx = (x, z, hw, hd, y0, h, kind) => blocks.push(box(x, z, hw, hd, y0, h, { kind }));
    [-20, -10, 0, 10, 20].forEach(x => [-24, -14].forEach(z => bx(x, z, 0.5, 0.5, 0, 3.6, 'column')));
    [[-17, -19, 3, 0.15], [17, -17, 3, 0.15]].forEach(([x, z, hw, hd]) => bx(x, z, hw, hd, 0, 3, 'wall'));
    bx(5, -21, 0.15, 3, 0, 3, 'wall');
    // lobby: reception desk, waiting sofas, vending machines, plants
    bx(0, -19, 2.6, 0.7, 0, 1.1, 'reception'); bx(-15, -22.5, 1.3, 0.55, 0, 0.8, 'sofa'); bx(15, -22.5, 1.3, 0.55, 0, 0.8, 'sofa'); bx(-24.5, -12, 0.5, 0.45, 0, 1.9, 'vending'); bx(24.5, -12, 0.5, 0.45, 0, 1.9, 'vending');
    bx(-5, -11.5, 0.5, 0.5, 0, 1.5, 'plant'); bx(5, -11.5, 0.5, 0.5, 0, 1.5, 'plant'); bx(-24.5, -26, 0.9, 0.5, 0, 1.2, 'copier'); bx(11, -26.6, 1.8, 0.5, 0, 1.0, 'counter');
    // open-plan office floor
    [[-22, -12.5], [-22, -25.5], [22, -12.5], [22, -25.5], [-14, -25.5], [14, -25.5], [-8, -11.6], [8, -11.6], [-2, -25.5], [2, -12.5]].forEach(([x, z]) => bx(x, z, 1.6, 0.9, 4, 1.15, 'pod'));
    [[-6, -12, 0.15, 2.5], [6, -12, 0.15, 2.5], [0, -10.4, 3, 0.15]].forEach(([x, z, hw, hd]) => blocks.push(box(x, z, hw, hd, 4, 2.4, { kind: 'glass', seeThrough: true })));   // glass meeting room
    [[-11, -15], [11, -15], [-11, -27], [11, -27], [0, -27]].forEach(([x, z]) => bx(x, z, 0.5, 0.5, 4, 3.6, 'column'));
    bx(-25.2, -14.5, 0.5, 0.6, 4, 1.8, 'cabinet'); bx(25.2, -14.5, 0.5, 0.6, 4, 1.8, 'cabinet'); bx(-17, -27.3, 1.6, 0.35, 4, 1.8, 'cabinet'); bx(17, -27.3, 1.6, 0.35, 4, 1.8, 'cabinet'); bx(-24.5, -27, 0.5, 0.5, 4, 1.5, 'plant'); bx(24.5, -27, 0.5, 0.5, 4, 1.5, 'plant');
    // executive floor
    bx(0, -21, 2.8, 1.1, 8, 0.8, 'boardtable'); bx(-9, -16.8, 1.2, 0.55, 8, 0.8, 'sofa'); bx(9, -16.8, 1.2, 0.55, 8, 0.8, 'sofa'); bx(8, -26.6, 1.2, 0.6, 8, 0.8, 'desk'); bx(-8, -26.8, 1.5, 0.35, 8, 1.9, 'cabinet'); bx(-9.2, -23, 0.5, 0.5, 8, 1.5, 'plant');
    defs.office = { id: 'office', style: 'office', slabs: [f2, f3], blocks,
      ramps: [ramp('A1', 'g', 'f2', -14, 6, 0, -14, -9, 4, 1.6), ramp('A2', 'g', 'f2', 14, 6, 0, 14, -9, 4, 1.6),
        ramp('B1', 'f2', 'f3', 22, -19.5, 4, 12, -19.5, 8, 1.6, 1.2), ramp('B2', 'f2', 'f3', -22, -19.5, 4, -12, -19.5, 8, 1.6, 1.2)],
      lifts: [{ name: 'L1', x: 27.7, z: -18, hw: 1.7, hd: 1.7, phase: 0 }, { name: 'L2', x: -27.7, z: -18, hw: 1.7, hd: 1.7, phase: 5 }],
      rails: rails(f2, { S: [[-15.6, -12.4], [12.4, 15.6]], W: [[-19.7, -16.3]], E: [[-19.7, -16.3]] })
        .concat(rails(f3, { W: [[-21.1, -17.9]], E: [[-21.1, -17.9]] })) };
  })();

  W.layoutIds = Object.keys(defs);

  // ======================= building a layout =======================
  W.make = function (id) {
    const def = defs[id] || defs.glass;
    const L = {
      id: def.id, style: def.style, slabs: def.slabs, ramps: def.ramps, lifts: def.lifts, blocks: def.blocks, rails: def.rails, pond: def.pond || null,
      MAP: W.MAP, T: W.T, STEP: W.STEP, BODY_H: W.BODY_H, levelTop: W.levelTop, levelOf: W.levelOf
    };

    // ---- animated lifts: wait 3 s at each floor, 2 s of travel ----
    L.liftY = (l, t) => {
      const c = (((t + l.phase) % 10) + 10) % 10;
      return c < 3 ? 0 : c < 5 ? 4 * ease((c - 3) / 2) : c < 8 ? 4 : 4 * (1 - ease((c - 8) / 2));
    };
    const rampY = (r, x, z) => {
      const dx = r.x1 - r.x0, dz = r.z1 - r.z0, len2 = dx * dx + dz * dz, u = ((x - r.x0) * dx + (z - r.z0) * dz) / len2;
      if (u < 0 || u > 1) return null;
      if (Math.abs((x - r.x0) * dz - (z - r.z0) * dx) / Math.sqrt(len2) > r.hw) return null;
      return r.y0 + u * (r.y1 - r.y0);
    };
    const onSlab = (s, x, z) => s.r ? Math.hypot(x - s.x, z - s.z) <= s.r : (Math.abs(x - s.x) <= s.hw && Math.abs(z - s.z) <= s.hd);
    L.onSlab = onSlab;
    // height of the floor under (x,z) for someone whose feet are at `feet`
    L.surfaceY = (x, z, feet, t) => {
      const lim = feet + W.STEP;
      let best = 0;
      for (const s of L.slabs) if (s.top <= lim && s.top > best && onSlab(s, x, z)) best = s.top;
      for (const r of L.ramps) { const y = rampY(r, x, z); if (y !== null && y <= lim && y > best) best = y; }
      for (const l of L.lifts) if (Math.abs(x - l.x) <= l.hw && Math.abs(z - l.z) <= l.hd) { const y = L.liftY(l, t); if (y <= lim && y > best) best = y; }
      return best;
    };
    L.stepY = (st, x, z, dt, t) => {   // st = { y, vy }: stand on / follow the floor, or fall when it drops away
      const sy = L.surfaceY(x, z, st.y, t);
      if (sy >= st.y - 0.35 && st.vy <= 0) { st.y = sy; st.vy = 0; }
      else { st.vy = Math.max(st.vy - 22 * dt, -30); st.y += st.vy * dt; if (st.y <= sy) { st.y = sy; st.vy = 0; } }
    };

    // ---- railings along the ramps, glass sides of the lift shafts, and ramp footprints (bots walk around ramps they are not using) ----
    L.rampRails = [];
    L.ramps.forEach(r => {
      const n = 6, dx = r.x1 - r.x0, dz = r.z1 - r.z0, len = Math.hypot(dx, dz), nx = -dz / len, nz = dx / len, off = r.hw + 0.08;
      for (const side of [-1, 1]) for (let i = 0; i < n - 1; i++) {   // the last piece is left out so the top of every ramp is open
        const u0 = i / n, u1 = (i + 1) / n;
        const ax = r.x0 + dx * u0 + nx * side * off, az = r.z0 + dz * u0 + nz * side * off, bx = r.x0 + dx * u1 + nx * side * off, bz = r.z0 + dz * u1 + nz * side * off;
        L.rampRails.push(box((ax + bx) / 2, (az + bz) / 2, Math.max(Math.abs(bx - ax) / 2, 0.08), Math.max(Math.abs(bz - az) / 2, 0.08),
          r.y0 + (r.y1 - r.y0) * u0, Math.abs(r.y1 - r.y0) / n + 1.1, { rail: true }));
      }
    });
    L.shafts = [];
    L.lifts.forEach(l => [-1, 1].forEach(s => L.shafts.push(box(l.x, l.z + s * (l.hd + 0.08), l.hw, 0.08, 0, 5.2, { shaft: true }))));
    L.rampBlocks = L.ramps.map(r => {
      const x0 = Math.min(r.x0, r.x1) - r.hw - 0.3, x1 = Math.max(r.x0, r.x1) + r.hw + 0.3, z0 = Math.min(r.z0, r.z1) - r.hw - 0.3, z1 = Math.max(r.z0, r.z1) + r.hw + 0.3;
      const alongX = Math.abs(r.x1 - r.x0) > Math.abs(r.z1 - r.z0);
      const bx0 = alongX ? Math.min(r.x0, r.x1) - 0.3 : x0, bx1 = alongX ? Math.max(r.x0, r.x1) + 0.3 : x1, bz0 = alongX ? z0 : Math.min(r.z0, r.z1) - 0.3, bz1 = alongX ? z1 : Math.max(r.z0, r.z1) + 0.3;
      return box((bx0 + bx1) / 2, (bz0 + bz1) / 2, (bx1 - bx0) / 2, (bz1 - bz0) / 2, Math.min(r.y0, r.y1), Math.abs(r.y1 - r.y0) - 0.1, { rampBlock: true });
    });
    L.colliders = () => [].concat(L.blocks, L.rails, L.rampRails, L.shafts);   // things that stop walking
    L.blockers = () => [].concat(L.blocks.filter(b => !b.seeThrough),
      L.slabs.map(s => box(s.x, s.z, s.hw, s.hd, s.top - W.T, W.T, { slab: true })));   // things that block sight

    // ---- where random ground clutter may NOT be placed (derived from the structure itself) ----
    const segDist = (px, pz, ax, az, bx, bz) => {
      const dx = bx - ax, dz = bz - az, u = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
      return Math.hypot(px - (ax + u * dx), pz - (az + u * dz));
    };
    const zones = def.zones || [];
    L.inZone = (x, z) => {
      for (const s of L.slabs) if (s.r ? Math.hypot(x - s.x, z - s.z) < s.r + 2.5 : (Math.abs(x - s.x) < s.hw + 2.5 && Math.abs(z - s.z) < s.hd + 2.5)) return true;
      for (const r of L.ramps) if (segDist(x, z, r.x0, r.z0, r.x1, r.z1) < r.hw + 3) return true;
      for (const l of L.lifts) if (Math.abs(x - l.x) < l.hw + 3 && Math.abs(z - l.z) < l.hd + 3) return true;
      for (const b of L.blocks) if (b.y0 === 0 && Math.abs(x - b.x) < b.hw + 2 && Math.abs(z - b.z) < b.hd + 2) return true;
      for (const q of zones) if (x > q[0] && x < q[1] && z > q[2] && z < q[3]) return true;
      if (L.pond && Math.hypot(x - L.pond.x, z - L.pond.z) < L.pond.r + 2) return true;
      return false;
    };

    // ---- navigation: the floors form a graph joined by ramps ----
    L.nodeAt = (x, z, y) => {   // which platform is (x,z,y) standing on? null while on a ramp or in the air
      for (const s of L.slabs) if (Math.abs(y - s.top) < 0.45 && onSlab(s, x, z)) return s.name;
      return y < 0.45 ? 'g' : null;
    };
    const edges = [];
    L.ramps.forEach(r => {
      const dx = r.x1 - r.x0, dz = r.z1 - r.z0, len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len, a = r.app;
      // the first point of each edge is reached by walking around obstacles (walk:true); the rest follow the ramp itself in a straight line
      edges.push({ a: r.from, b: r.to, pts: [{ x: r.x0 - ux * a, z: r.z0 - uz * a, walk: true }, { x: r.x0, z: r.z0 }, { x: r.x1 + ux * 1.8, z: r.z1 + uz * 1.8 }] });
      edges.push({ a: r.to, b: r.from, pts: [{ x: r.x1 + ux * 1.8, z: r.z1 + uz * 1.8, walk: true }, { x: r.x1, z: r.z1 }, { x: r.x0 - ux * a, z: r.z0 - uz * a }] });
    });
    L.navPath = (from, to) => {   // waypoints (ramp entrances and exits) from one platform to another, or null when unreachable
      if (from === to) return [];
      const seen = { [from]: true }, q = [{ n: from, pts: [] }];
      while (q.length) {
        const c = q.shift();
        for (const e of edges) if (e.a === c.n && !seen[e.b]) {
          const pts = c.pts.concat(e.pts);
          if (e.b === to) return pts;
          seen[e.b] = true; q.push({ n: e.b, pts });
        }
      }
      return null;
    };
    return L;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = W; else root.HS_WORLD = W;
})(typeof window !== 'undefined' ? window : this);
