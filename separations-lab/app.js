/*
 * Who Wrote the Ransom Note? (paper chromatography of black inks): page logic.
 * Keeps what the student records, checks what can be checked from the student's own entries, and
 * talks to the 3D lab (a Unity build in the canvas: a fume hood with two plates, four pens, two
 * chambers, the solvents and a timer inside it).
 *
 * The page does not know which pen the unknown is, or what colors any ink separates into. The 3D
 * lab works those out from the unknown's code. It tells the page the numbers on the four pens and
 * what has been done on the bench, and it judges the colors ticked for each lane. Which pen wrote
 * the note is never checked here: the instructor marks that from the answer key.
 */
(function () {
  'use strict';

  var M = window.InkLabModel;
  var STORE_KEY = 'separations-lab:v1';
  var PICTURE_KEY = STORE_KEY + ':picture';
  var params = new URLSearchParams(window.location.search);
  // Automated tests of the page run it without the 3D lab, against a stand-in they supply.
  var standIn = typeof window.InkLabStandIn === 'function' ? window.InkLabStandIn : null;
  var REFS = M.referenceLanes();
  var TIME_FIELDS = ['in-0', 'in-1', 'out-0', 'out-1'];

  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (text != null) node.textContent = text;
    return node;
  }
  function cellKey(lane, plate) { return lane + '-' + plate; }
  function eachCell(fn) {
    for (var lane = 0; lane < M.LANES; lane++) for (var plate = 0; plate < 2; plate++) fn(lane, plate);
  }
  function solvent(i) { return M.SOLVENTS[i]; }

  // ---- Saved work ----------------------------------------------------------------------------

  function blankAnswer() {
    var pens = {};
    REFS.forEach(function (lane) { pens[lane] = { verdict: '', why: '' }; });
    return { match: '', pens: pens };
  }

  function blankState(code) {
    return {
      v: 1,
      code: code || M.randomCode(),
      name: '',
      lanes: null,          // the pen number on each lane (0 for the unknown), once the 3D lab has said
      bench: null,          // the bench as the 3D lab last reported it; null for a bench not yet touched
      lab: -1,              // the bench clock at the last word from the 3D lab
      times: { 'in-0': '', 'in-1': '', 'out-0': '', 'out-1': '' },
      colors: {},           // "lane-plate" -> { ticks: [color words], checked: true once Check was pressed }
      answer: blankAnswer(),
      longer: '',
      improve: '',
      flags: { times: 0, colors: 0, answers: 0 }
    };
  }

  function loadState() {
    try {
      var saved = JSON.parse(window.localStorage.getItem(STORE_KEY));
      if (!saved || saved.v !== 1 || !M.isCode(saved.code)) return null;
      var fresh = blankState(saved.code);
      if (!M.validLanes(saved.lanes)) saved.lanes = null;
      if (!saved.bench || !Array.isArray(saved.bench.spots) || saved.bench.code !== saved.code) saved.bench = null;
      if (typeof saved.lab !== 'number') saved.lab = -1;
      saved.times = Object.assign(fresh.times, saved.times || {});
      if (!saved.colors || typeof saved.colors !== 'object') saved.colors = {};
      if (!saved.answer || typeof saved.answer !== 'object' || !saved.answer.pens) saved.answer = fresh.answer;
      REFS.forEach(function (lane) { if (!saved.answer.pens[lane]) saved.answer.pens[lane] = { verdict: '', why: '' }; });
      saved.flags = Object.assign(fresh.flags, saved.flags || {});
      ['name', 'longer', 'improve'].forEach(function (k) { if (typeof saved[k] !== 'string') saved[k] = ''; });
      return saved;
    } catch (e) {
      return null;
    }
  }

  function saveState() {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* private window: work simply is not kept */ }
  }

  var state = loadState();
  // An instructor can hand out a link that ends in ?code=..., so that a student gets that unknown.
  var requested = M.normalizeCode(params.get('code') || '');
  if (requested && M.isCode(requested) && (!state || state.code !== requested)) state = blankState(requested);
  if (!state) state = blankState();

  var lastFlagged = {};      // field -> last value that was flagged, so the same slip is not counted twice
  var results = { times: {}, colors: {}, answer: { ok: null }, longer: { ok: null } };

  function countFlag(group, field, value, result) {
    if (result.ok !== false) return;
    if (lastFlagged[field] === value) return;
    lastFlagged[field] = value;
    state.flags[group] += 1;
  }

  function setState(node, result) {
    var name = result.ok === true ? 'ok' : (result.ok === false ? 'bad' : '');
    if (name) node.setAttribute('data-state', name); else node.removeAttribute('data-state');
  }

  function showMessage(msg, result) {
    msg.textContent = result.message || '';
    if (result.ok !== false) msg.setAttribute('data-kind', 'tip'); else msg.removeAttribute('data-kind');
  }

  function lanes() { return state.lanes || [null, null, 0, null, null]; }
  function laneName(lane) {
    if (lane === M.UNKNOWN_LANE) return 'Unknown';
    return state.lanes ? 'Pen ' + state.lanes[lane] : 'Pen';
  }
  function penWord(lane) { return state.lanes ? 'pen ' + state.lanes[lane] : 'this pen'; }

  // ---- Table 1: the four times ----------------------------------------------------------------

  var timeFocus = '';        // the time whose message is showing under the table

  function timeTruth(field) {
    var t = M.benchTimes(state.bench), parts = field.split('-');
    return t[parts[0]][+parts[1]];
  }

  function checkTimes(changed) {
    TIME_FIELDS.forEach(function (field) {
      var parts = field.split('-');
      var result = M.checkTime(state.times[field], timeTruth(field), parts[0], +parts[1]);
      results.times[field] = result;
      setState($('time-' + field), result);
      if (changed === field && M.parseTime(state.times[field]) !== null) countFlag('times', field, state.times[field], result);
    });
    showTimeMessage();
    saveState();
    checkLonger();
    updateNote();
  }

  function showTimeMessage() {
    var msg = $('time-msg');
    var field = timeFocus;
    if (!field || !results.times[field] || !results.times[field].message) {
      // otherwise the first one that needs attention
      field = TIME_FIELDS.filter(function (f) { return results.times[f] && results.times[f].ok === false; })[0] || '';
    }
    showMessage(msg, field ? results.times[field] : { ok: null, message: '' });
  }

  // The four times as the student recorded them, in seconds, with null for one not yet accepted.
  function acceptedTimes() {
    var out = { in: [null, null], out: [null, null] };
    TIME_FIELDS.forEach(function (field) {
      var parts = field.split('-');
      if (results.times[field] && results.times[field].ok === true) out[parts[0]][+parts[1]] = M.parseTime(state.times[field]);
    });
    return out;
  }
  function timesAccepted() {
    return TIME_FIELDS.filter(function (f) { return results.times[f] && results.times[f].ok === true; }).length;
  }

  function bindTimes() {
    TIME_FIELDS.forEach(function (field) {
      var input = $('time-' + field);
      input.value = state.times[field];
      input.addEventListener('input', function () {
        state.times[field] = input.value;
        input.removeAttribute('data-state');
        saveState();
      });
      input.addEventListener('change', function () { timeFocus = field; checkTimes(field); });
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { timeFocus = field; checkTimes(field); } });
      input.addEventListener('focus', function () { timeFocus = field; showTimeMessage(); });
    });
  }

  // ---- Table 2: the colors ----------------------------------------------------------------------

  // Each cell goes to the 3D lab when Check is pressed, and the lab answers with a verdict. A
  // verdict belongs to the exact set of ticks it was given for, and to whether the plate was
  // developed at the time: change either and the cell is unjudged again.
  var verdicts = {};      // "lane-plate" -> { context, verdict }
  var asked = {};         // request number -> { "lane-plate": context }
  var nextAsk = 1;
  var toCount = {};       // cells the student just had checked: count a flag once their result is in

  function entryOf(lane, plate) {
    var k = cellKey(lane, plate);
    if (!state.colors[k] || !Array.isArray(state.colors[k].ticks)) state.colors[k] = { ticks: [], checked: false };
    return state.colors[k];
  }
  function ticksText(entry) {
    // always in the order of the list, so the same choice reads the same
    return M.COLORS.map(function (c) { return c.value; }).filter(function (v) { return entry.ticks.indexOf(v) >= 0; }).join(',');
  }
  function contextOf(lane, plate) {
    return ticksText(entryOf(lane, plate)) + '|' + (M.developed(state.bench, plate) ? 1 : 0);
  }

  function buildColorRows() {
    var body = $('color-rows');
    body.textContent = '';
    for (var lane = 0; lane < M.LANES; lane++) {
      var tr = el('tr');
      if (lane === M.UNKNOWN_LANE) tr.className = 'unknown-row';
      tr.appendChild(el('th', { scope: 'row' }, laneName(lane)));
      for (var plate = 0; plate < 2; plate++) tr.appendChild(colorCell(lane, plate));
      body.appendChild(tr);
    }
  }

  function colorCell(lane, plate) {
    var k = cellKey(lane, plate), entry = entryOf(lane, plate);
    var td = el('td', { id: 'cell-' + k, 'data-col': solvent(plate).title });
    var group = el('div', { 'class': 'chips', role: 'group', 'aria-label': 'Colors of ' + laneName(lane) + ' in the ' + solvent(plate).system.toLowerCase() });
    M.COLORS.forEach(function (color) {
      var label = el('label', { 'class': 'chip' });
      var input = el('input', { type: 'checkbox', id: 'tick-' + k + '-' + color.value, value: color.value });
      input.checked = entry.ticks.indexOf(color.value) >= 0;
      input.addEventListener('change', function () {
        var e = entryOf(lane, plate), at = e.ticks.indexOf(color.value);
        if (input.checked && at < 0) e.ticks.push(color.value);
        if (!input.checked && at >= 0) e.ticks.splice(at, 1);
        e.checked = false;          // a changed cell is unjudged until Check is pressed again
        saveState();
        showColors();
      });
      var face = el('span');
      var dot = el('i', { 'class': 'swatch', 'aria-hidden': 'true' });
      dot.style.background = color.swatch;
      face.appendChild(dot);
      face.appendChild(document.createTextNode(color.text));
      label.appendChild(input);
      label.appendChild(face);
      group.appendChild(label);
    });
    td.appendChild(group);
    td.appendChild(el('p', { 'class': 'msg', id: 'msg-color-' + k, role: 'status' }));
    return td;
  }

  function colorResult(lane, plate) {
    var entry = entryOf(lane, plate);
    if (!entry.ticks.length || !entry.checked) return { ok: null, message: '' };
    var known = verdicts[cellKey(lane, plate)];
    if (!known || known.context !== contextOf(lane, plate)) return { ok: null, message: '', waiting: true };
    return M.colorMessage(known.verdict);
  }

  function showColors() {
    eachCell(function (lane, plate) {
      var k = cellKey(lane, plate);
      var result = colorResult(lane, plate);
      results.colors[k] = result;
      setState($('cell-' + k), result);
      showMessage($('msg-color-' + k), result);
      if (toCount[k] && !result.waiting) {
        delete toCount[k];
        countFlag('colors', k, ticksText(entryOf(lane, plate)), result);
      }
    });
    saveState();
    var done = colorsAccepted(), all = 2 * M.LANES;
    $('color-status').textContent = done === all ? 'All ' + all + ' lanes are recorded.' : (done > 0 ? done + ' of ' + all + ' lanes recorded.' : '');
    updateReportStatus();
  }

  function colorsAccepted() {
    var n = 0;
    eachCell(function (lane, plate) { var r = results.colors[cellKey(lane, plate)]; if (r && r.ok === true) n++; });
    return n;
  }

  // byStudent: Check was pressed, so every cell with ticks in it is to be judged.
  function askColors(byStudent) {
    var id = nextAsk++, sent = {}, items = [];
    eachCell(function (lane, plate) {
      var k = cellKey(lane, plate), entry = entryOf(lane, plate);
      if (!entry.ticks.length) return;
      if (byStudent) { entry.checked = true; toCount[k] = true; }
      if (!entry.checked) return;
      items.push({ field: k, kind: 'colors', a: lane, b: plate, text: ticksText(entry) });
      sent[k] = contextOf(lane, plate);
    });
    showColors();
    if (!items.length || !benchReady) return;
    asked[id] = sent;
    sendBench('Check', JSON.stringify({ id: id, items: items }));
  }

  function takeVerdicts(e) {
    var sent = asked[e.id];
    delete asked[e.id];
    if (!sent || e.code !== state.code) return;
    (e.rows || []).forEach(function (row) {
      if (row.verdict && sent[row.field] !== undefined) verdicts[row.field] = { context: sent[row.field], verdict: row.verdict };
    });
    showColors();
  }

  // ---- The picture of the plates ------------------------------------------------------------------
  // The 3D lab photographs the two plates on the towel. It stands in for stapling the strips to
  // the report. It is kept beside the saved work so that it is there to print after a reload.

  function showPicture(picture) {
    var img = $('strips-img'), has = !!(picture && picture.image && picture.code === state.code && (picture.developed || []).some(Boolean));
    img.hidden = !has;
    $('strips-empty').hidden = has;
    $('strips-caption').hidden = !has;
    if (!has) { img.removeAttribute('src'); return; }
    img.src = picture.image;
    var both = picture.developed[0] && picture.developed[1];
    img.alt = 'Photograph of your two plates from above, acetone on the left and alcohol on the right.';
    $('strips-caption').textContent = 'Your plates, unknown ' + state.code + ': acetone on the left, alcohol on the right. ' +
      'The ink from the note is on the middle lane, U.' + (both ? '' : ' One plate is still to be developed.');
  }
  function loadPicture() {
    try { return JSON.parse(window.localStorage.getItem(PICTURE_KEY)); } catch (e) { return null; }
  }
  function keepPicture(picture) {
    try {
      if (picture) window.localStorage.setItem(PICTURE_KEY, JSON.stringify(picture)); else window.localStorage.removeItem(PICTURE_KEY);
    } catch (e) { /* no room, or a private window: the picture is taken again next time */ }
    showPicture(picture);
  }
  function askPicture() {
    if (benchReady && (M.developed(state.bench, 0) || M.developed(state.bench, 1))) sendBench('Snapshot', '');
  }

  // ---- Part 3: which pen ---------------------------------------------------------------------------

  function buildAnswer() {
    var select = $('match');
    select.textContent = '';
    select.appendChild(el('option', { value: '' }, '–'));
    REFS.forEach(function (lane) {
      if (state.lanes) select.appendChild(el('option', { value: String(state.lanes[lane]) }, 'Pen ' + state.lanes[lane]));
    });
    select.appendChild(el('option', { value: 'none' }, 'None of these four pens'));
    select.value = state.answer.match;
    if (select.value !== state.answer.match) { state.answer.match = ''; select.value = ''; }

    var list = $('pen-list');
    list.textContent = '';
    REFS.forEach(function (lane) {
      var entry = state.answer.pens[lane];
      var item = el('li', { 'class': 'pen-item', id: 'pen-' + lane });
      item.appendChild(el('p', { 'class': 'pen-name' }, laneName(lane) + ' and the unknown'));
      var why = el('label', { 'class': 'field pen-why' });
      why.appendChild(el('span', { 'class': 'field-name' }, 'How they compare in acetone and in alcohol: what is alike, and what is different'));
      var box = el('textarea', { id: 'why-' + lane, rows: '3' });
      box.value = entry.why;
      box.addEventListener('input', function () { entry.why = box.value; syncPrintCopy(box); saveState(); checkAnswer(); });
      why.appendChild(box);
      why.appendChild(el('div', { 'class': 'print-copy' }, entry.why));
      item.appendChild(why);
      var verdict = el('label', { 'class': 'field pen-verdict' });
      verdict.appendChild(el('span', { 'class': 'field-name' }, 'So ' + penWord(lane) + ' is'));
      var pick = el('select', { id: 'verdict-' + lane });
      [['', '–'], ['out', 'eliminated'], ['possible', 'a possible match']].forEach(function (o) { pick.appendChild(el('option', { value: o[0] }, o[1])); });
      pick.value = entry.verdict;
      pick.addEventListener('change', function () { entry.verdict = pick.value; saveState(); checkAnswer(true); });
      verdict.appendChild(pick);
      item.appendChild(verdict);
      list.appendChild(item);
    });
  }

  function syncPrintCopy(textarea) {
    var copy = textarea.nextSibling;
    if (copy && copy.className === 'print-copy') copy.textContent = textarea.value;
  }

  function checkAnswer(byStudent) {
    var result = M.checkConclusion(state.answer, lanes());
    results.answer = result;
    var block = $('answer-block');
    if (result.ok === false) block.setAttribute('data-state', 'bad'); else block.removeAttribute('data-state');
    showMessage($('msg-answer'), result);
    if (byStudent) {
      countFlag('answers', 'conclusion', state.answer.match + '|' + REFS.map(function (lane) { return state.answer.pens[lane].verdict; }).join(','), result);
    }
    saveState();
    updateReportStatus();
  }

  // ---- Part 4 ------------------------------------------------------------------------------------------

  function overran() {
    var b = state.bench;
    return !!b && [0, 1].some(function (i) { return M.developed(b, i) && b.front && b.front[i] >= M.OVERRUN_MM; });
  }

  function checkLonger(byStudent) {
    var result = M.checkLonger(state.longer, acceptedTimes(), overran());
    results.longer = result;
    setState($('longer'), result);
    showMessage($('msg-longer'), result);
    if (byStudent) countFlag('answers', 'longer', state.longer, result);
    saveState();
    updateReportStatus();
  }

  function bindQuestions() {
    $('match').addEventListener('change', function () { state.answer.match = $('match').value; saveState(); checkAnswer(true); });
    $('longer').addEventListener('change', function () { state.longer = $('longer').value; checkLonger(true); });
    var improve = $('improve');
    improve.parentNode.insertBefore(el('div', { 'class': 'print-copy' }), improve.nextSibling);
    improve.addEventListener('input', function () { state.improve = improve.value; syncPrintCopy(improve); saveState(); updateReportStatus(); });
    $('check-colors').addEventListener('click', function () { askColors(true); });
  }

  // ---- Report ------------------------------------------------------------------------------------

  function updateReportStatus() {
    if (!$('report-status')) return;
    var times = timesAccepted(), colors = colorsAccepted(), cells = 2 * M.LANES;
    var answered = results.answer.ok === true;
    var longer = !!state.longer && results.longer.ok !== false, improve = state.improve.trim().length >= M.MIN_REASON;
    var text;
    if (!M.bothDeveloped(state.bench)) text = 'Still to do: develop both plates in part 1.';
    else if (times < 4) text = 'Still to do: ' + (4 - times) + ' of the 4 times in Table 1.';
    else if (colors < cells) text = 'Still to do: ' + (cells - colors) + ' of the ' + cells + ' lanes of Table 2 in part 2. Tick the colors, then press Check my colors.';
    else if (!answered) text = 'Still to do: your answer in part 3, with the comparison for each of the four pens.';
    else if (!longer || !improve) text = 'Still to do: ' + (!longer && !improve ? 'the two questions' : 'one of the two questions') + ' in part 4.';
    else text = 'Everything is filled in. Add your name, then print or save the report as a PDF.';
    $('report-status').textContent = text;

    $('print-name').textContent = 'Name: ' + (state.name || '________________');
    $('print-date').textContent = 'Printed ' + new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    $('print-checks').textContent = 'Checked by the lab page for unknown ' + state.code + ': ' + times + ' of 4 times accepted (' + state.flags.times +
      ' flagged before correction); ' + colors + ' of ' + cells + ' lanes of colors accepted (' + state.flags.colors + ' flagged before correction); ' +
      'answers in parts 3 and 4 flagged ' + state.flags.answers + (state.flags.answers === 1 ? ' time' : ' times') +
      ' for not agreeing with the student\'s own entries. The page does not check which pen was chosen: mark that from the answer key.';
  }

  // ---- The 3D bench ----------------------------------------------------------------------------

  var unity = null;
  var unityAwake = false;
  var benchReady = false;     // the 3D lab has set out the bench and can check entries
  var persistentNote = { text: '', kind: '' };
  var fronts = [0, 0];        // how high the solvent stands on each plate (mm), from the lab's last tick
  var clock = { seconds: 0, started: false, fast: false, developing: [false, false] };
  var lastSaved = 0;

  function sendBench(method, value) {
    if (!unity) return;
    try { unity.SendMessage('Lab', method, value == null ? '' : String(value)); } catch (e) { console.error(e); }
  }

  // A fresh lab opens on the whole fume hood and then moves in to the bench. Someone coming back
  // to work already under way starts at the bench, and ?intro=0 always does. Visitors who ask
  // their system for reduced motion get straight cuts between views and no opening move.
  var calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function workUnderWay() {
    var b = state.bench;
    return !!b && (M.dotsToGo(b) < 2 * (M.LANES - 1) || b.cylKind >= 0 || b.filled.some(Boolean) || b.place.some(Boolean));
  }

  function configureBench() {
    if (!unity || !unityAwake) return;
    benchReady = false;
    sendBench('Configure', JSON.stringify({
      code: state.code,
      hasState: workUnderWay(),
      state: state.bench || {},
      lab: state.lab,
      intro: params.get('intro') !== '0' && !calm && !workUnderWay(),
      calm: calm
    }));
  }

  // A step or warning note stays up for a few seconds before labels for whatever the pointer is
  // over take its place: the pointer is usually still over the thing it was just used on, and a
  // warning must be readable.
  var holdNoteUntil = 0;
  var pendingHover = null;
  var hoverTimer = null;

  function note(text, kind, temporary) {
    if (!temporary) {
      persistentNote = { text: text, kind: kind || '' };
      holdNoteUntil = Date.now() + (kind === 'warn' ? 4000 : 2200);
      pendingHover = null;
      lastStep = nextStep();
    }
    var node = $('stage-note');
    node.textContent = text;
    if (kind) node.setAttribute('data-kind', kind); else node.removeAttribute('data-kind');
  }

  // text: a label for what the pointer is over, or null when it is over nothing.
  function hoverNote(text) {
    clearTimeout(hoverTimer);
    var wait = holdNoteUntil - Date.now();
    if (wait > 0) {
      pendingHover = text;
      if (text !== null) hoverTimer = setTimeout(function () {
        if (pendingHover !== null) { var t = pendingHover; pendingHover = null; note(t, '', true); }
      }, wait);
      return;
    }
    pendingHover = null;
    if (text === null) note(persistentNote.text, persistentNote.kind, true);
    else note(text, '', true);
  }

  // What to do next: a time that is waiting to be written into Table 1, then the next thing on the bench.
  function nextStep() {
    var b = state.bench || { spots: [], cylKind: -1, cylWater: 0, filled: [0, 0], place: [0, 0] };
    var recorded = {};
    TIME_FIELDS.forEach(function (f) { recorded[f] = !!results.times[f] && results.times[f].ok === true; });
    var remind = M.timeReminder(b, recorded), step = M.nextStep(b, fronts);
    if (remind && M.bothDeveloped(b)) step = 'Both plates are developed.';
    return remind ? remind + ' ' + step : step;
  }

  // The standing note follows the bench as work goes on. When the next step changes, its new
  // wording replaces the note on show at once; a warning or a label on show stays until it is done.
  var lastStep = '';
  function updateNote() {
    if (!benchReady) return;
    var text = nextStep();
    if (text === lastStep) return;
    lastStep = text;
    var onShow = persistentNote.kind !== 'warn' && $('stage-note').textContent === persistentNote.text;
    persistentNote = { text: text, kind: '' };
    if (onShow) note(text, '', true);
  }

  function setView(view) {
    Array.prototype.forEach.call(document.querySelectorAll('.view-button'), function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-view') === view ? 'true' : 'false');
    });
  }

  function cm(mm) { return (Math.max(0, mm) / 10).toFixed(1) + ' cm'; }

  // The line under the bench: the timer, and where the solvent has got to on each plate.
  function showRun() {
    var b = state.bench, parts = [];
    if (clock.started) parts.push('Timer ' + M.formatTime(clock.seconds));
    for (var i = 0; i < 2; i++) {
      if (!b || !b.place) continue;
      if (b.place[i] === 1) parts.push(solvent(i).title + ' plate: solvent ' + cm(M.PLATE_MM - fronts[i]) + ' from the top');
      else if (b.place[i] === 2) parts.push(solvent(i).title + ' plate: out and dry');
    }
    $('run-status').textContent = parts.join('  ·  ');

    var waiting = !!b && !!b.place && [0, 1].some(function (i) { return b.place[i] === 1 && fronts[i] < M.READY_MM; });
    var button = $('speed-up');
    button.disabled = !waiting;
    button.setAttribute('aria-pressed', clock.fast ? 'true' : 'false');
    button.textContent = clock.fast ? 'Back to real time' : 'Speed up the wait';
  }

  function takeBench(bench) {
    if (!bench || !Array.isArray(bench.spots)) return;
    state.bench = bench;
    state.lab = bench.lab;
  }

  function hoverText(e) {
    var s = e.n >= 0 && e.n < 2 ? solvent(e.n) : null;
    switch (e.item) {
      case 'pen':
        return 'Pen ' + e.n + '. Click to pick it up, then click each plate.';
      case 'bottle':
        return 'A bottle of ' + M.BOTTLES[e.n] + '. Click to pick it up, then click the graduated cylinder to pour.';
      case 'cylinder':
        if (e.kind < 0) return 'Graduated cylinder, 10 mL, empty.';
        if (e.ml < 8) return 'Graduated cylinder: ' + e.ml + ' mL of ' + solvent(e.kind).liquid + '. Add distilled water up to the 8 mL line.';
        return 'Graduated cylinder: 8 mL of ' + solvent(e.kind).liquid + ' and water. Click to pick it up, then click the chamber marked ' + solvent(e.kind).title + '.';
      case 'plate':
        if (e.place === 2) return 'The ' + s.title + ' plate, developed and dry.';
        if (e.need > 0) return 'The ' + s.title + ' plate. It still needs ' + e.need + (e.need === 1 ? ' dot.' : ' dots.');
        return 'The ' + s.title + ' plate, with all its dots on. Click to pick it up, then click the chamber marked ' + s.title + '.';
      case 'chamber':
        // (how far the solvent has got is on the line under the bench, which keeps up with it)
        if (e.plate) {
          return 'The ' + s.title + ' chamber. ' + (Math.max(e.front, fronts[e.n]) >= M.READY_MM ?
            'The solvent is within 2 cm of the top of its plate: click to take the plate out.' : 'Its plate is still developing.');
        }
        return 'The ' + s.title + ' chamber' + (e.filled ? ', with its solvent in.' : '. It has no solvent in it yet.');
      case 'timer':
        return 'Timer: minutes and seconds since the first plate went into its chamber.';
    }
    return null;
  }

  function holdingText(e) {
    switch (e.item) {
      case 'pen':
        return 'Holding pen ' + e.n + '. Tap or click a plate to put a dot on its mark numbered ' + e.n + ', or anywhere else to put the pen back.';
      case 'bottle':
        return 'Holding the ' + M.BOTTLES[e.n] + '. Tap or click the graduated cylinder to pour, or anywhere else to put the bottle back.';
      case 'cylinder':
        return 'Holding the graduated cylinder. Tap or click the chamber its mixture is for, or anywhere else to put it back.';
      case 'plate':
        return 'Holding the ' + solvent(e.n).title + ' plate. Tap or click the chamber marked ' + solvent(e.n).title + ' to stand it in, or anywhere else to put it back.';
    }
    return '';
  }

  function blockedText(e) {
    switch (e.reason) {
      case 'plate-run':
        return e.pen > 0 ? 'This plate has already been in its solvent. The dots go on before a plate is developed.' : 'This plate has already been developed.';
      case 'unknown-lane':
        return 'The mark U is for the ink from the ransom note, which is already there. Pen ' + e.pen + ' goes on the mark numbered ' + e.pen + '.';
      case 'wrong-lane':
        return 'That mark is for pen ' + e.number + '. Pen ' + e.pen + ' goes on the mark numbered ' + e.pen + '.';
      case 'already-spotted':
        return 'Pen ' + e.pen + ' already has its dot on this plate. One small dot is enough.';
      case 'water-first':
        return 'Pour the acetone or the isopropyl alcohol first, up to the 6 mL line. The water goes in after it.';
      case 'has-water':
        return 'The cylinder is already at the 8 mL line. Pour it into the chamber marked ' + solvent(e.solvent).title + '.';
      case 'cylinder-in-use':
        return 'The cylinder still holds the ' + solvent(e.solvent).word + ' mixture. Finish that one and pour it into its chamber first.';
      case 'already-made':
        return 'The ' + solvent(e.solvent).title + ' chamber already has its solvent.';
      case 'cylinder-empty':
        return 'The cylinder is empty. Make up a solvent in it first.';
      case 'needs-water':
        return 'Add distilled water to the cylinder, up to the 8 mL line, before you pour it into the chamber.';
      case 'wrong-chamber':
        return 'The cylinder holds the ' + solvent(e.solvent).word + ' mixture. It goes in the chamber marked ' + solvent(e.solvent).title + '.';
      case 'wrong-chamber-plate':
        return 'This plate is marked ' + solvent(e.solvent).title + '. It goes in the chamber marked ' + solvent(e.solvent).title + '.';
      case 'not-spotted':
        return 'Put a dot from each of the four pens on this plate before it goes into its chamber.';
      case 'no-solvent':
        return 'The ' + solvent(e.solvent).title + ' chamber has no solvent in it yet.';
      case 'not-ready':
        return 'Not yet: the solvent is still ' + cm(e.togo) + ' from the top of the plate. Take the plate out when it is 1 to 2 cm from the top.';
    }
    return '';
  }

  function onBenchEvent(json) {
    var e;
    try { e = JSON.parse(json); } catch (err) { return; }
    switch (e.type) {
      case 'ready':
        unityAwake = true;
        configureBench();
        break;
      case 'configured':
        $('stage-cover').hidden = true;
        if (e.code !== state.code) break;       // an answer to an earlier unknown
        takeBench(e.state);
        if (M.validLanes(e.lanes) && JSON.stringify(e.lanes) !== JSON.stringify(state.lanes)) {
          state.lanes = e.lanes;
          buildColorRows();
          buildAnswer();
        }
        benchReady = true;
        saveState();
        checkTimes();
        note(nextStep());
        askColors(false);
        checkAnswer();
        askPicture();
        showRun();
        break;
      case 'state':
        takeBench(e.state);
        saveState();
        checkTimes();
        askColors(false);       // a plate that has just been developed can now have its colors judged
        showRun();
        break;
      case 'tick':
        fronts = e.fronts || fronts;
        clock = { seconds: e.seconds, started: !!e.started, fast: !!e.fast, developing: e.developing || [false, false] };
        state.lab = e.lab;
        if (state.bench) state.bench.lab = e.lab;
        // the clock runs on while the page is open: keep where it has got to, every couple of seconds
        if (Date.now() - lastSaved > 2000) { lastSaved = Date.now(); saveState(); }
        showRun();
        updateNote();
        break;
      case 'checked':
        takeVerdicts(e);
        break;
      case 'strips':
        if (e.code === state.code) keepPicture({ code: e.code, developed: e.developed, image: e.image });
        break;
      case 'hover':
        hoverNote(hoverText(e));
        break;
      case 'holding':
        clearTimeout(hoverTimer);
        pendingHover = null;
        note(holdingText(e), '', true);
        break;
      case 'returned':
        note(persistentNote.text, persistentNote.kind, true);
        break;
      case 'spotted':
      case 'poured':
      case 'filled':
      case 'standing':
        note(nextStep());
        break;
      case 'plateready':
        fronts[e.plate] = Math.max(fronts[e.plate], M.READY_MM);
        note(nextStep());
        showRun();
        break;
      case 'out':
        note((e.front >= M.OVERRUN_MM ? 'The solvent had already reached the top of this plate: in a real lab, take a plate out sooner. ' : '') + nextStep());
        askPicture();
        break;
      case 'blocked':
        note(blockedText(e), 'warn');
        break;
      case 'reset':
        takeBench(e.state);
        TIME_FIELDS.forEach(function (f) { state.times[f] = ''; $('time-' + f).value = ''; });
        verdicts = {};
        fronts = [0, 0];
        timeFocus = '';
        keepPicture(null);
        checkTimes();
        askColors(false);
        note('The bench is set out again with fresh plates. ' + nextStep());
        showRun();
        break;
      case 'view':        // the camera has set off for this view
      case 'arrived':     // and has got there
        setView(e.view);
        lab.view = e.view;
        break;
    }
  }

  function bindBenchControls() {
    Array.prototype.forEach.call(document.querySelectorAll('.view-button'), function (button) {
      button.addEventListener('click', function () { sendBench('SetView', button.getAttribute('data-view')); });
    });
    $('speed-up').addEventListener('click', function () { sendBench('SetSpeed', clock.fast ? '1' : '60'); });
    $('reset-bench').addEventListener('click', function () {
      $('reset-bench').hidden = true;
      $('reset-confirm').hidden = false;
      $('reset-no').focus();
    });
    $('reset-no').addEventListener('click', function () {
      $('reset-confirm').hidden = true;
      $('reset-bench').hidden = false;
      $('reset-bench').focus();
    });
    $('reset-yes').addEventListener('click', function () {
      $('reset-confirm').hidden = true;
      $('reset-bench').hidden = false;
      sendBench('ResetBench', '');
    });

    // Let the page scroll when the wheel turns over the 3D view. The lab does not use the wheel,
    // but its engine would otherwise swallow it; this listener is registered first and on the
    // window, so it gets there before the engine's own.
    window.addEventListener('wheel', function (e) {
      if (e.target === $('unity-canvas')) e.stopImmediatePropagation();
    }, { capture: true, passive: true });

    // keep where the bench clock has got to when the page is put away
    window.addEventListener('pagehide', saveState);
    document.addEventListener('visibilitychange', function () { if (document.hidden) saveState(); });
  }

  // ---- Name, print, a new unknown --------------------------------------------------------------

  function bindReport() {
    var nameInput = $('student-name');
    nameInput.addEventListener('input', function () { state.name = nameInput.value; saveState(); updateReportStatus(); });
    $('print-report').addEventListener('click', function () { window.print(); });
    window.addEventListener('beforeprint', updateReportStatus);

    $('new-unknown').addEventListener('click', function () {
      $('new-unknown').hidden = true;
      $('new-confirm').hidden = false;
      $('new-no').focus();
    });
    $('new-no').addEventListener('click', function () {
      $('new-confirm').hidden = true;
      $('new-unknown').hidden = false;
    });
    $('new-yes').addEventListener('click', function () {
      state = blankState();
      verdicts = {};
      lastFlagged = {};
      toCount = {};
      results = { times: {}, colors: {}, answer: { ok: null }, longer: { ok: null } };
      fronts = [0, 0];
      clock = { seconds: 0, started: false, fast: false, developing: [false, false] };
      timeFocus = '';
      saveState();
      keepPicture(null);
      // a link that named the old unknown must not bring it back on the next visit
      if (params.has('code') && window.history && window.history.replaceState) {
        params.delete('code');
        var rest = params.toString();
        window.history.replaceState(null, '', window.location.pathname + (rest ? '?' + rest : ''));
      }
      $('new-confirm').hidden = true;
      $('new-unknown').hidden = false;
      refreshAll();
      configureBench();
      window.scrollTo({ top: 0 });
    });
  }

  // puts everything in the saved work back on the page
  function refreshAll() {
    $('unknown-code').textContent = state.code;
    TIME_FIELDS.forEach(function (f) { $('time-' + f).value = state.times[f]; });
    buildColorRows();
    buildAnswer();
    $('longer').value = state.longer;
    $('improve').value = state.improve;
    syncPrintCopy($('improve'));
    $('student-name').value = state.name;
    showPicture(loadPicture());
    checkTimes();
    showColors();
    checkAnswer();
    showRun();
  }

  // ---- Wiring for the Unity loader in index.html ---------------------------------------------------

  var lab = window.InkLab = {
    isMock: !!standIn,      // true when a test stand-in replaces the 3D lab
    view: 'bench',          // which camera view the 3D lab is showing or moving to
    onUnityEvent: onBenchEvent,
    attachUnity: function (instance) { unity = instance; configureBench(); },
    unityProgress: function (fraction) {
      $('progress-fill').style.width = Math.round(Math.max(0.04, fraction) * 100) + '%';
    },
    unityFailed: function (error) {
      console.error(error);
      var cover = $('stage-cover');
      cover.hidden = false;
      cover.setAttribute('data-state', 'failed');
      $('stage-status').textContent = 'The 3D lab could not start in this browser. Open this page in a current version of Chrome, Edge, Firefox or Safari on a computer.';
      document.querySelector('.progress').hidden = true;
    },
    unityBanner: function (message, type) {
      if (type === 'error') lab.unityFailed(message); else console.warn(message);
    }
  };

  bindTimes();
  bindQuestions();
  bindBenchControls();
  bindReport();
  refreshAll();
  saveState();

  // ---- Stand-in for the 3D lab, supplied by automated tests -------------------------------------

  if (standIn) {
    unity = standIn(onBenchEvent);
    onBenchEvent('{"type":"ready"}');
  }
})();
