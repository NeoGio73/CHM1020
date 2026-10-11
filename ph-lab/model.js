/*
 * pH of Common Solutions: the page's model.
 * The twelve solutions, reading what a student typed, the messages for each verdict, and the
 * checks that use only the student's own entries (prediction correct? and the ranking). Whether a
 * pH reading matches the strip is worked out inside the 3D lab, which tells the page only the
 * verdict for each reading.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PhLabModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SOLUTIONS = [
    'Distilled Water', 'Ocean Water', 'Shampoo', 'Soda Pop', 'Vinegar', 'Acid Rain',
    'Lemon Juice', 'Window Cleaner', '0.1 M NaOH', '1.0 M NaOH', '0.1 M HCl', '1 M HCl'
  ];
  var COUNT = SOLUTIONS.length;
  var CLASSES = ['acid', 'base', 'neutral'];
  var CLASS_NAMES = { acid: 'Acid', base: 'Base', neutral: 'Neutral' };

  // "7", "pH 7", "6.5" -> { value }. Returns null when there is no number.
  function parseReading(text) {
    var s = String(text == null ? '' : text).replace(/[−‒–—]/g, '-').trim().replace(/^ph\s*[:=]?\s*/i, '');
    var m = /^([+-]?(?:\d+\.?\d*|\.\d+))$/.exec(s);
    if (!m) return null;
    var value = parseFloat(m[1]);
    return isFinite(value) ? { value: value } : null;
  }

  // ---- Measured pH ---------------------------------------------------------------------------
  // Results are { ok, message }, where ok is true, false, or null (nothing to say yet). The page
  // screens what was typed; a proper number goes to the 3D lab, which answers with a verdict.

  function screenReading(text) {
    if (!String(text || '').trim()) return { ok: null, message: '' };
    var q = parseReading(text);
    if (!q) return { ok: false, message: 'Enter the pH as a number from 0 to 14.' };
    if (q.value < 0 || q.value > 14) return { ok: false, message: 'The pH paper reads from 0 to 14.' };
    return { ok: null, message: '', ready: true, value: q.value };
  }

  function readingMessage(verdict, n) {
    if (verdict === 'ok') return { ok: true, message: '' };
    var text = {
      untested: 'Test solution ' + n + ' with a strip of pH paper first, then compare the strip with the color chart.',
      off: 'Look again: hold strip ' + n + ' next to the color chart and find the closest color.'
    }[verdict];
    return text ? { ok: false, message: text } : { ok: null, message: '' };
  }

  // ---- Prediction correct? -------------------------------------------------------------------

  function classOf(pH) {
    if (Math.abs(pH - 7) < 1e-9) return 'neutral';
    return pH < 7 ? 'acid' : 'base';
  }

  // hypothesis: 'acid' | 'base' | 'neutral'; measured: the student's accepted reading (number);
  // answer: 'Y' | 'N' | ''.
  function checkCorrect(hypothesis, measured, answer) {
    if (!answer) return { ok: null, message: '' };
    if (!hypothesis || measured == null) return { ok: null, message: '' };
    var expected = hypothesis === classOf(measured) ? 'Y' : 'N';
    if (answer === expected) return { ok: true, message: '' };
    return {
      ok: false,
      message: 'Check again: is a pH of ' + formatPh(measured) + ' acidic, basic or neutral, and is that what you predicted?'
    };
  }

  // ---- Ranking -------------------------------------------------------------------------------
  // order: solution indexes (0-11) from least acidic to most acidic. values: the student's
  // readings by solution index. Equal readings may come in either order.

  function checkOrder(order, values) {
    for (var i = 0; i + 1 < order.length; i++) {
      var a = order[i], b = order[i + 1];
      if (values[a] < values[b] - 1e-9) {
        return {
          ok: false,
          at: i,
          message: SOLUTIONS[b] + ' (pH ' + formatPh(values[b]) + ') is less acidic than ' + SOLUTIONS[a] +
            ' (pH ' + formatPh(values[a]) + '), so it goes above it.'
        };
      }
    }
    return { ok: true, at: -1, message: '' };
  }

  function formatPh(v) {
    return Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : String(v);
  }

  return {
    SOLUTIONS: SOLUTIONS,
    COUNT: COUNT,
    CLASSES: CLASSES,
    CLASS_NAMES: CLASS_NAMES,
    parseReading: parseReading,
    screenReading: screenReading,
    readingMessage: readingMessage,
    classOf: classOf,
    checkCorrect: checkCorrect,
    checkOrder: checkOrder,
    formatPh: formatPh
  };
});
