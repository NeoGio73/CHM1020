/*
 * Density of an Unknown Metal: the page's model.
 * Unknown codes, reading what a student typed, the messages for each kind of reading, the graph,
 * and the worksheet checks. It holds nothing about any student's unknown: which metal a code
 * stands for, and whether a reading matches the balance or the cylinder, are worked out inside
 * the 3D lab, which tells the page only the verdict for each reading.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DensityLabModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- Settings ------------------------------------------------------------------------------

  var INITIAL_ML = 26.2;            // water already in the cylinder
  var PIECE_COUNT = 5;

  // ---- Small helpers ----------------------------------------------------------------------

  function round(value, places) {
    var f = Math.pow(10, places);
    return Math.round((value + (value >= 0 ? 1e-9 : -1e-9)) * f) / f;
  }
  function near(a, b, tol) { return Math.abs(a - b) <= tol + 1e-9; }

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
  function isCode(text) { return numberFromCode(text) !== null; }

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

  // ---- The two readings --------------------------------------------------------------------------
  // Results are { ok, message }, where ok is true, false, or null (nothing to say yet).
  //
  // The page screens what was typed: an empty box, something that is not a number, or the wrong
  // unit. Anything else goes to the 3D lab, which compares it with the balance or the cylinder
  // and answers with one of the verdicts below.

  function screenReading(kind, text) {
    if (!String(text || '').trim()) return { ok: null, message: '' };
    var q = parseQuantity(text);
    var mass = kind === 'mass';
    if (!q) return { ok: false, message: mass ? 'Enter the mass as a number.' : 'Enter the volume as a number.' };
    if (q.unit && !(mass ? isMassUnit(q.unit) : isVolumeUnit(q.unit))) {
      return { ok: false, message: mass ? 'Mass is recorded in grams.' : 'Volume is recorded in mL.' };
    }
    return { ok: null, message: '', ready: true, value: q.value, decimals: q.decimals };
  }

  function readingMessage(kind, verdict, pieceNumber) {
    if (verdict === 'ok') return { ok: true, message: '' };
    var text = kind === 'mass' ? {
      digits: 'Record every digit the balance shows, to 0.01 g.',
      'other-piece': 'That is the mass of a different piece. Check the number on the piece you weighed.',
      mismatch: 'That does not match piece ' + pieceNumber + '. Zero the balance, put only this piece on the pan, and read it again.'
    }[verdict] : {
      digits: 'Read to the nearest 0.1 mL: estimate one digit between the 1 mL lines.',
      'not-added': 'Add piece ' + pieceNumber + ' to the cylinder first, then read the water level.',
      high: 'A little high. Read the bottom of the meniscus, not where the water touches the glass.',
      'other-level': 'That was the level after a different piece. Record the reading taken right after piece ' + pieceNumber + ' went in.',
      change: 'Record the water level you read on the cylinder, not the change in volume.',
      'count-lines': 'Close, but count the lines again from the nearest numbered mark. Each line is 1 mL.',
      off: 'That reading is off. Open the cylinder close-up and read the bottom of the meniscus.'
    }[verdict];
    return text ? { ok: false, message: text } : { ok: null, message: '' };
  }

  // ---- Points for the graph -----------------------------------------------------------------
  // x = (cylinder reading - initial volume), y = running total of the masses in the cylinder.
  // Uses the values the student recorded. Returns null until every added piece has both values.

  function plottedPoints(order, recorded) {
    if (!order || order.length !== PIECE_COUNT) return null;
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
        x: round(vol.value - INITIAL_ML, 2),
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
    var leading = Math.round(major / Math.pow(10, Math.floor(Math.log10(major) + 1e-9)));
    var minor = leading === 2 ? major / 4 : major / 5;
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
    PIECE_COUNT: PIECE_COUNT,
    round: round,
    randomCode: randomCode,
    codeFromNumber: codeFromNumber,
    numberFromCode: numberFromCode,
    normalizeCode: normalizeCode,
    isCode: isCode,
    parseQuantity: parseQuantity,
    isVolumeUnit: isVolumeUnit,
    isMassUnit: isMassUnit,
    isDensityUnit: isDensityUnit,
    screenReading: screenReading,
    readingMessage: readingMessage,
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
