/*
 * pH of Common Solutions: page logic.
 * Keeps the student's predictions and readings, checks what can be checked from the student's own
 * entries, and talks to the 3D lab (a Unity build in the canvas: a fume hood with the bench inside
 * it). The page does not know the pH of any solution. It sends each recorded reading to the 3D lab,
 * which compares it with the strip, and shows the verdict that comes back.
 */
(function () {
  'use strict';

  var M = window.PhLabModel;
  var N = M.COUNT;
  var WELLS = [];
  for (var w = 1; w <= N; w++) WELLS.push(w);
  var STORE_KEY = 'ph-lab:v1';
  var params = new URLSearchParams(window.location.search);
  // Automated tests of the page run it without the 3D lab, against a stand-in they supply.
  var standIn = typeof window.PhLabStandIn === 'function' ? window.PhLabStandIn : null;

  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (text != null) node.textContent = text;
    return node;
  }
  function blank(value) { return WELLS.map(function () { return value; }); }

  // ---- Saved work ----------------------------------------------------------------------------

  function blankState() {
    return {
      v: 1,
      name: '',
      hyp: blank(''),           // 'acid' | 'base' | 'neutral' for each solution
      locked: false,            // predictions locked and the bench open
      filled: [],               // wells with their solution in
      tested: [],               // wells a strip has been dipped in
      ph: blank(''),            // measured pH as typed
      yn: blank(''),            // prediction correct? 'Y' | 'N'
      order: WELLS.map(function (n) { return n - 1; }),   // ranking: solution indexes, least acidic first
      flags: { readings: 0, checks: 0 }
    };
  }

  function loadState() {
    try {
      var saved = JSON.parse(window.localStorage.getItem(STORE_KEY));
      if (!saved || saved.v !== 1) return null;
      var fresh = blankState();
      ['hyp', 'ph', 'yn'].forEach(function (k) { if (!Array.isArray(saved[k]) || saved[k].length !== N) saved[k] = fresh[k]; });
      ['filled', 'tested'].forEach(function (k) { if (!Array.isArray(saved[k])) saved[k] = []; });
      var order = Array.isArray(saved.order) ? saved.order.slice().sort(function (a, b) { return a - b; }).join(',') : '';
      if (order !== fresh.order.join(',')) saved.order = fresh.order;
      saved.flags = Object.assign(fresh.flags, saved.flags || {});
      saved.locked = !!saved.locked;
      return saved;
    } catch (e) {
      return null;
    }
  }

  function saveState() {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* private window: work simply is not kept */ }
  }

  var state = loadState() || blankState();
  var lastFlagged = {};      // field -> last value that was flagged, so retyping is not counted twice
  var results = { readings: {}, checks: {}, order: { ok: null, message: '' } };

  function paint(input, msg, result, tip) {
    var stateName = result.ok === true ? 'ok' : (result.ok === false ? 'bad' : '');
    if (stateName) input.setAttribute('data-state', stateName); else input.removeAttribute('data-state');
    if (result.ok === false) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    if (msg) {
      msg.textContent = result.message || '';
      if (tip || result.ok === true) msg.setAttribute('data-kind', 'tip'); else msg.removeAttribute('data-kind');
    }
  }

  function countFlag(group, field, value, result) {
    if (result.ok !== false) return;
    if (lastFlagged[field] === value) return;
    lastFlagged[field] = value;
    state.flags[group] += 1;
  }

  // ---- Part 1: predictions -------------------------------------------------------------------

  function buildPredictions() {
    var holder = $('predictions');
    WELLS.forEach(function (n) {
      var set = el('fieldset', { 'class': 'choice', id: 'hyp-' + n });
      var legend = el('legend');
      legend.appendChild(el('span', { 'class': 'choice-num' }, String(n)));
      legend.appendChild(document.createTextNode(M.SOLUTIONS[n - 1]));
      set.appendChild(legend);
      var group = el('div', { 'class': 'choice-options' });
      M.CLASSES.forEach(function (c) {
        var label = el('label', { 'class': 'choice-option' });
        var input = el('input', { type: 'radio', name: 'hyp-' + n, value: c, id: 'hyp-' + n + '-' + c });
        input.addEventListener('change', function () {
          if (state.locked) return;
          state.hyp[n - 1] = c;
          saveState();
          refreshPredictions();
        });
        label.appendChild(input);
        label.appendChild(el('span', null, M.CLASS_NAMES[c]));
        group.appendChild(label);
      });
      set.appendChild(group);
      holder.appendChild(set);
    });
    $('lock-predictions').addEventListener('click', function () {
      if (state.locked || !allPredicted()) return;
      state.locked = true;
      saveState();
      refreshPredictions();
      note('The bench is open. Start by dragging pipette 1 to well 1.');
      if (window.matchMedia && !window.matchMedia('(max-width: 900px)').matches) $('part-measure').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function allPredicted() { return state.hyp.every(function (h) { return !!h; }); }

  function refreshPredictions() {
    var done = state.hyp.filter(function (h) { return !!h; }).length;
    WELLS.forEach(function (n) {
      M.CLASSES.forEach(function (c) {
        var input = $('hyp-' + n + '-' + c);
        input.checked = state.hyp[n - 1] === c;
        input.disabled = state.locked;
      });
      var cell = $('pred-' + n);
      if (cell) cell.textContent = state.hyp[n - 1] ? M.CLASS_NAMES[state.hyp[n - 1]] : '–';
    });
    $('lock-predictions').hidden = state.locked;
    $('lock-predictions').disabled = !allPredicted();
    $('lock-status').textContent = state.locked
      ? 'Your predictions are locked. Measure in part 2.'
      : (done === N ? 'All twelve predictions are made. Lock them to open the bench.' : done + ' of 12 predictions made.');
    $('stage-lock').hidden = state.locked;
    updateReportStatus();
  }

  // ---- Part 2: data table --------------------------------------------------------------------

  function buildDataRows() {
    var body = $('data-rows');
    WELLS.forEach(function (n) {
      var row = el('tr');
      row.appendChild(el('th', { scope: 'row', 'class': 'col-num' }, String(n)));
      row.appendChild(el('td', { 'class': 'col-name' }, M.SOLUTIONS[n - 1]));
      row.appendChild(el('td', { id: 'pred-' + n, 'class': 'col-pred' }, '–'));

      var phCell = el('td');
      var input = el('input', {
        type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', id: 'ph-' + n,
        'aria-label': 'Measured pH of ' + M.SOLUTIONS[n - 1], 'aria-describedby': 'msg-ph-' + n
      });
      input.value = state.ph[n - 1];
      input.addEventListener('input', function () {
        state.ph[n - 1] = input.value;
        paint(input, $('msg-ph-' + n), { ok: null, message: '' });
        saveState();
      });
      input.addEventListener('change', function () { checkReadings('ph-' + n); });
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') input.blur(); });
      phCell.appendChild(input);
      phCell.appendChild(el('p', { 'class': 'msg', id: 'msg-ph-' + n, role: 'status' }));
      row.appendChild(phCell);

      var ynCell = el('td');
      var select = el('select', { id: 'yn-' + n, 'aria-label': 'Was the prediction for ' + M.SOLUTIONS[n - 1] + ' correct?', 'aria-describedby': 'msg-yn-' + n });
      [['', '–'], ['Y', 'Y'], ['N', 'N']].forEach(function (o) { select.appendChild(el('option', { value: o[0] }, o[1])); });
      select.value = state.yn[n - 1];
      select.addEventListener('change', function () {
        state.yn[n - 1] = select.value;
        saveState();
        checkAnswers('yn-' + n);
      });
      ynCell.appendChild(select);
      ynCell.appendChild(el('p', { 'class': 'msg', id: 'msg-yn-' + n, role: 'status' }));
      row.appendChild(ynCell);
      body.appendChild(row);
    });
  }

  // ---- Checking the readings -------------------------------------------------------------------
  // The page screens each entry itself (empty, not a number, outside 0 to 14). A proper reading
  // goes to the 3D lab, which compares it with the strip and sends back a verdict. Until the
  // verdict for the current entry is in, the entry is shown as neither right nor wrong.

  var verdicts = {};      // field -> { context, verdict }: the 3D lab's last word on that field
  var asked = {};         // request number -> { field: context } for the readings sent with it
  var nextAsk = 1;
  var toCount = {};       // fields the student just finished: count a flag once their result is in

  // A verdict depends on whether that well has been tested as well as on what was typed.
  function contextOf(n) {
    return state.ph[n - 1] + '|' + (state.tested.indexOf(n) >= 0 ? 't' : '');
  }

  function readingResult(n) {
    var screened = M.screenReading(state.ph[n - 1]);
    if (!screened.ready) return { ok: screened.ok, message: screened.message };
    var known = verdicts['ph-' + n];
    if (!known || known.context !== contextOf(n)) return { ok: null, message: '', waiting: true };
    return M.readingMessage(known.verdict, n);
  }

  function checkReadings(changedField) {
    if (changedField) toCount[changedField] = true;
    showReadings();
    askBench();
  }

  function showReadings() {
    WELLS.forEach(function (n) {
      var field = 'ph-' + n;
      var result = readingResult(n);
      results.readings[field] = result;
      paint($(field), $('msg-' + field), result);
      if (toCount[field] && !result.waiting) {
        delete toCount[field];
        countFlag('readings', field, state.ph[n - 1], result);
      }
    });
    saveState();
    updateTableStatus();
    checkAnswers();
  }

  function askBench() {
    if (!benchReady) return;
    var id = nextAsk++, sent = {}, readings = [];
    WELLS.forEach(function (n) {
      var s = M.screenReading(state.ph[n - 1]);
      var row = { well: n, has: false, value: 0 };
      if (s.ready) { row.has = true; row.value = s.value; sent['ph-' + n] = contextOf(n); }
      readings.push(row);
    });
    asked[id] = sent;
    sendBench('Check', JSON.stringify({ id: id, readings: readings }));
  }

  function takeVerdicts(e) {
    var sent = asked[e.id];
    delete asked[e.id];
    if (!sent) return;
    (e.rows || []).forEach(function (row) {
      var field = 'ph-' + row.well;
      if (row.verdict && sent[field] !== undefined) verdicts[field] = { context: sent[field], verdict: row.verdict };
    });
    showReadings();
  }

  function acceptedValue(n) {
    if (!results.readings['ph-' + n] || results.readings['ph-' + n].ok !== true) return null;
    return M.screenReading(state.ph[n - 1]).value;
  }

  function readingsAccepted() {
    return WELLS.filter(function (n) { return acceptedValue(n) !== null; }).length;
  }

  function updateTableStatus() {
    var done = readingsAccepted();
    var text = '';
    if (done === N) text = 'All twelve readings are recorded.';
    else if (done > 0) text = done + ' of 12 readings recorded.';
    $('table-status').textContent = text;
  }

  // ---- Checks that use only the student's own entries: prediction correct? and the ranking -------

  function checkAnswers(changedField) {
    WELLS.forEach(function (n) {
      var field = 'yn-' + n;
      var r = M.checkCorrect(state.hyp[n - 1], acceptedValue(n), state.yn[n - 1]);
      if (state.yn[n - 1] && acceptedValue(n) === null) r = { ok: null, message: 'This is checked once the measured pH is accepted.' };
      results.checks[field] = r;
      paint($(field), $('msg-' + field), r, r.ok === null && !!r.message);
      if (changedField === field) countFlag('checks', field, state.yn[n - 1], r);
    });
    checkRanking();
  }

  function rankingReady() { return readingsAccepted() === N; }

  function checkRanking() {
    var values = WELLS.map(function (n) { return acceptedValue(n); });
    var r = rankingReady() ? M.checkOrder(state.order, values) : { ok: null, at: -1, message: 'The order is checked once all twelve readings are accepted.' };
    results.order = r;
    var items = $('rank-list').children;
    for (var i = 0; i < items.length; i++) {
      items[i].removeAttribute('data-state');
      if (r.ok === false && (i === r.at || i === r.at + 1)) items[i].setAttribute('data-state', 'bad');
      var v = values[state.order[i]];
      var label = items[i].querySelector('.rank-ph');
      if (label) label.textContent = v === null ? '' : 'pH ' + M.formatPh(v);
    }
    $('rank-list').setAttribute('data-state', r.ok === true ? 'ok' : (r.ok === false ? 'bad' : ''));
    var msg = $('rank-msg');
    msg.textContent = r.ok === true ? 'The order matches your measured pH values.' : r.message;
    if (r.ok === false) msg.removeAttribute('data-kind'); else msg.setAttribute('data-kind', 'tip');
    saveState();
    updateReportStatus();
  }

  // ---- Part 3: ranking list ----------------------------------------------------------------------

  function buildRanking() {
    var list = $('rank-list');
    list.textContent = '';
    state.order.forEach(function (index, position) {
      var item = el('li', { 'class': 'rank-item' });
      item.appendChild(el('span', { 'class': 'rank-pos' }, String(position + 1)));
      var name = el('span', { 'class': 'rank-name' }, M.SOLUTIONS[index]);
      item.appendChild(name);
      var value = acceptedValue(index + 1);
      item.appendChild(el('span', { 'class': 'rank-ph' }, value === null ? '' : 'pH ' + M.formatPh(value)));
      var up = el('button', { type: 'button', 'class': 'rank-move', 'aria-label': 'Move ' + M.SOLUTIONS[index] + ' up' }, '↑');
      var down = el('button', { type: 'button', 'class': 'rank-move', 'aria-label': 'Move ' + M.SOLUTIONS[index] + ' down' }, '↓');
      up.disabled = position === 0;
      down.disabled = position === N - 1;
      up.addEventListener('click', function () { move(position, -1); });
      down.addEventListener('click', function () { move(position, 1); });
      item.appendChild(up);
      item.appendChild(down);
      list.appendChild(item);
    });
    var ends = $('rank-list');
    ends.setAttribute('data-top', 'Least acidic');
    ends.setAttribute('data-bottom', 'Most acidic');
    checkRanking();
  }

  function move(position, step) {
    var to = position + step;
    if (to < 0 || to >= N) return;
    var order = state.order;
    var t = order[position]; order[position] = order[to]; order[to] = t;
    saveState();
    buildRanking();
    var buttons = $('rank-list').children[to].querySelectorAll('.rank-move');
    var focus = step < 0 ? buttons[0] : buttons[1];
    if (focus.disabled) focus = step < 0 ? buttons[1] : buttons[0];
    focus.focus();
  }

  // ---- Report ------------------------------------------------------------------------------------

  function checksAccepted() {
    return WELLS.filter(function (n) { return results.checks['yn-' + n] && results.checks['yn-' + n].ok === true; }).length;
  }

  function updateReportStatus() {
    if (!$('report-status')) return;
    var readings = readingsAccepted(), checks = checksAccepted(), ranked = results.order.ok === true;
    var text;
    if (!state.locked) text = 'Still to do: make and lock your twelve predictions in part 1.';
    else if (readings < N) text = 'Still to do: ' + (N - readings) + ' of the 12 pH readings in part 2.';
    else if (checks < N) text = 'Still to do: ' + (N - checks) + ' of the 12 "prediction correct?" answers in part 2.';
    else if (!ranked) text = 'Still to do: the ranking in part 3.';
    else text = 'Everything is checked. Add your name, then print or save the report as a PDF.';
    $('report-status').textContent = text;

    $('print-name').textContent = 'Name: ' + (state.name || '________________');
    $('print-date').textContent = 'Printed ' + new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    $('print-checks').textContent = 'Checked by the lab page: ' + readings + ' of 12 pH readings accepted (' + state.flags.readings +
      ' flagged before correction); ' + checks + ' of 12 "prediction correct?" answers accepted (' + state.flags.checks +
      ' flagged before correction); ranking ' + (ranked ? 'in order' : 'not yet in order') + '.';
  }

  // ---- The 3D bench ----------------------------------------------------------------------------

  var unity = null;
  var unityAwake = false;
  var benchReady = false;     // the 3D lab has set up the bench and can check readings
  var persistentNote = { text: '', kind: '' };

  function sendBench(method, value) {
    if (!unity) return;
    try { unity.SendMessage('Lab', method, value == null ? '' : String(value)); } catch (e) { console.error(e); }
  }

  // A fresh lab opens on the whole fume hood and then moves in to the bench. Someone coming back
  // to work already under way starts at the bench, and ?intro=0 always does. Visitors who ask
  // their system for reduced motion get straight cuts between views and no opening move.
  var calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function workUnderWay() { return state.filled.length > 0; }

  function configureBench() {
    if (!unity || !unityAwake) return;
    benchReady = false;
    sendBench('Configure', JSON.stringify({
      filled: state.filled,
      tested: state.tested,
      intro: params.get('intro') !== '0' && !calm && !workUnderWay(),
      calm: calm
    }));
  }

  // A step or warning note stays up for a few seconds before labels for whatever the pointer is
  // over take its place: the pointer is usually still over the well it was just used on, and a
  // warning such as "goes in well 2, not well 1" must be readable.
  var holdNoteUntil = 0;
  var pendingHover = null;
  var hoverTimer = null;

  function note(text, kind, temporary) {
    if (!temporary) {
      persistentNote = { text: text, kind: kind || '' };
      holdNoteUntil = Date.now() + (kind === 'warn' ? 4000 : 2500);
      pendingHover = null;
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

  function name(n) { return M.SOLUTIONS[n - 1]; }

  function nextStep() {
    for (var i = 0; i < N; i++) {
      var n = i + 1;
      if (state.filled.indexOf(n) < 0) return 'Next: drag pipette ' + n + ' (' + name(n) + ') to well ' + n + '.';
    }
    for (var j = 0; j < N; j++) {
      if (state.tested.indexOf(j + 1) < 0) return 'Next: drag a strip of pH paper from the vial into well ' + (j + 1) + '.';
    }
    return 'Every well has been tested. Click a strip on the towel to compare it with the color chart.';
  }

  function setView(view) {
    Array.prototype.forEach.call(document.querySelectorAll('.view-button'), function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-view') === view ? 'true' : 'false');
    });
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
        if (Array.isArray(e.filled)) state.filled = e.filled;
        if (Array.isArray(e.tested)) state.tested = e.tested;
        benchReady = true;
        note(state.locked ? nextStep() : 'Lock your predictions in part 1 to open the bench.');
        checkReadings();
        break;
      case 'checked':
        takeVerdicts(e);
        break;
      case 'hover':
        if (e.item === 'pipette') hoverNote('Pipette ' + e.n + ': ' + name(e.n));
        else if (e.item === 'well') hoverNote('Well ' + e.n + (state.filled.indexOf(e.n) >= 0 ? ': ' + name(e.n) : ': empty'));
        else if (e.item === 'strip') hoverNote('Strip from well ' + e.n + ' (' + name(e.n) + '). Click it to hold it next to the color chart.');
        else if (e.item === 'vial') hoverNote('pH paper. Drag a strip into a well to test it, or click the vial and then the well.');
        else hoverNote(null);
        break;
      case 'holding':
        clearTimeout(hoverTimer);
        pendingHover = null;
        if (e.item === 'pipette') note('Holding pipette ' + e.n + ' (' + name(e.n) + '). Tap or click well ' + e.n + ' to add a few drops, or anywhere else to put it back.', '', true);
        else note('Holding a strip of pH paper. Tap or click a well that has solution in it to dip the strip, or anywhere else to put it back.', '', true);
        break;
      case 'returned':
        note(persistentNote.text, persistentNote.kind, true);
        break;
      case 'filled':
        state.filled = e.filled;
        saveState();
        note(name(e.well) + ' is in well ' + e.well + '. ' + nextStep());
        break;
      case 'blocked':
        if (e.reason === 'wrong-well') note(name(e.pipette) + ' goes in well ' + e.pipette + ', not well ' + e.well + '.', 'warn');
        else if (e.reason === 'full') note('Well ' + e.well + ' already has ' + name(e.well).toLowerCase() + ' in it.', 'warn');
        else if (e.reason === 'empty') note('Well ' + e.well + ' is empty. Add ' + name(e.well).toLowerCase() + ' with pipette ' + e.well + ' first.', 'warn');
        break;
      case 'tested':
        state.tested = e.tested;
        saveState();
        note('Strip in well ' + e.well + ' (' + name(e.well) + '): count to 5 while the color settles.');
        checkReadings();
        break;
      case 'developed':
        note('The strip from well ' + e.well + ' is ready. Click it to hold it next to the color chart.');
        break;
      case 'compare':
        note('Strip ' + e.well + ' (' + name(e.well) + ') is next to the color chart. Record the pH of the closest color.');
        break;
      case 'reset':
        state.filled = [];
        state.tested = [];
        WELLS.forEach(function (n) {
          state.ph[n - 1] = '';
          state.yn[n - 1] = '';
          $('ph-' + n).value = '';
          $('yn-' + n).value = '';
        });
        note('The plate is clean and the strips are gone. ' + nextStep());
        checkReadings();
        buildRanking();
        break;
      case 'view':        // the camera has set off for this view
        setView(e.view);
        lab.view = e.view;
        lab.viewSettled = false;
        break;
      case 'arrived':     // and has got there
        setView(e.view);
        lab.view = e.view;
        lab.viewSettled = true;
        break;
    }
  }

  function bindBenchControls() {
    Array.prototype.forEach.call(document.querySelectorAll('.view-button'), function (button) {
      button.addEventListener('click', function () { sendBench('SetView', button.getAttribute('data-view')); });
    });
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
  }

  // ---- Name, print, start over -------------------------------------------------------------------

  function bindReport() {
    var nameInput = $('student-name');
    nameInput.value = state.name;
    nameInput.addEventListener('input', function () { state.name = nameInput.value; saveState(); updateReportStatus(); });
    $('print-report').addEventListener('click', function () { window.print(); });
    window.addEventListener('beforeprint', updateReportStatus);

    $('start-over').addEventListener('click', function () {
      $('start-over').hidden = true;
      $('start-confirm').hidden = false;
      $('start-no').focus();
    });
    $('start-no').addEventListener('click', function () {
      $('start-confirm').hidden = true;
      $('start-over').hidden = false;
    });
    $('start-yes').addEventListener('click', function () {
      state = blankState();
      verdicts = {};
      lastFlagged = {};
      saveState();
      $('start-confirm').hidden = true;
      $('start-over').hidden = false;
      refreshAll();
      configureBench();
      window.scrollTo({ top: 0 });
    });
  }

  function refreshAll() {
    WELLS.forEach(function (n) {
      $('ph-' + n).value = state.ph[n - 1];
      $('yn-' + n).value = state.yn[n - 1];
    });
    $('student-name').value = state.name;
    refreshPredictions();
    buildRanking();
    checkReadings();
  }

  // ---- Wiring for the Unity loader in index.html ---------------------------------------------------

  var lab = window.PhLab = {
    isMock: !!standIn,      // true when a test stand-in replaces the 3D lab
    view: 'bench',          // which camera view the 3D lab is showing or moving to
    viewSettled: false,     // false while the camera is still travelling
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

  buildPredictions();
  buildDataRows();
  bindBenchControls();
  bindReport();
  refreshAll();
  saveState();

  // ---- Stand-in for the 3D lab, supplied by automated tests -------------------------------------

  if (standIn) {
    unity = standIn(onBenchEvent);
    lab.mockFill = function (well) { unity.fill(well); };
    lab.mockTest = function (well) { unity.test(well); };
    onBenchEvent('{"type":"ready"}');
  }
})();
