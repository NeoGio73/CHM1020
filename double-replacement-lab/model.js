/*
 * Double Replacement Reactions: the page's model.
 * The solutions on the sheet, the messages for each verdict on Table 1, the check of the "which
 * ions" questions against the student's own table, and the check of the balanced equations.
 *
 * What each box of the sheet shows is not here: that is worked out inside the 3D lab, which tells
 * the page only a verdict for each entry. The equations are checked from the ions' charges, by
 * the same steps a student uses, so no list of answers is kept here either.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DoubleLabModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- Ions and solutions ----------------------------------------------------------------------
  // f: how the ion is written inside a formula; q: the size of its charge; group: true for an ion
  // of several atoms, which takes brackets when there is more than one of it.

  var IONS = {
    Ag: { f: 'Ag', q: 1, name: 'Ag⁺' },
    Pb: { f: 'Pb', q: 2, name: 'Pb²⁺' },
    Ca: { f: 'Ca', q: 2, name: 'Ca²⁺' },
    Cu: { f: 'Cu', q: 2, name: 'Cu²⁺' },
    Fe: { f: 'Fe', q: 3, name: 'Fe³⁺' },
    K: { f: 'K', q: 1, name: 'K⁺' },
    Na: { f: 'Na', q: 1, name: 'Na⁺' },
    NO3: { f: 'NO3', q: 1, name: 'NO₃⁻', group: true },
    Cl: { f: 'Cl', q: 1, name: 'Cl⁻' },
    SO4: { f: 'SO4', q: 2, name: 'SO₄²⁻', group: true },
    I: { f: 'I', q: 1, name: 'I⁻' },
    OH: { f: 'OH', q: 1, name: 'OH⁻', group: true },
    PO4: { f: 'PO4', q: 3, name: 'PO₄³⁻', group: true },
    CO3: { f: 'CO3', q: 2, name: 'CO₃²⁻', group: true }
  };

  // The ids are the ones the 3D lab uses. The order is the order of the pipets in the rack.
  var SOLUTIONS = [
    { id: 'AgNO3', formula: 'AgNO3', conc: '0.1 M', cation: 'Ag', anion: 'NO3' },
    { id: 'PbNO32', formula: 'Pb(NO3)2', conc: '1.0 M', cation: 'Pb', anion: 'NO3' },
    { id: 'CaCl2', formula: 'CaCl2', conc: '0.5 M', cation: 'Ca', anion: 'Cl' },
    { id: 'CuSO4', formula: 'CuSO4', conc: '1.0 M', cation: 'Cu', anion: 'SO4' },
    { id: 'FeCl3', formula: 'FeCl3', conc: '0.5 M', cation: 'Fe', anion: 'Cl' },
    { id: 'KI', formula: 'KI', conc: '0.1 M', cation: 'K', anion: 'I' },
    { id: 'NaCl', formula: 'NaCl', conc: '1.0 M', cation: 'Na', anion: 'Cl' },
    { id: 'NaOH', formula: 'NaOH', conc: '1.0 M', cation: 'Na', anion: 'OH' },
    { id: 'Na2SO4', formula: 'Na2SO4', conc: '0.1 M', cation: 'Na', anion: 'SO4' },
    { id: 'Na3PO4', formula: 'Na3PO4', conc: '0.25 M', cation: 'Na', anion: 'PO4' },
    { id: 'Na2CO3', formula: 'Na2CO3', conc: '0.5 M', cation: 'Na', anion: 'CO3' }
  ];
  var BY_ID = {};
  SOLUTIONS.forEach(function (s) { BY_ID[s.id] = s; });

  var ROWS = ['AgNO3', 'PbNO32', 'CaCl2', 'CuSO4', 'FeCl3'];
  var COLUMNS = ['KI', 'NaCl', 'NaOH', 'Na2SO4', 'Na3PO4', 'Na2CO3', 'CuSO4', 'FeCl3'];
  var SKIP = { '3-0': true, '3-6': true, '4-0': true, '4-7': true };    // "row-column", counted from 0

  function skipped(row, col) { return !!SKIP[row + '-' + col]; }
  function solution(id) { return BY_ID[id]; }

  // What a student can record for a box. The 3D lab knows these values.
  var ANSWERS = [
    { value: 'nr', text: 'N.R.', long: 'no reaction' },
    { value: 'white', text: 'White ppt', long: 'a white precipitate' },
    { value: 'yellow', text: 'Yellow ppt', long: 'a yellow precipitate' },
    { value: 'brown', text: 'Brown ppt', long: 'a brown precipitate' },
    { value: 'red', text: 'Red ppt', long: 'a red precipitate' },
    { value: 'blue', text: 'Blue/green ppt', long: 'a blue or green precipitate' }
  ];

  // ---- Writing formulas ------------------------------------------------------------------------

  var SUBSCRIPTS = '₀₁₂₃₄₅₆₇₈₉';

  // "Ca3(PO4)2" -> "Ca₃(PO₄)₂": a number that follows a letter or a closing bracket is a subscript.
  function pretty(text) {
    var out = '', prev = '', prevSub = false;
    String(text == null ? '' : text).split('').forEach(function (ch) {
      var sub = /\d/.test(ch) && (/[A-Za-z)]/.test(prev) || (/\d/.test(prev) && prevSub));
      out += sub ? SUBSCRIPTS[+ch] : ch;
      prev = ch;
      prevSub = sub;
    });
    return out;
  }

  function gcd(a, b) { return b ? gcd(b, a % b) : Math.abs(a); }

  // The neutral compound of a positive and a negative ion, in the smallest whole numbers.
  function compound(cationKey, anionKey) {
    var c = IONS[cationKey], a = IONS[anionKey];
    var g = gcd(c.q, a.q);
    var nc = a.q / g, na = c.q / g;
    var formula = c.f + (nc > 1 ? nc : '') + (na > 1 ? (a.group ? '(' + a.f + ')' + na : a.f + na) : a.f);
    return { cation: cationKey, anion: anionKey, nc: nc, na: na, formula: formula };
  }

  // "Ca3(PO4)2" -> { Ca: 3, P: 2, O: 8 }, or null when it is not a formula. A state such as (s)
  // or (aq) at the end is allowed and ignored, and so are spaces and typed subscript digits.
  function parseFormula(text) {
    var s = String(text == null ? '' : text).replace(/[₀-₉]/g, function (d) { return SUBSCRIPTS.indexOf(d); })
      .replace(/\s+/g, '').replace(/\((s|aq|l|g)\)$/i, '');
    if (!s) return null;
    var i = 0;
    function group(closing) {
      var counts = {}, any = false;
      while (i < s.length) {
        var ch = s[i], part;
        if (ch === '(' || ch === '[') {
          i++;
          part = group(ch === '(' ? ')' : ']');
          if (!part) return null;
        } else if (ch === ')' || ch === ']') {
          if (ch !== closing || !any) return null;
          i++;
          return counts;
        } else {
          var m = /^[A-Z][a-z]?/.exec(s.slice(i));
          if (!m) return null;
          i += m[0].length;
          part = {};
          part[m[0]] = 1;
        }
        var n = /^\d+/.exec(s.slice(i)), times = 1;
        if (n) { times = parseInt(n[0], 10); i += n[0].length; if (times < 1) return null; }
        Object.keys(part).forEach(function (el) { counts[el] = (counts[el] || 0) + part[el] * times; });
        any = true;
      }
      return closing || !any ? null : counts;
    }
    return group('');
  }

  function sameCounts(a, b) {
    var ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(function (k) { return a[k] === b[k]; });
  }
  function sameElements(a, b) {
    var ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(function (k) { return b[k] > 0; });
  }

  // ---- Table 1 ---------------------------------------------------------------------------------
  // Results are { ok, message }, where ok is true, false, or null (nothing to say yet).

  function boxName(row, col) {
    return pretty(solution(ROWS[row]).formula) + ' + ' + pretty(solution(COLUMNS[col]).formula);
  }

  function boxMessage(verdict) {
    if (verdict === 'ok') return { ok: true, message: '' };
    var text = {
      empty: 'Nothing is in this box yet. Put in its two drops and stir them first.',
      half: 'This box has only one of its two drops. Add the other and stir.',
      unstirred: 'Stir this box with the toothpick, then look again.',
      color: 'Something did form here. Look again at its color: click the box on the sheet for a close look.',
      off: 'Look again: click this box on the sheet for a close look.'
    }[verdict];
    return text ? { ok: false, message: text } : { ok: null, message: '' };
  }

  // ---- Which ions tend to form precipitates? ---------------------------------------------------
  // Worked out from the student's own accepted table. grid[row][col] is 'nr', a color, or ''.

  var CATIONS = ['Ag', 'Pb', 'Ca', 'Cu', 'Fe'];                 // one for each row of the sheet
  var ANIONS = ['I', 'Cl', 'OH', 'SO4', 'PO4', 'CO3'];          // one for each of the first six columns

  function rowTally(grid, row) {
    var boxes = 0, reactions = 0;
    for (var c = 0; c < COLUMNS.length; c++) {
      if (skipped(row, c)) continue;
      boxes++;
      if (grid[row][c] && grid[row][c] !== 'nr') reactions++;
    }
    return { boxes: boxes, reactions: reactions };
  }
  function columnTally(grid, col) {
    var boxes = 0, reactions = 0;
    for (var r = 0; r < ROWS.length; r++) {
      if (skipped(r, col)) continue;
      boxes++;
      if (grid[r][col] && grid[r][col] !== 'nr') reactions++;
    }
    return { boxes: boxes, reactions: reactions };
  }

  // The positive ions whose row shows a reaction in almost every box. "Almost every" is taken as
  // three quarters or more: the lab's own reading of the handout's hint, not a number from the key.
  function cationsFrom(grid) {
    return CATIONS.filter(function (ion, row) {
      var t = rowTally(grid, row);
      return t.reactions >= t.boxes * 0.75;
    });
  }
  // The negative ions whose column shows a reaction in every box.
  function anionsFrom(grid) {
    return ANIONS.filter(function (ion, col) {
      var t = columnTally(grid, col);
      return t.reactions === t.boxes;
    });
  }

  // kind: 'cations' or 'anions'; chosen: the ions ticked; complete: whether every box of Table 1 is accepted.
  function checkIons(kind, chosen, grid, complete) {
    if (!chosen.length) return { ok: null, message: '' };
    if (!complete) return { ok: null, message: 'This is checked once every box of Table 1 is recorded.' };
    var cations = kind === 'cations';
    var expected = cations ? cationsFrom(grid) : anionsFrom(grid);
    var want = cations ? 2 : 3;
    // nothing is judged until the right number are chosen, so choosing them one at a time is not held against anyone
    if (chosen.length !== want) return { ok: null, message: 'Choose ' + (chosen.length > want ? 'only ' : '') + (want === 2 ? 'two' : 'three') + '.' };
    var wrong = chosen.filter(function (ion) { return expected.indexOf(ion) < 0; });
    var missing = expected.filter(function (ion) { return chosen.indexOf(ion) < 0; });
    if (!wrong.length && !missing.length) return { ok: true, message: '' };
    if (wrong.length) {
      var ion = wrong[0];
      if (cations) {
        var rt = rowTally(grid, CATIONS.indexOf(ion));
        return { ok: false, message: 'Look at the ' + IONS[ion].name + ' row of your Table 1: ' + rt.reactions + ' of its ' + rt.boxes + ' boxes ' + (rt.reactions === 1 ? 'shows' : 'show') + ' a reaction. Is that almost every box?' };
      }
      var ct = columnTally(grid, ANIONS.indexOf(ion));
      return { ok: false, message: 'Look at the ' + IONS[ion].name + ' column of your Table 1: ' + ct.reactions + ' of its ' + ct.boxes + ' boxes ' + (ct.reactions === 1 ? 'shows' : 'show') + ' a reaction. Is that every box?' };
    }
    return { ok: false, message: 'Look again at your Table 1 for ' + (cations ? 'rows in which almost every box' : 'columns in which every box') + ' shows a reaction.' };
  }

  // ---- Balanced equations ----------------------------------------------------------------------
  // Each equation is two of the solutions. The first one in the list is worked as the example.

  var EQUATIONS = [
    { ab: 'FeCl3', cd: 'Na2CO3', example: true },
    { ab: 'AgNO3', cd: 'KI' },
    { ab: 'AgNO3', cd: 'Na2SO4' },
    { ab: 'PbNO32', cd: 'NaCl' },
    { ab: 'PbNO32', cd: 'FeCl3' },
    { ab: 'CaCl2', cd: 'NaOH' },
    { ab: 'CaCl2', cd: 'CuSO4' },
    { ab: 'CuSO4', cd: 'Na3PO4' },
    { ab: 'FeCl3', cd: 'NaOH' }
  ];

  // The reactants and products of an equation, each as { cation, anion, nc, na, formula }, and the
  // smallest whole-number coefficients that balance it.
  function solve(eq) {
    var AB = solution(eq.ab), CD = solution(eq.cd);
    var r1 = compound(AB.cation, AB.anion), r2 = compound(CD.cation, CD.anion);
    var p1 = compound(AB.cation, CD.anion), p2 = compound(CD.cation, AB.anion);
    for (var a = 1; a <= 12; a++) {
      for (var b = 1; b <= 12; b++) {
        var c = a * r1.nc / p1.nc, d = b * r2.nc / p2.nc;
        if (c % 1 || d % 1) continue;
        if (a * r1.na === d * p2.na && b * r2.na === c * p1.na) return { r1: r1, r2: r2, p1: p1, p2: p2, coefficients: [a, b, c, d] };
      }
    }
    return null;
  }

  function coefficient(text) {
    var s = String(text == null ? '' : text).trim();
    if (!s) return 1;
    return /^\d{1,2}$/.test(s) && +s >= 1 ? +s : null;
  }

  function startsWith(text, symbol) {
    var s = String(text || '').replace(/\s+/g, '');
    return s.indexOf(symbol) === 0 && !/[a-z]/.test(s.charAt(symbol.length));
  }

  // entry: { a, b, c, d, p1, p2 } as typed: four coefficients (empty = 1) and two product formulas.
  function checkEquation(eq, entry) {
    var e = entry || {};
    var typed = [e.p1, e.p2].map(function (t) { return String(t == null ? '' : t).trim(); });
    if (!typed[0] && !typed[1]) return { ok: null, message: '' };
    if (!typed[0] || !typed[1]) return { ok: null, message: 'Write the formulas of both products.' };
    var parsed = typed.map(parseFormula);
    if (!parsed[0] || !parsed[1]) return { ok: false, message: 'Type each formula with plain letters and numbers, for example Ca3(PO4)2. Capital letters matter: Co is not CO.' };

    var s = solve(eq);
    var want = [parseFormula(s.p1.formula), parseFormula(s.p2.formula)];
    var order = null;       // which typed product is which
    if (sameCounts(parsed[0], want[0]) && sameCounts(parsed[1], want[1])) order = [0, 1];
    else if (sameCounts(parsed[0], want[1]) && sameCounts(parsed[1], want[0])) order = [1, 0];

    if (!order) {
      var reactants = [parseFormula(s.r1.formula), parseFormula(s.r2.formula)];
      var unchanged = parsed.every(function (p) { return sameCounts(p, reactants[0]) || sameCounts(p, reactants[1]); });
      if (unchanged) return { ok: false, message: 'Those are the reactants again. In the products the two positive ions have traded partners.' };
      // right ions, wrong numbers of them?
      for (var k = 0; k < 2; k++) {
        var product = k === 0 ? s.p1 : s.p2;
        var hasRight = parsed.some(function (p) { return sameCounts(p, want[k]); });
        var hasIons = parsed.some(function (p) { return sameElements(p, want[k]); });
        if (!hasRight && hasIons) {
          return { ok: false, message: 'The product with ' + IONS[product.cation].name + ' has the right ions, but check how many of each: the charges of ' +
            IONS[product.cation].name + ' and ' + IONS[product.anion].name + ' must cancel, in the smallest whole numbers.' };
        }
      }
      return { ok: false, message: 'Check the formulas of the products. Each one is the positive ion of one reactant with the negative ion of the other.' };
    }

    var products = [order[0] === 0 ? s.p1 : s.p2, order[1] === 0 ? s.p1 : s.p2];   // in the order typed
    for (var j = 0; j < 2; j++) {
      if (!startsWith(typed[j], IONS[products[j].cation].f)) return { ok: false, message: 'Write the positive ion first in each formula.' };
    }

    var numbers = [coefficient(e.a), coefficient(e.b), coefficient(e.c), coefficient(e.d)];
    if (numbers.some(function (n) { return n === null; })) return { ok: false, message: 'Each coefficient is a whole number. Leave the box empty for 1.' };
    // the coefficients in the order reactant 1, reactant 2, product with AB's positive ion, the other product
    var c1 = order[0] === 0 ? numbers[2] : numbers[3], c2 = order[0] === 0 ? numbers[3] : numbers[2];
    var a = numbers[0], b = numbers[1];
    // count each of the four ions on the two sides
    var tallies = [
      { ion: s.r1.cation, left: a * s.r1.nc, right: c1 * s.p1.nc },
      { ion: s.r1.anion, left: a * s.r1.na, right: c2 * s.p2.na },
      { ion: s.r2.cation, left: b * s.r2.nc, right: c2 * s.p2.nc },
      { ion: s.r2.anion, left: b * s.r2.na, right: c1 * s.p1.na }
    ];
    var off = tallies.filter(function (t) { return t.left !== t.right; })[0];
    if (off) {
      return { ok: false, message: 'The formulas are right. Now balance it: with these coefficients there ' + (off.left === 1 ? 'is ' : 'are ') + off.left + ' ' +
        IONS[off.ion].name + ' on the left and ' + off.right + ' on the right.' };
    }
    var common = gcd(gcd(a, b), gcd(c1, c2));
    if (common > 1) return { ok: false, message: 'It balances, but not in the smallest whole numbers: every coefficient can be divided by ' + common + '.' };
    return { ok: true, message: '' };
  }

  return {
    IONS: IONS,
    SOLUTIONS: SOLUTIONS,
    ROWS: ROWS,
    COLUMNS: COLUMNS,
    ANSWERS: ANSWERS,
    CATIONS: CATIONS,
    ANIONS: ANIONS,
    EQUATIONS: EQUATIONS,
    solution: solution,
    skipped: skipped,
    pretty: pretty,
    compound: compound,
    parseFormula: parseFormula,
    boxName: boxName,
    boxMessage: boxMessage,
    cationsFrom: cationsFrom,
    anionsFrom: anionsFrom,
    checkIons: checkIons,
    solve: solve,
    checkEquation: checkEquation
  };
});
