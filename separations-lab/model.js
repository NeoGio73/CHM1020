/*
 * Who Wrote the Ransom Note? (paper chromatography of black inks): the page's model.
 * Unknown codes, reading a time off what a student typed, the wording of every message, the next
 * step on the bench, and the checks that need nothing but the student's own entries.
 *
 * It holds nothing about any student's unknown. Which pens a code stands for, which ink the
 * unknown is, and what colors any ink separates into are worked out inside the 3D lab. The lab
 * tells the page the numbers on the four pens, and whether the colors ticked for a lane are fair.
 * It never says which pen the unknown is: that is marked by the instructor, from the answer key.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.InkLabModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- The bench, as the page names it -------------------------------------------------------

  var LANES = 5, UNKNOWN_LANE = 2;
  var PLATE_MM = 100;               // the height of a plate
  var READY_MM = 80;                // the solvent is within 2 cm of the top: the plate may come out (the handout's step 14: within 1 or 2 cm of the top)
  var OVERRUN_MM = 96.5;            // the solvent has reached the top: the plate stayed in too long
  var TIME_TOLERANCE = 20;          // seconds either way on a time read off the timer

  // 0 is the acetone plate and chamber, 1 the isopropyl alcohol ones.
  var SOLVENTS = [
    { key: 'acetone', title: 'Acetone', word: 'acetone', liquid: 'acetone', system: 'Acetone-based solvent' },
    { key: 'alcohol', title: 'Alcohol', word: 'alcohol', liquid: 'isopropyl alcohol', system: 'Isopropyl alcohol-based solvent' }
  ];
  var BOTTLES = ['acetone', 'isopropyl alcohol', 'distilled water'];

  // The colors a student may tick. The values are the words the 3D lab knows.
  var COLORS = [
    { value: 'grey', text: 'black or grey', swatch: '#4a4d52' },
    { value: 'blue', text: 'blue', swatch: '#2f55b5' },
    { value: 'purple', text: 'purple', swatch: '#7b45b8' },
    { value: 'red', text: 'pink or red', swatch: '#dc5a78' },
    { value: 'orange', text: 'orange', swatch: '#e5873f' },
    { value: 'yellow', text: 'yellow', swatch: '#e0bd1c' },
    { value: 'green', text: 'green', swatch: '#33874c' },
    { value: 'brown', text: 'brown or tan', swatch: '#a67c4e' }
  ];

  function colorText(value) {
    for (var i = 0; i < COLORS.length; i++) if (COLORS[i].value === value) return COLORS[i].text;
    return value;
  }

  // lanes: the pen number on each lane of a plate, left to right, with 0 for the unknown.
  function validLanes(lanes) {
    if (!Array.isArray(lanes) || lanes.length !== LANES) return false;
    for (var i = 0; i < LANES; i++) {
      if (i === UNKNOWN_LANE ? lanes[i] !== 0 : !(lanes[i] >= 1 && lanes[i] <= 8)) return false;
    }
    return true;
  }
  function laneName(lanes, lane) {
    return lane === UNKNOWN_LANE ? 'Unknown' : 'Pen ' + lanes[lane];
  }
  function referenceLanes() {
    var out = [];
    for (var i = 0; i < LANES; i++) if (i !== UNKNOWN_LANE) out.push(i);
    return out;
  }

  // ---- Unknown codes ---------------------------------------------------------------------------
  // A code is four characters plus one check character, e.g. "K7Q4M", the same form as the
  // density lab's. The check character catches typing mistakes when the instructor looks a code up.

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

  // ---- Times -------------------------------------------------------------------------------------
  // The timer shows minutes and seconds since the first plate went in.

  // "7:45", "7.45", "7 45", "7 min 45 s", "7m45s" -> 465. Returns null when it cannot be read.
  function parseTime(text) {
    var s = String(text == null ? '' : text).trim().toLowerCase();
    if (!s) return null;
    var m = /^(\d{1,3})\s*(?:[:.;,]|\s|m(?:in(?:utes?)?)?\.?)\s*(\d{1,2})\s*(?:s(?:ec(?:onds?)?)?\.?)?$/.exec(s);
    if (m) {
      var sec = parseInt(m[2], 10);
      if (sec > 59) return null;
      return parseInt(m[1], 10) * 60 + sec;
    }
    m = /^(\d{1,3})\s*m(?:in(?:utes?)?)?\.?$/.exec(s);
    if (m) return parseInt(m[1], 10) * 60;
    return null;
  }

  function formatTime(seconds) {
    var whole = Math.max(0, Math.floor(seconds + 1e-6));
    var sec = whole % 60;
    return Math.floor(whole / 60) + ':' + (sec < 10 ? '0' : '') + sec;
  }

  // Results are { ok, message }, where ok is true, false, or null (nothing to say yet).
  //
  // truth: what the timer showed (seconds) when the plate went in or came out, or null when that
  // has not happened yet. A time cannot be read a second time once the moment has passed, so a
  // wrong entry is told what the timer showed.
  function checkTime(text, truth, which, solvent) {
    if (!String(text == null ? '' : text).trim()) return { ok: null, message: '' };
    var value = parseTime(text);
    if (value === null) return { ok: false, message: 'Enter the time as the timer shows it, minutes and seconds, such as 7:45.' };
    var plate = 'the ' + SOLVENTS[solvent].word + ' plate';
    if (truth === null || truth === undefined || truth < 0) {
      return { ok: null, message: which === 'in' ? 'Stand ' + plate + ' in its chamber first.' : 'Take ' + plate + ' out of its chamber first.' };
    }
    if (Math.abs(value - truth) <= TIME_TOLERANCE + 1e-6) return { ok: true, message: '' };
    return { ok: false, message: 'The timer showed ' + formatTime(truth) + ' when ' + plate + (which === 'in' ? ' went in.' : ' came out.') };
  }

  // What the bench knows about the four times, as seconds on the timer (null: not yet).
  function benchTimes(bench) {
    var out = { in: [null, null], out: [null, null] };
    if (!bench || !(bench.firstStart >= 0)) return out;
    for (var i = 0; i < 2; i++) {
      var a = bench.startedAt ? bench.startedAt[i] : -1, b = bench.removedAt ? bench.removedAt[i] : -1;
      if (a >= 0) out.in[i] = a - bench.firstStart;
      if (b >= 0) out.out[i] = b - bench.firstStart;
    }
    return out;
  }

  // ---- Colors --------------------------------------------------------------------------------------
  // The 3D lab judges the ticked colors for one lane of one plate and answers with a verdict.

  function colorMessage(verdict) {
    switch (verdict) {
      case 'ok': return { ok: true, message: '' };
      case 'miss': return { ok: false, message: 'A color that shows clearly on this lane is not ticked.' };
      case 'extra': return { ok: false, message: 'One of the ticked colors is not on this lane.' };
      case 'notyet': return { ok: null, message: 'Develop this plate first.' };
    }
    return { ok: null, message: '' };
  }

  // ---- The conclusion ----------------------------------------------------------------------------------
  // The page cannot say whether the chosen pen is the right one. It only checks that the answer
  // is complete and does not contradict itself.
  //
  // answer: { match: '' | 'none' | pen number as text, pens: { lane: { verdict: '' | 'out' | 'possible', why: text } } }

  var MIN_REASON = 15;        // characters: a few words at least

  function checkConclusion(answer, lanes) {
    var refs = referenceLanes();
    var match = answer && answer.match ? String(answer.match) : '';
    var missing = 0, possible = [], i, entry;
    for (i = 0; i < refs.length; i++) {
      entry = answer && answer.pens ? answer.pens[refs[i]] : null;
      if (!entry || !entry.verdict || String(entry.why || '').trim().length < MIN_REASON) missing++;
      if (entry && entry.verdict === 'possible') possible.push(refs[i]);
    }
    for (i = 0; i < refs.length; i++) {
      entry = answer && answer.pens ? answer.pens[refs[i]] : null;
      if (match && match !== 'none' && String(lanes[refs[i]]) === match && entry && entry.verdict === 'out') {
        return { ok: false, message: 'You chose pen ' + match + ' as the best match, but below you marked pen ' + match + ' as eliminated.' };
      }
    }
    if (match === 'none' && possible.length) {
      return { ok: false, message: 'You answered that none of the four pens matches, but below pen ' + lanes[possible[0]] + ' is marked as a possible match.' };
    }
    if (!match) return { ok: null, message: missing < refs.length ? 'Choose the pen that best matches the unknown, or "none of these four".' : '' };
    if (missing) {
      return { ok: null, message: 'For each of the four pens, describe how it compares with the unknown in both solvents and choose whether that eliminates it (' +
        missing + ' still to finish).' };
    }
    return { ok: true, message: 'Your answer is complete. Your instructor will mark whether it is the right pen.' };
  }

  // ---- Which solvent took longer -------------------------------------------------------------------------
  // Checked against the student's own accepted times: times = { in: [a, b], out: [a, b] } in
  // seconds, with null for a time not yet accepted. overrun: true when a plate stayed in after its
  // solvent had reached the top, so that its time says nothing about how fast the solvent climbs.

  function checkLonger(choice, times, overrun) {
    if (!choice) return { ok: null, message: '' };
    var have = times && times.in && times.out && times.in[0] !== null && times.in[1] !== null && times.out[0] !== null && times.out[1] !== null;
    if (!have) return { ok: null, message: 'This is checked against your own Table 1, once its four times are recorded.' };
    if (overrun) return { ok: null, message: 'A plate stayed in its chamber after the solvent had reached the top, so your times do not show how fast that solvent climbs. Answer from what you saw.' };
    var a = times.out[0] - times.in[0], b = times.out[1] - times.in[1];
    if (Math.abs(a - b) < 60) return { ok: null, message: 'By your Table 1 the two plates were in their chambers for about the same time.' };
    var longer = a > b ? 'acetone' : 'alcohol';
    if (choice === longer) return { ok: true, message: '' };
    return { ok: false, message: 'Work out from Table 1 how long each plate was in its chamber: the time it came out minus the time it went in.' };
  }

  // ---- The next thing to do on the bench ----------------------------------------------------------------------

  function dotsToGo(bench) {
    var n = 0;
    for (var i = 0; i < 2 * LANES; i++) if (i % LANES !== UNKNOWN_LANE && !(bench.spots && bench.spots[i])) n++;
    return n;
  }
  function developed(bench, plate) { return !!bench && !!bench.place && bench.place[plate] === 2; }
  function bothDeveloped(bench) { return developed(bench, 0) && developed(bench, 1); }

  // A time that the bench has (a plate went in or came out) and Table 1 does not yet: the note
  // under the bench says what the timer showed, so that nothing depends on catching it in passing.
  // recorded: { 'in-0': true, ... } for the times already accepted in Table 1.
  function timeReminder(bench, recorded) {
    var t = benchTimes(bench), which = ['in', 'out'];
    for (var w = 0; w < 2; w++) {
      for (var i = 0; i < 2; i++) {
        var truth = t[which[w]][i];
        if (truth === null || (recorded && recorded[which[w] + '-' + i])) continue;
        return 'Record in Table 1: the ' + SOLVENTS[i].word + ' plate ' + (w === 0 ? 'went in' : 'came out') + ' at ' + formatTime(truth) + ' on the timer.';
      }
    }
    return '';
  }

  // bench: the bench state the 3D lab reports. fronts: how high the solvent stands on each plate
  // now (mm), when known.
  function nextStep(bench, fronts) {
    if (!bench || !bench.place) return '';
    var dots = dotsToGo(bench), i;
    if (dots) {
      return 'Next: click a pen, then click each plate: the pen puts a small dot on the mark with its own number (' +
        dots + (dots === 1 ? ' dot' : ' dots') + ' to go).';
    }
    if (bench.cylKind >= 0) {
      var s = SOLVENTS[bench.cylKind];
      if (bench.cylWater < 1.9) return 'Next: add distilled water to the cylinder, up to the 8 mL line. Click the distilled water bottle, then the cylinder.';
      return 'Next: pour the cylinder into the chamber marked ' + s.title + '. Click the cylinder, then the chamber.';
    }
    for (i = 0; i < 2; i++) {
      if (!bench.filled[i]) {
        return 'Next: make the ' + SOLVENTS[i].word + ' solvent. Click the ' + SOLVENTS[i].liquid + ' bottle, then the graduated cylinder, to pour 6 mL.';
      }
    }
    for (i = 0; i < 2; i++) {
      if (bench.place[i] === 0) {
        return 'Next: stand the ' + SOLVENTS[i].title + ' plate in the chamber marked ' + SOLVENTS[i].title + ' (click the plate, then the chamber).';
      }
    }
    var ready = [], climbing = [];
    for (i = 0; i < 2; i++) {
      if (bench.place[i] !== 1) continue;
      if (fronts && fronts[i] >= READY_MM) ready.push(i); else climbing.push(i);
    }
    if (ready.length) {
      return 'The solvent is within 2 cm of the top of the ' + SOLVENTS[ready[0]].word + ' plate. Click the ' + SOLVENTS[ready[0]].title +
        ' chamber to take the plate out.';
    }
    if (climbing.length) {
      return 'The solvent is climbing. Take a plate out (click its chamber) when the solvent is 1 to 2 cm from the top. "Speed up the wait" makes the time pass faster.';
    }
    return 'Both plates are developed. Go on to part 2.';
  }

  return {
    LANES: LANES, UNKNOWN_LANE: UNKNOWN_LANE, PLATE_MM: PLATE_MM, READY_MM: READY_MM, OVERRUN_MM: OVERRUN_MM,
    TIME_TOLERANCE: TIME_TOLERANCE, MIN_REASON: MIN_REASON,
    SOLVENTS: SOLVENTS, BOTTLES: BOTTLES, COLORS: COLORS,
    colorText: colorText, validLanes: validLanes, laneName: laneName, referenceLanes: referenceLanes,
    codeFromNumber: codeFromNumber, normalizeCode: normalizeCode, numberFromCode: numberFromCode, isCode: isCode, randomCode: randomCode,
    parseTime: parseTime, formatTime: formatTime, checkTime: checkTime, benchTimes: benchTimes,
    colorMessage: colorMessage, checkConclusion: checkConclusion, checkLonger: checkLonger,
    dotsToGo: dotsToGo, developed: developed, bothDeveloped: bothDeveloped, timeReminder: timeReminder, nextStep: nextStep
  };
});
