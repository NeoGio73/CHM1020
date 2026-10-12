/*
 * Physical and Chemical Changes: the page's model.
 * The names of the seven tubes and what goes into each, the short lists a student picks from,
 * the wording of every message, reading a temperature off what was typed, and the next step on
 * the bench.
 *
 * It holds no answers. What a chemical looks like, what happens in a tube, how warm it gets,
 * which kinds of evidence count and how each everyday event is classed are all judged inside the
 * 3D lab, which tells the page only the verdict for each entry.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChangesLabModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- The bench, as the page names it -------------------------------------------------------
  // The same order as the 3D lab's list (Chem.Key).

  var REAGENTS = [
    { key: 'cu', name: 'copper wire', formula: 'Cu', holder: 'jar', tool: 'forceps' },
    { key: 'agno3', name: 'silver nitrate', formula: 'AgNO₃', holder: 'bottle', tool: 'dropper' },
    { key: 'naoh', name: 'sodium hydroxide', formula: 'NaOH', holder: 'bottle', tool: 'dropper' },
    { key: 'hcl', name: 'hydrochloric acid', formula: 'HCl', holder: 'bottle', tool: 'dropper' },
    { key: 'zn', name: 'zinc powder', formula: 'Zn', holder: 'jar', tool: 'spatula' },
    { key: 'na2co3', name: 'sodium carbonate', formula: 'Na₂CO₃', holder: 'bottle', tool: 'dropper' },
    { key: 'cacl2', name: 'calcium chloride', formula: 'CaCl₂', holder: 'bottle', tool: 'dropper' },
    { key: 'vinegar', name: 'vinegar', formula: '', holder: 'bottle', tool: 'dropper' },
    { key: 'oil', name: 'vegetable oil', formula: '', holder: 'bottle', tool: 'dropper' },
    { key: 'nacl', name: 'sodium chloride', formula: 'NaCl', holder: 'jar', tool: 'spatula' },
    { key: 'water', name: 'water', formula: '', holder: 'beaker', tool: 'pipet' }
  ];
  function reagentIndex(key) {
    for (var i = 0; i < REAGENTS.length; i++) if (REAGENTS[i].key === key) return i;
    return -1;
  }
  // "Cu (copper wire)", or just "vinegar"
  function reagentLabel(i) {
    var r = REAGENTS[i];
    return r.formula ? r.formula + ' (' + r.name + ')' : r.name;
  }

  // The seven tubes: the two things that go into each, in the handout's order, and how much.
  var TUBES = [
    { pair: ['cu', 'agno3'], amounts: ['a piece about 1 cm long', 'about 1 mL, one dropper'], table: 1 },
    { pair: ['naoh', 'hcl'], amounts: ['about ½ mL, half a dropper', 'about ½ mL, half a dropper'], table: 1 },
    { pair: ['zn', 'hcl'], amounts: ['a small heap on the tip of the spatula', 'about 1 mL, one dropper'], table: 1 },
    { pair: ['na2co3', 'cacl2'], amounts: ['1 or 2 drops', '2 to 4 drops'], table: 1 },
    { pair: ['vinegar', 'water'], amounts: ['about 1 mL', 'about 1 mL'], table: 2, stir: true },
    { pair: ['oil', 'water'], amounts: ['about 1 mL', 'about 1 mL'], table: 2, stir: true },
    { pair: ['nacl', 'water'], amounts: ['a pea-sized heap', 'about 1 mL'], table: 2, stir: true }
  ];
  function pairIndex(tube, slot) { return reagentIndex(TUBES[tube].pair[slot]); }
  function tubeTitle(tube) {
    return REAGENTS[pairIndex(tube, 0)].name + ' and ' + REAGENTS[pairIndex(tube, 1)].name;
  }

  // ---- The short lists ------------------------------------------------------------------------
  // The values are the words the 3D lab knows.

  var STATES = [{ value: 'solid', text: 'solid' }, { value: 'liquid', text: 'liquid' }, { value: 'gas', text: 'gas' }];
  var COLORS = [
    { value: 'colorless', text: 'colorless' }, { value: 'white', text: 'white' }, { value: 'grey', text: 'grey' },
    { value: 'yellow', text: 'yellow' }, { value: 'blue', text: 'blue' }, { value: 'brown', text: 'reddish-brown' }
  ];
  var LOOKS_BEFORE = [
    { value: 'clear', text: 'clear' }, { value: 'cloudy', text: 'cloudy' }, { value: 'shiny', text: 'shiny' },
    { value: 'powder', text: 'dull powder' }, { value: 'grains', text: 'grains or crystals' }
  ];
  var LOOKS_AFTER = [{ value: 'clear', text: 'clear' }, { value: 'cloudy', text: 'cloudy' }, { value: 'layers', text: 'two layers' }];
  var EVIDENCE = [
    { value: 'color', text: 'color change' }, { value: 'solid', text: 'a solid formed' },
    { value: 'gas', text: 'a gas formed (bubbles)' }, { value: 'temp', text: 'change in temperature' }
  ];
  var MIXTURES = [{ value: 'homogeneous', text: 'homogeneous' }, { value: 'heterogeneous', text: 'heterogeneous' }];
  var CHANGES = [{ value: 'chemical', text: 'chemical change' }, { value: 'physical', text: 'physical change' }];

  // Question 3: everyday events, in the order the 3D lab keeps them.
  var EVENTS = [
    'An apple begins to rot.',
    'A wine glass falls to the floor and shatters.',
    'An ice cube melts.',
    'A silver spoon tarnishes.',
    'A bottle of soda goes flat (loses its fizz).',
    'A cake bakes in the oven.',
    'Food is digested in your stomach.',
    'A wet towel dries.',
    'Sugar dissolves in hot coffee.'
  ];

  // ---- Temperatures -----------------------------------------------------------------------------

  // "21.8", "21.8 °C", "21,8 C" -> 21.8. Returns null when there is no sensible number.
  function parseTemp(text) {
    var s = String(text == null ? '' : text).trim().replace(',', '.');
    var m = /^(-?\d{1,3}(?:\.\d+)?)\s*(?:°|º|deg(?:rees)?)?\s*(c|celsius)?\.?$/i.exec(s);
    if (!m) return null;
    var value = parseFloat(m[1]);
    return isFinite(value) && value > -30 && value < 150 ? value : null;
  }

  // ---- What the bench has to say about a tube ------------------------------------------------------
  // bench: the state the 3D lab reports ({ a, b, stirred, maxTemp, thermo, ... } with one entry per tube).

  function has(bench, tube, slot) { return !!bench && !!bench[slot === 0 ? 'a' : 'b'] && !!bench[slot === 0 ? 'a' : 'b'][tube]; }
  function mixed(bench, tube) { return has(bench, tube, 0) && has(bench, tube, 1); }
  function stirred(bench, tube) { return !!bench && !!bench.stirred && !!bench.stirred[tube]; }
  function read(bench, tube) { return !!bench && !!bench.maxTemp && bench.maxTemp[tube] > 0; }

  // Why a tube cannot be described yet, in words; '' when it can.
  function notYet(bench, seen, tube) {
    var n = tube + 1;
    if (!mixed(bench, tube)) return 'Put both into tube ' + n + ' first.';
    if (TUBES[tube].stir && !stirred(bench, tube)) return 'Stir tube ' + n + ' first.';
    if (seen && !seen[tube]) return 'Tube ' + n + ' changes slowly. Give it a few more minutes, or speed up the wait.';
    return '';
  }

  // ---- Messages -----------------------------------------------------------------------------------
  // Results are { ok, message }, where ok is true, false, or null (nothing to say yet).

  var PART_HINT = {
    state: 'Look again: is it a solid, a liquid or a gas?',
    color: 'Look again at its color. A liquid you can see straight through, with no color of its own, is colorless.',
    look: 'Look again at how it looks, not at its color.',
    states: 'Tick everything that is in the tube now, and nothing that is not: a solid, a liquid, bubbles of gas.'
  };

  // kind: 'before' | 'after' | 'temp' | 'evidence' | 'mixture' | 'event'; part: for before and after, which short answer.
  function message(kind, verdict, part, why) {
    if (verdict === 'ok') return { ok: true, message: '' };
    if (verdict === 'notyet') return { ok: null, message: why || 'The bench has not got that far yet.' };
    if (!verdict) return { ok: null, message: '' };
    switch (kind) {
      case 'before':
      case 'after':
        return { ok: false, message: PART_HINT[part] || 'Look again.' };
      case 'temp':
        return { ok: false, message: part === 'before' ? 'Read the thermometer before anything is mixed: everything on the bench starts at the same temperature.' :
          'That is not the highest the thermometer showed in this tube.' };
      case 'evidence':
        if (verdict === 'miss') return { ok: false, message: 'There was another kind of evidence in this tube. Look at your observations again.' };
        if (verdict === 'extra') return { ok: false, message: 'One of the kinds you ticked did not happen in this tube.' };
        return { ok: false, message: 'Look at your observations for this tube again.' };
      case 'mixture':
        return { ok: false, message: 'Look at the tube again: is it the same all the way through, or can you see separate parts?' };
      case 'event':
        return { ok: false, message: 'Ask yourself: is a new substance formed, or is it the same substance in a different form or place?' };
    }
    return { ok: false, message: 'Look again.' };
  }

  // ---- The next thing to do on the bench --------------------------------------------------------------

  function holderOf(i) { return 'the ' + (REAGENTS[i].formula || REAGENTS[i].name) + ' ' + REAGENTS[i].holder; }

  function nextStep(bench, seen) {
    if (!bench || !bench.a) return '';
    for (var t = 0; t < TUBES.length; t++) {
      var n = t + 1, a = pairIndex(t, 0), b = pairIndex(t, 1);
      if (!has(bench, t, 0)) return 'Next, tube ' + n + ': add ' + REAGENTS[a].name + ' (' + TUBES[t].amounts[0] + '). Click ' + holderOf(a) + ', then tube ' + n + '.';
      if (!has(bench, t, 1)) {
        // where it warms up at once, the thermometer has to be watching as the second thing goes in
        if ((t === 1 || t === 2) && bench.thermo !== t) return 'Next: stand the thermometer in tube ' + n + ', so that you can watch it as the ' + REAGENTS[b].name + ' goes in.';
        return 'Next, tube ' + n + ': add ' + REAGENTS[b].name + ' (' + TUBES[t].amounts[1] + '). Click ' + holderOf(b) + ', then tube ' + n + '.';
      }
      if (TUBES[t].stir && !stirred(bench, t)) return 'Next: stir tube ' + n + ' with the stirring rod. Click the rod, then tube ' + n + '.';
      if (TUBES[t].table === 1 && !read(bench, t)) return 'Next: stand the thermometer in tube ' + n + ' and watch it for a few seconds.';
    }
    if (seen && !seen[0]) return 'All seven tubes are mixed. Tube 1 changes slowly: look at it again in a few minutes, or speed up the wait. Click a tube for a close look.';
    return 'All seven tubes are done. Click a tube for a close look, and fill in Tables 1 and 2.';
  }

  return {
    REAGENTS: REAGENTS, TUBES: TUBES, STATES: STATES, COLORS: COLORS, LOOKS_BEFORE: LOOKS_BEFORE, LOOKS_AFTER: LOOKS_AFTER,
    EVIDENCE: EVIDENCE, MIXTURES: MIXTURES, CHANGES: CHANGES, EVENTS: EVENTS,
    reagentIndex: reagentIndex, reagentLabel: reagentLabel, pairIndex: pairIndex, tubeTitle: tubeTitle,
    parseTemp: parseTemp, has: has, mixed: mixed, stirred: stirred, read: read, notYet: notYet, message: message, nextStep: nextStep
  };
});
