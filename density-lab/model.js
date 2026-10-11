/*
 * Density of an Unknown Metal: shared model.
 * Generates each student's unknown from a short code, holds the true values,
 * and checks readings and worksheet answers. Used by the lab page and by the
 * instructor key, so both always agree.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DensityLabModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- Settings an instructor may want to change -------------------------------------------

  var INITIAL_ML = 26.2;            // water already in the cylinder
  var METALS = [                    // candidate unknowns, density in g/mL
    { id: 'Al', name: 'aluminum', density: 2.70 },
    { id: 'Ti', name: 'titanium', density: 4.51 },
    { id: 'Zn', name: 'zinc', density: 7.14 },
    { id: 'Fe', name: 'iron', density: 7.87 },
    { id: 'Cu', name: 'copper', density: 8.96 },
    { id: 'Pb', name: 'lead', density: 11.34 }
  ];
  var BASE_VOLUMES_ML = [3.0, 5.0, 7.0, 9.5, 12.0]; // nominal piece volumes, smallest to largest
  var VOLUME_SPREAD_ML = 0.6;       // each piece varies by up to this much per student
  var MASS_TOLERANCE_G = 0.011;     // balance reads to 0.01 g
  var VOLUME_TOLERANCE_ML = 0.2;    // cylinder is read to 0.1 mL
  var MENISCUS_RISE_ML = 0.9;       // how far the water climbs the glass above the true level

  // ---- Small helpers ----------------------------------------------------------------------

  function round(value, places) {
    var f = Math.pow(10, places);
    return Math.round((value + (value >= 0 ? 1e-9 : -1e-9)) * f) / f;
  }
  function near(a, b, tol) { return Math.abs(a - b) <= tol + 1e-9; }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- Unknown codes ----------------------------------------------------------------------
  // A code is four characters plus one check character, e.g. "K7Q4M". The check character
  // catches typing mistakes when the instructor looks a code up.

  var ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // no 0/1/I/L/O
  var BASE = ALPHABET.length;                         // 31
  var CODE_SPACE = BASE * BASE * BASE * BASE;

  function checkChar(digits) {
    var sum = 7;
    for (var i = 0; i < digits.length; i++) sum += (i + 2) * digits[i];
    return ALPHABET[sum % BASE];
  }
  function codeFromNumber(n) {
    n = ((n % CODE_SPACE) + CODE_SPACE) % CODE_SPACE;
    var digits = [];
    for (var i = 0; i < 4; i++) { digits.unshift(n % BASE); n = Math.floor(n / BASE); }
    return digits.map(function (d) { return ALPHABET[d]; }).join('') + checkChar(digits);
  }
  function normalizeCode(text) {
    return String(text == null ? '' : text).toUpperCase().replace(/[^0-9A-Z]/g, '');
  }
  function numberFromCode(text) {
    var code = normalizeCode(text);
    if (code.length !== 5) return null;
    var digits = [];
    for (var i = 0; i < 4; i++) {
      var d = ALPHABET.indexOf(code[i]);
      if (d < 0) return null;
      digits.push(d);
    }
    if (checkChar(digits) !== code[4]) return null;
    return ((digits[0] * BASE + digits[1]) * BASE + digits[2]) * BASE + digits[3];
  }
  function randomCode() {
    var n;
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      var buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      n = buf[0] % CODE_SPACE;
    } else {
      n = Math.floor(Math.random() * CODE_SPACE);
    }
    return codeFromNumber(n);
  }

  // ---- The unknown behind a code ------------------------------------------------------------

  function unknownFromCode(text) {
    var n = numberFromCode(text);
    if (n === null) return null;
    var rnd = mulberry32(Math.imul(n + 1, 0x9E3779B1) ^ 0x85EBCA6B);
    rnd(); rnd();
    var metal = METALS[Math.floor(rnd() * METALS.length)];
    var volumes = BASE_VOLUMES_ML.map(function (base) {
      return round(base + (rnd() * 2 - 1) * VOLUME_SPREAD_ML, 2);
    });
    var masses = volumes.map(function (v) { return round(metal.density * v, 2); });
    return {
      code: codeFromNumber(n),
      metal: metal,
      initialVolume: INITIAL_ML,
      pieces: volumes.map(function (v, i) {
        return { number: i + 1, volume: v, mass: masses[i] };
      })
    };
  }

  // True cylinder reading right after each piece went in. `order` lists piece numbers in the
  // order they were added. Returns a map: piece number -> true reading (mL).
  function trueReadings(unknown, order) {
    var level = unknown.initialVolume;
    var out = {};
    (order || []).forEach(function (num) {
      var piece = unknown.pieces[num - 1];
      if (!piece || out[num] !== undefined) return;
      level = round(level + piece.volume, 2);
      out[num] = level;
    });
    return out;
  }

  // ---- Reading what a student typed ----------------------------------------------------------

  // "12.30 g" -> { value: 12.3, decimals: 2, unit: "g" }. Returns null when there is no number.
  function parseQuantity(text) {
    var s = String(text == null ? '' : text).replace(/[−‒–—]/g, '-').trim();
    var m = /^([+-]?\s*(?:\d+\.?\d*|\.\d+))(?:\s*(?:[xX×*]\s*10\s*\^?\s*([+-]?\d+)|[eE]([+-]?\d+)))?\s*(.*)$/.exec(s);
    if (!m) return null;
    var mantissa = m[1].replace(/\s+/g, '');
    var exp = m[2] !== undefined ? parseInt(m[2], 10) : (m[3] !== undefined ? parseInt(m[3], 10) : 0);
    var value = parseFloat(mantissa) * Math.pow(10, exp);
    if (!isFinite(value)) return null;
    var dot = mantissa.indexOf('.');
    var decimals = dot < 0 ? 0 : mantissa.length - dot - 1;
    return { value: value, decimals: Math.max(0, decimals - exp), unit: m[4].trim(), raw: s };
  }

  function unitKey(unit) {
    return String(unit || '').toLowerCase()
      .replace(/³/g, '3').replace(/⁻¹/g, '-1')
      .replace(/[\s.·*⋅()]/g, '');
  }
  function isVolumeUnit(unit) {
    return /^(ml|milliliters?|millilitres?|cm3|cm\^3|cc)$/.test(unitKey(unit));
  }
  function isMassUnit(unit) {
    return /^(g|grams?|gm)$/.test(unitKey(unit));
  }
  function isDensityUnit(unit) {
    var k = unitKey(unit).replace(/per/g, '/').replace(/grams?/g, 'g')
      .replace(/milliliters?|millilitres?/g, 'ml');
    return /^g\/(ml|cm3|cm\^3|cc)$/.test(k) || /^g(ml|cm3|cm\^3)\^?-1$/.test(k);
  }

  // ---- Checks on the two readings --------------------------------------------------------------
  // Every check returns { ok, message }. `ok` is true, false, or null (nothing to check yet).

  function checkMass(unknown, pieceNumber, text) {
    if (!String(text || '').trim()) return { ok: null, message: '' };
    var q = parseQuantity(text);
    if (!q) return { ok: false, message: 'Enter the mass as a number.' };
    if (q.unit && !isMassUnit(q.unit)) return { ok: false, message: 'Mass is recorded in grams.' };
    var piece = unknown.pieces[pieceNumber - 1];
    if (near(q.value, piece.mass, MASS_TOLERANCE_G)) {
      if (q.decimals !== 2) {
        return { ok: false, message: 'Record every digit the balance shows, to 0.01 g.' };
      }
      return { ok: true, message: '' };
    }
    for (var i = 0; i < unknown.pieces.length; i++) {
      if (i !== pieceNumber - 1 && near(q.value, unknown.pieces[i].mass, MASS_TOLERANCE_G)) {
        return { ok: false, message: 'That is the mass of a different piece. Check the number on the piece you weighed.' };
      }
    }
    return {
      ok: false,
      message: 'That does not match piece ' + pieceNumber +
        '. Zero the balance, put only this piece on the pan, and read it again.'
    };
  }

  function checkVolume(unknown, order, pieceNumber, text) {
    if (!String(text || '').trim()) return { ok: null, message: '' };
    var q = parseQuantity(text);
    if (!q) return { ok: false, message: 'Enter the volume as a number.' };
    if (q.unit && !isVolumeUnit(q.unit)) return { ok: false, message: 'Volume is recorded in mL.' };
    var truth = trueReadings(unknown, order)[pieceNumber];
    if (truth === undefined) {
      return { ok: false, message: 'Add piece ' + pieceNumber + ' to the cylinder first, then read the water level.' };
    }
    var diff = q.value - truth;
    if (Math.abs(diff) <= VOLUME_TOLERANCE_ML + 1e-9) {
      if (q.decimals !== 1) {
        return { ok: false, message: 'Read to the nearest 0.1 mL: estimate one digit between the 1 mL lines.' };
      }
      return { ok: true, message: '' };
    }
    if (diff > VOLUME_TOLERANCE_ML && diff <= MENISCUS_RISE_ML + 0.35) {
      return { ok: false, message: 'A little high. Read the bottom of the meniscus, not where the water touches the glass.' };
    }
    var other = trueReadings(unknown, order);
    for (var key in other) {
      if (Number(key) !== pieceNumber && near(q.value, other[key], VOLUME_TOLERANCE_ML)) {
        return { ok: false, message: 'That was the level after a different piece. Record the reading taken right after piece ' + pieceNumber + ' went in.' };
      }
    }
    if (near(q.value, round(truth - unknown.initialVolume, 2), VOLUME_TOLERANCE_ML) && order[0] !== pieceNumber) {
      return { ok: false, message: 'Record the water level you read on the cylinder, not the change in volume.' };
    }
    var whole = Math.round(diff);
    if (whole !== 0 && Math.abs(diff - whole) <= VOLUME_TOLERANCE_ML + 1e-9 && Math.abs(whole) <= 10) {
      return { ok: false, message: 'Close, but count the lines again from the nearest numbered mark. Each line is 1 mL.' };
    }
    return { ok: false, message: 'That reading is off. Open the cylinder close-up and read the bottom of the meniscus.' };
  }

  // ---- Points for the graph -----------------------------------------------------------------
  // x = (cylinder reading - initial volume), y = running total of the masses in the cylinder.
  // Uses the values the student recorded. Returns null until every added piece has both values.

  function plottedPoints(unknown, order, recorded) {
    if (!order || order.length !== unknown.pieces.length) return null;
    var total = 0;
    var points = [];
    for (var i = 0; i < order.length; i++) {
      var entry = recorded[order[i]];
      if (!entry) return null;
      var mass = parseQuantity(entry.mass), vol = parseQuantity(entry.volume);
      if (!mass || !vol) return null;
      total = round(total + mass.value, 2);
      points.push({
        piece: order[i],
        mass: mass.value,
        reading: vol.value,
        x: round(vol.value - unknown.initialVolume, 2),
        y: total
      });
    }
    return points;
  }

  function fitLine(points) {
    var n = points.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
    points.forEach(function (p) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; });
    var den = n * sxx - sx * sx;
    if (n < 2 || Math.abs(den) < 1e-12) return null;
    var slope = (n * sxy - sx * sy) / den;
    return { slope: slope, intercept: (sy - slope * sx) / n };
  }

  // Graph-paper axis: a round maximum, labelled major lines and easy-to-count minor lines.
  function axisFor(maxValue) {
    var target = Math.max(maxValue, 1e-6) * 1.08;
    var pow = Math.pow(10, Math.floor(Math.log10(target / 5)));
    var steps = [1, 2, 5, 10];
    var major = pow;
    for (var i = 0; i < steps.length; i++) {
      major = steps[i] * pow;
      if (target / major <= 9) break;
    }
    var lead = Math.round(major / Math.pow(10, Math.floor(Math.log10(major) + 1e-9)));
    var minor = lead === 2 ? major / 4 : major / 5;
    var max = Math.ceil(target / major - 1e-9) * major;
    var places = Math.max(0, -Math.floor(Math.log10(minor) + 1e-9));
    return { max: round(max, 6), major: round(major, 6), minor: round(minor, 6), places: places };
  }

  // ---- Checks on the worksheet ----------------------------------------------------------------

  var ON_LINE_SQUARES = 0.5;  // a point may sit this many small grid squares off the trendline

  function checkCoordinate(text, kind) {
    if (!String(text || '').trim()) return { ok: null, message: '' };
    var q = parseQuantity(text);
    if (!q) return { ok: false, message: 'Enter a number followed by its unit.' };
    if (!q.unit) return { ok: false, message: 'Include the unit.' };
    if (kind === 'x' && !isVolumeUnit(q.unit)) return { ok: false, message: 'x is a volume. Check the unit.' };
    if (kind === 'y' && !isMassUnit(q.unit)) return { ok: false, message: 'y is a mass. Check the unit.' };
    return { ok: true, message: '', value: q.value };
  }

  // graph = { fit, xAxis, yAxis }; returns per-point results plus the parsed point when both
  // coordinates are usable.
  function checkPoint(graph, xText, yText) {
    var cx = checkCoordinate(xText, 'x'), cy = checkCoordinate(yText, 'y');
    var result = { x: cx, y: cy, ok: null, message: '', point: null };
    if (cx.ok === null && cy.ok === null) return result;
    if (cx.ok !== true || cy.ok !== true) { result.ok = false; return result; }
    var p = { x: cx.value, y: cy.value };
    result.point = p;
    if (p.x < -1e-9 || p.x > graph.xAxis.max + 1e-9 || p.y > graph.yAxis.max + 1e-9) {
      result.ok = false;
      result.message = 'That point is outside the graph. Pick a point you can read from the grid.';
      return result;
    }
    var residual = p.y - (graph.fit.slope * p.x + graph.fit.intercept);
    var s = graph.fit.slope * graph.xAxis.minor / graph.yAxis.minor;
    var squares = Math.abs(residual / graph.yAxis.minor) / Math.sqrt(1 + s * s);
    if (squares > ON_LINE_SQUARES) {
      result.ok = false;
      result.message = 'That point is not on the trendline. Pick a spot where the line crosses the grid cleanly and read both axes again.';
      return result;
    }
    result.ok = true;
    return result;
  }

  function checkPointSpacing(graph, p1, p2) {
    if (!p1 || !p2) return { ok: null, message: '' };
    var dx = Math.abs(p2.x - p1.x);
    if (dx < graph.xAxis.minor * 2 - 1e-9) {
      return { ok: false, message: 'Choose two different points that are far apart on the line.' };
    }
    if (dx < graph.xAxis.max * 0.3) {
      return { ok: true, message: 'These points are close together. Points farther apart give a more reliable slope.' };
    }
    return { ok: true, message: '' };
  }

  function checkSlope(p1, p2, text) {
    if (!String(text || '').trim()) return { ok: null, message: '' };
    var q = parseQuantity(text);
    if (!q) return { ok: false, message: 'Enter the slope as a number followed by its units.' };
    if (!q.unit) return { ok: false, message: 'Include the units. Slope is rise over run: the y unit divided by the x unit.' };
    if (!isDensityUnit(q.unit)) return { ok: false, message: 'Check the units. Slope is the y unit divided by the x unit.' };
    if (!p1 || !p2) return { ok: false, message: 'Fix your two points first. The slope is calculated from them.' };
    var expected = (p2.y - p1.y) / (p2.x - p1.x);
    if (near(q.value, expected, Math.abs(expected) * 0.015 + 0.005)) return { ok: true, message: '', value: q.value };
    if (near(q.value, -expected, Math.abs(expected) * 0.015 + 0.005)) {
      return { ok: false, message: 'Check the sign. Subtract the points in the same order on top and bottom.' };
    }
    if (Math.abs(expected) > 1e-9 && near(q.value, 1 / expected, Math.abs(1 / expected) * 0.015 + 0.0005)) {
      return { ok: false, message: 'That is run over rise. Slope is the change in y divided by the change in x.' };
    }
    return { ok: false, message: 'That does not match your two points. Slope = (y₂ − y₁) ÷ (x₂ − x₁).' };
  }

  function checkIntercept(p1, p2, slopeText, text) {
    if (!String(text || '').trim()) return { ok: null, message: '' };
    var q = parseQuantity(text);
    if (!q) return { ok: false, message: 'Enter the y-intercept as a number followed by its unit.' };
    if (!q.unit) return { ok: false, message: 'Include the unit. The y-intercept is a value on the y axis.' };
    if (!isMassUnit(q.unit)) return { ok: false, message: 'Check the unit. The y-intercept is a value on the y axis.' };
    var slope = parseQuantity(slopeText);
    if (!p1 || !p2 || !slope) return { ok: false, message: 'Finish the slope first. The y-intercept is calculated from it.' };
    var exact = (p2.y - p1.y) / (p2.x - p1.x);
    var candidates = [], flipped = [];
    [p1, p2].forEach(function (p) {
      [slope.value, exact].forEach(function (m) {
        candidates.push({ b: p.y - m * p.x, tol: 0.2 + 0.003 * Math.abs(p.y) });
        flipped.push({ b: m * p.x - p.y, tol: 0.2 + 0.003 * Math.abs(p.y) });
      });
    });
    var hit = function (list) {
      return list.some(function (c) { return near(q.value, c.b, c.tol); });
    };
    if (hit(candidates)) return { ok: true, message: '', value: q.value };
    if (hit(flipped)) return { ok: false, message: 'Check the sign. Rearranging y = mx + b gives b = y − mx.' };
    return { ok: false, message: 'That does not match your slope and points. Put one of your points into y = mx + b and solve for b.' };
  }

  function checkEquation(slopeText, interceptText, text) {
    if (!String(text || '').trim()) return { ok: null, message: '' };
    var form = 'Write it in the form y = (slope with units)x + (y-intercept with unit).';
    var s = String(text).replace(/[−‒–—]/g, '-').replace(/³/g, '3')
      .replace(/⁻¹/g, '^-1').replace(/[\s()\[\]{}]/g, '').toLowerCase();
    var num = '(?:\\d+\\.?\\d*|\\.\\d+)';
    var re = new RegExp('^(?:y|mass|m)=([+-]?' + num + ')([a-z0-9/^.\\u00b7*-]*?)[*\\u00b7\\u00d7]?(?:x|volume|v)([+-])([+-]?' + num + ')([a-z]*)$');
    var m = re.exec(s);
    if (!m) return { ok: false, message: form };
    var mVal = parseFloat(m[1]);
    var bVal = parseFloat(m[4]) * (m[3] === '-' ? -1 : 1);
    if (!m[2] || !m[5]) return { ok: false, message: 'Include the units on both the slope and the y-intercept.' };
    if (!isDensityUnit(m[2]) || !isMassUnit(m[5])) return { ok: false, message: 'Check the units in your equation.' };
    var slope = parseQuantity(slopeText), intercept = parseQuantity(interceptText);
    if (!slope || !intercept) return { ok: false, message: 'Finish the slope and y-intercept first.' };
    var okM = near(mVal, slope.value, Math.abs(slope.value) * 0.005 + 1e-6);
    var okB = near(bVal, intercept.value, Math.abs(intercept.value) * 0.005 + 1e-6);
    if (okM && okB) return { ok: true, message: '' };
    if (okM && near(bVal, -intercept.value, Math.abs(intercept.value) * 0.005 + 1e-6)) {
      return { ok: false, message: 'Check the sign of the y-intercept in your equation.' };
    }
    return { ok: false, message: 'Use the slope and y-intercept values you found above.' };
  }

  return {
    INITIAL_ML: INITIAL_ML,
    METALS: METALS,
    VOLUME_TOLERANCE_ML: VOLUME_TOLERANCE_ML,
    MASS_TOLERANCE_G: MASS_TOLERANCE_G,
    round: round,
    randomCode: randomCode,
    codeFromNumber: codeFromNumber,
    numberFromCode: numberFromCode,
    normalizeCode: normalizeCode,
    unknownFromCode: unknownFromCode,
    trueReadings: trueReadings,
    parseQuantity: parseQuantity,
    isVolumeUnit: isVolumeUnit,
    isMassUnit: isMassUnit,
    isDensityUnit: isDensityUnit,
    checkMass: checkMass,
    checkVolume: checkVolume,
    plottedPoints: plottedPoints,
    fitLine: fitLine,
    axisFor: axisFor,
    checkCoordinate: checkCoordinate,
    checkPoint: checkPoint,
    checkPointSpacing: checkPointSpacing,
    checkSlope: checkSlope,
    checkIntercept: checkIntercept,
    checkEquation: checkEquation
  };
});
