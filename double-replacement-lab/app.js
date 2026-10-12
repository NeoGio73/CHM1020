/*
 * Double Replacement Reactions: page logic.
 * Keeps what the student records, checks what can be checked from the student's own entries, and
 * talks to the 3D lab (a Unity build in the canvas: a fume hood with the sheet, the pipets and a
 * toothpick inside it). The page does not know what any pair of solutions does. It sends each
 * entry of Table 1 to the 3D lab, which compares it with the drop on the sheet, and shows the
 * verdict that comes back.
 */
(function () {
  'use strict';

  var M = window.DoubleLabModel;
  var ROWS = M.ROWS.length, COLS = M.COLUMNS.length, BOXES = ROWS * COLS;
  var STORE_KEY = 'double-replacement-lab:v1';
  var params = new URLSearchParams(window.location.search);
  // Automated tests of the page run it without the 3D lab, against a stand-in they supply.
  var standIn = typeof window.DoubleLabStandIn === 'function' ? window.DoubleLabStandIn : null;

  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (text != null) node.textContent = text;
    return node;
  }
  function key(row, col) { return row + '-' + col; }
  function index(row, col) { return row * COLS + col; }
  function rowName(row) { return M.pretty(M.solution(M.ROWS[row]).formula); }
  function colName(col) { return M.pretty(M.solution(M.COLUMNS[col]).formula); }
  function nameOf(id) { var s = M.solution(id); return s ? M.pretty(s.formula) : id; }
  // every box that is not marked Skip
  function eachBox(fn) {
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) if (!M.skipped(r, c)) fn(r, c);
  }
  var BOX_COUNT = 0;
  eachBox(function () { BOX_COUNT++; });
  var QUESTIONS = M.EQUATIONS.filter(function (q) { return !q.example; });

  // ---- Saved work ----------------------------------------------------------------------------

  function zeros() { var a = []; for (var i = 0; i < BOXES; i++) a.push(0); return a; }

  function blankState() {
    return {
      v: 1,
      name: '',
      bench: { a: zeros(), b: zeros(), s: zeros() },   // the sheet: row drop, column drop, stirred, for every box
      obs: {},                                         // "row-col" -> what was recorded for that box
      cations: [],
      anions: [],
      eq: QUESTIONS.map(function () { return { a: '', b: '', c: '', d: '', p1: '', p2: '', checked: false }; }),
      flags: { obs: 0, ions: 0, eq: 0 }
    };
  }

  function loadState() {
    try {
      var saved = JSON.parse(window.localStorage.getItem(STORE_KEY));
      if (!saved || saved.v !== 1) return null;
      var fresh = blankState();
      if (!saved.bench) saved.bench = fresh.bench;
      ['a', 'b', 's'].forEach(function (k) { if (!Array.isArray(saved.bench[k]) || saved.bench[k].length !== BOXES) saved.bench[k] = zeros(); });
      if (!saved.obs || typeof saved.obs !== 'object') saved.obs = {};
      ['cations', 'anions'].forEach(function (k) { if (!Array.isArray(saved[k])) saved[k] = []; });
      if (!Array.isArray(saved.eq) || saved.eq.length !== QUESTIONS.length) saved.eq = fresh.eq;
      saved.flags = Object.assign(fresh.flags, saved.flags || {});
      return saved;
    } catch (e) {
      return null;
    }
  }

  function saveState() {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* private window: work simply is not kept */ }
  }

  var state = loadState() || blankState();
  var lastFlagged = {};      // field -> last value that was flagged, so the same slip is not counted twice
  var results = { obs: {}, cations: { ok: null }, anions: { ok: null }, eq: [] };

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

  function showMessage(msg, result, tip) {
    msg.textContent = result.message || '';
    if (tip || result.ok !== false) msg.setAttribute('data-kind', 'tip'); else msg.removeAttribute('data-kind');
  }

  // ---- Table 1 -------------------------------------------------------------------------------

  var gridFocus = '';        // the box whose message is showing under the table

  function buildGrid() {
    var head = $('grid-head');
    M.COLUMNS.forEach(function (id) {
      var s = M.solution(id);
      var th = el('th', { scope: 'col' });
      th.appendChild(el('span', { 'class': 'grid-formula' }, M.pretty(s.formula)));
      th.appendChild(el('span', { 'class': 'grid-conc' }, s.conc));
      head.appendChild(th);
    });
    var body = $('grid-rows');
    M.ROWS.forEach(function (id, r) {
      var s = M.solution(id);
      var tr = el('tr');
      var th = el('th', { scope: 'row' });
      th.appendChild(el('span', { 'class': 'grid-formula' }, M.pretty(s.formula)));
      th.appendChild(el('span', { 'class': 'grid-conc' }, s.conc));
      tr.appendChild(th);
      M.COLUMNS.forEach(function (colId, c) {
        var td = el('td', { id: 'box-' + key(r, c), 'data-col': colName(c) });
        if (M.skipped(r, c)) {
          td.className = 'grid-skip';
          td.textContent = 'Skip';
          tr.appendChild(td);
          return;
        }
        var select = el('select', { id: 'obs-' + key(r, c), 'aria-label': 'What happened with ' + M.boxName(r, c) });
        select.appendChild(el('option', { value: '' }, '–'));
        M.ANSWERS.forEach(function (a) { select.appendChild(el('option', { value: a.value }, a.text)); });
        select.value = state.obs[key(r, c)] || '';
        select.addEventListener('change', function () {
          if (select.value) state.obs[key(r, c)] = select.value; else delete state.obs[key(r, c)];
          gridFocus = key(r, c);
          toCount[key(r, c)] = true;
          saveState();
          checkGrid();
        });
        select.addEventListener('focus', function () {
          gridFocus = key(r, c);
          showGridMessage();
          // in the close-up the camera follows the box being recorded
          if (lab.view === 'close' && lab.viewSettled) sendBench('LookAtBox', r + ',' + c);
        });
        td.appendChild(select);
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  }

  // The page screens nothing itself here: every recorded box goes to the 3D lab, which answers
  // with a verdict. Until the verdict for the current entry is in, the entry is shown as neither
  // right nor wrong.
  var verdicts = {};      // "row-col" -> { context, verdict }: the 3D lab's last word on that box
  var asked = {};         // request number -> { "row-col": context } for the entries sent with it
  var nextAsk = 1;
  var toCount = {};       // boxes the student just recorded: count a flag once their result is in

  // A verdict depends on what is in the box on the sheet as well as on what was recorded.
  function contextOf(row, col) {
    var i = index(row, col);
    return (state.obs[key(row, col)] || '') + '|' + state.bench.a[i] + state.bench.b[i] + state.bench.s[i];
  }

  function boxResult(row, col) {
    if (!state.obs[key(row, col)]) return { ok: null, message: '' };
    var known = verdicts[key(row, col)];
    if (!known || known.context !== contextOf(row, col)) return { ok: null, message: '', waiting: true };
    return M.boxMessage(known.verdict);
  }

  function checkGrid() {
    showGrid();
    askBench();
  }

  function showGrid() {
    eachBox(function (r, c) {
      var k = key(r, c);
      var result = boxResult(r, c);
      results.obs[k] = result;
      setState($('obs-' + k), result);
      if (toCount[k] && !result.waiting) {
        delete toCount[k];
        countFlag('obs', k, state.obs[k] || '', result);
      }
    });
    saveState();
    showGridMessage();
    updateTableStatus();
    checkIons();
    updateNote();
  }

  function showGridMessage() {
    var msg = $('grid-msg');
    var parts = gridFocus.split('-');
    var result = gridFocus ? results.obs[gridFocus] : null;
    if (result && result.ok === false) {
      msg.textContent = M.boxName(+parts[0], +parts[1]) + ': ' + result.message;
      msg.removeAttribute('data-kind');
    } else {
      msg.textContent = '';
    }
  }

  function askBench() {
    if (!benchReady) return;
    var id = nextAsk++, sent = {}, items = [];
    eachBox(function (r, c) {
      var answer = state.obs[key(r, c)];
      if (!answer) return;
      items.push({ field: key(r, c), row: r, col: c, answer: answer });
      sent[key(r, c)] = contextOf(r, c);
    });
    if (!items.length) return;
    asked[id] = sent;
    sendBench('Check', JSON.stringify({ id: id, items: items }));
  }

  function takeVerdicts(e) {
    var sent = asked[e.id];
    delete asked[e.id];
    if (!sent) return;
    (e.rows || []).forEach(function (row) {
      if (row.verdict && sent[row.field] !== undefined) verdicts[row.field] = { context: sent[row.field], verdict: row.verdict };
    });
    showGrid();
  }

  function accepted(row, col) {
    var r = results.obs[key(row, col)];
    return r && r.ok === true ? state.obs[key(row, col)] : '';
  }

  function boxesAccepted() {
    var n = 0;
    eachBox(function (r, c) { if (accepted(r, c)) n++; });
    return n;
  }

  function updateTableStatus() {
    var done = boxesAccepted();
    var text = '';
    if (done === BOX_COUNT) text = 'All ' + BOX_COUNT + ' boxes are recorded.';
    else if (done > 0) text = done + ' of ' + BOX_COUNT + ' boxes recorded.';
    $('table-status').textContent = text;
  }

  // ---- Part 2: which ions --------------------------------------------------------------------

  function buildIons() {
    [['cations', M.CATIONS, 'cation-options'], ['anions', M.ANIONS, 'anion-options']].forEach(function (group) {
      var kind = group[0], holder = $(group[2]);
      group[1].forEach(function (ion) {
        var label = el('label', { 'class': 'ion-option' });
        var input = el('input', { type: 'checkbox', id: kind + '-' + ion, value: ion });
        input.checked = state[kind].indexOf(ion) >= 0;
        input.addEventListener('change', function () {
          var at = state[kind].indexOf(ion);
          if (input.checked && at < 0) state[kind].push(ion);
          if (!input.checked && at >= 0) state[kind].splice(at, 1);
          saveState();
          checkIons(kind);
        });
        label.appendChild(input);
        label.appendChild(el('span', null, M.IONS[ion].name));
        holder.appendChild(label);
      });
    });
  }

  // Checked against the student's own accepted Table 1, so it waits until that is complete.
  function checkIons(changed) {
    var grid = [], complete = boxesAccepted() === BOX_COUNT;
    for (var r = 0; r < ROWS; r++) {
      grid.push([]);
      for (var c = 0; c < COLS; c++) grid[r].push(M.skipped(r, c) ? '' : accepted(r, c));
    }
    ['cations', 'anions'].forEach(function (kind) {
      var result = M.checkIons(kind, state[kind], grid, complete);
      results[kind] = result;
      setState($('q-' + kind), result);
      showMessage($('msg-' + kind), result, result.ok === null);
      if (changed === kind) countFlag('ions', kind, state[kind].slice().sort().join(','), result);
    });
    saveState();
    updateReportStatus();
  }

  // ---- Part 3: equations ---------------------------------------------------------------------

  function term(id) {
    var s = M.solution(id);
    var span = el('span', { 'class': 'eq-term' });
    span.appendChild(el('span', { 'class': 'eq-formula' }, M.pretty(s.formula)));
    span.appendChild(el('span', { 'class': 'eq-ions' }, M.IONS[s.cation].name + '  ' + M.IONS[s.anion].name));
    return span;
  }
  function sign(text) { return el('span', { 'class': 'eq-sign', 'aria-hidden': 'true' }, text); }

  function buildEquations() {
    // the worked example
    var example = M.EQUATIONS.filter(function (q) { return q.example; })[0];
    var solved = M.solve(example), co = solved.coefficients;
    var box = $('equation-example');
    box.appendChild(el('span', { 'class': 'eq-label' }, 'Example'));
    // The two sides of an equation are kept as two groups, so that on a narrow screen the line
    // breaks at the arrow and not in the middle of a formula.
    var line = el('div', { 'class': 'eq-line' });
    var from = el('span', { 'class': 'eq-side' }), to = el('span', { 'class': 'eq-side' });
    function shown(side, n, node) { side.appendChild(el('span', { 'class': 'eq-number' }, n > 1 ? String(n) : '')); side.appendChild(node); }
    shown(from, co[0], term(example.ab));
    from.appendChild(sign('+'));
    shown(from, co[1], term(example.cd));
    from.appendChild(sign('→'));
    shown(to, co[2], el('span', { 'class': 'eq-term' }, M.pretty(solved.p1.formula)));
    to.appendChild(sign('+'));
    shown(to, co[3], el('span', { 'class': 'eq-term' }, M.pretty(solved.p2.formula)));
    line.appendChild(from);
    line.appendChild(to);
    box.appendChild(line);
    box.appendChild(el('p', { 'class': 'eq-why' }, 'Fe³⁺ ends up with CO₃²⁻. Two Fe³⁺ (6+) cancel three CO₃²⁻ (6−), so the formula is Fe₂(CO₃)₃. Na⁺ ends up with Cl⁻ as NaCl. Then 2 FeCl₃ supply the two Fe³⁺ and six Cl⁻, and 3 Na₂CO₃ supply the three CO₃²⁻ and six Na⁺.'));

    var list = $('equations');
    QUESTIONS.forEach(function (q, n) {
      var item = el('li', { 'class': 'equation', id: 'eq-' + n });
      var row = el('div', { 'class': 'eq-line' });
      var entry = state.eq[n];
      function number(field, label) {
        var input = el('input', { type: 'text', inputmode: 'numeric', maxlength: '2', 'class': 'eq-coef', id: 'eq-' + n + '-' + field, autocomplete: 'off', 'aria-label': 'Coefficient of ' + label });
        input.value = entry[field];
        input.addEventListener('input', function () { entry[field] = input.value; edited(n); });
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') checkEquation(n, true); });
        return input;
      }
      function product(field, label) {
        var wrap = el('span', { 'class': 'eq-term eq-product' });
        var input = el('input', { type: 'text', 'class': 'eq-input', id: 'eq-' + n + '-' + field, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'formula', 'aria-label': label });
        var view = el('span', { 'class': 'eq-shown', id: 'eq-' + n + '-' + field + '-shown', 'aria-hidden': 'true' }, M.pretty(entry[field]));
        input.value = entry[field];
        input.addEventListener('input', function () { entry[field] = input.value; view.textContent = M.pretty(input.value); edited(n); });
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') checkEquation(n, true); });
        wrap.appendChild(input);
        wrap.appendChild(view);
        return wrap;
      }
      var left = el('span', { 'class': 'eq-side' }), right = el('span', { 'class': 'eq-side' });
      left.appendChild(number('a', nameOf(q.ab)));
      left.appendChild(term(q.ab));
      left.appendChild(sign('+'));
      left.appendChild(number('b', nameOf(q.cd)));
      left.appendChild(term(q.cd));
      left.appendChild(sign('→'));
      right.appendChild(number('c', 'the first product'));
      right.appendChild(product('p1', 'Formula of the first product'));
      right.appendChild(sign('+'));
      right.appendChild(number('d', 'the second product'));
      right.appendChild(product('p2', 'Formula of the second product'));
      row.appendChild(left);
      row.appendChild(right);
      var button = el('button', { type: 'button', 'class': 'quiet-button eq-check', id: 'eq-' + n + '-check' }, 'Check');
      button.addEventListener('click', function () { checkEquation(n, true); });
      row.appendChild(button);
      item.appendChild(row);
      item.appendChild(el('p', { 'class': 'msg', id: 'msg-eq-' + n, role: 'status' }));
      list.appendChild(item);
    });
  }

  // typing in an equation takes its last verdict away until it is checked again
  function edited(n) {
    state.eq[n].checked = false;
    results.eq[n] = { ok: null, message: '' };
    setState($('eq-' + n), results.eq[n]);
    $('msg-eq-' + n).textContent = '';
    saveState();
    updateEquationStatus();
  }

  function checkEquation(n, byStudent) {
    var entry = state.eq[n];
    var result = M.checkEquation(QUESTIONS[n], entry);
    results.eq[n] = result;
    entry.checked = result.ok !== null || !!result.message;
    setState($('eq-' + n), result);
    showMessage($('msg-eq-' + n), result);
    if (byStudent) countFlag('eq', 'eq-' + n, [entry.a, entry.b, entry.c, entry.d, entry.p1, entry.p2].join('|'), result);
    saveState();
    updateEquationStatus();
  }

  function equationsAccepted() {
    return results.eq.filter(function (r) { return r && r.ok === true; }).length;
  }

  function updateEquationStatus() {
    var done = equationsAccepted(), all = QUESTIONS.length;
    $('equation-status').textContent = done === all ? 'All ' + all + ' equations are balanced.' : (done > 0 ? done + ' of ' + all + ' equations balanced.' : '');
    updateReportStatus();
  }

  // ---- Report ------------------------------------------------------------------------------------

  function updateReportStatus() {
    if (!$('report-status')) return;
    var boxes = boxesAccepted(), ions = (results.cations.ok === true ? 1 : 0) + (results.anions.ok === true ? 1 : 0), eqs = equationsAccepted();
    var text;
    if (boxes < BOX_COUNT) text = 'Still to do: ' + (BOX_COUNT - boxes) + ' of the ' + BOX_COUNT + ' boxes of Table 1 in part 1.';
    else if (ions < 2) text = 'Still to do: ' + (ions === 1 ? 'one of the two questions' : 'the two questions') + ' in part 2.';
    else if (eqs < QUESTIONS.length) text = 'Still to do: ' + (QUESTIONS.length - eqs) + ' of the ' + QUESTIONS.length + ' equations in part 3.';
    else text = 'Everything is checked. Add your name, then print or save the report as a PDF.';
    $('report-status').textContent = text;

    $('print-name').textContent = 'Name: ' + (state.name || '________________');
    $('print-date').textContent = 'Printed ' + new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    $('print-checks').textContent = 'Checked by the lab page: ' + boxes + ' of ' + BOX_COUNT + ' boxes of Table 1 accepted (' + state.flags.obs +
      ' flagged before correction); ' + ions + ' of 2 questions about the ions accepted (' + state.flags.ions + ' flagged before correction); ' +
      eqs + ' of ' + QUESTIONS.length + ' equations accepted (' + state.flags.eq + ' flagged before correction).';
  }

  // ---- The 3D bench ----------------------------------------------------------------------------

  var unity = null;
  var unityAwake = false;
  var benchReady = false;     // the 3D lab has set out the bench and can check entries
  var persistentNote = { text: '', kind: '' };
  var lastLook = '';          // "row,col" of the box last looked at closely

  function sendBench(method, value) {
    if (!unity) return;
    try { unity.SendMessage('Lab', method, value == null ? '' : String(value)); } catch (e) { console.error(e); }
  }

  // A fresh lab opens on the whole fume hood and then moves in to the bench. Someone coming back
  // to work already under way starts at the bench, and ?intro=0 always does. Visitors who ask
  // their system for reduced motion get straight cuts between views and no opening move.
  var calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function workUnderWay() { return state.bench.a.concat(state.bench.b).some(function (n) { return !!n; }); }

  function configureBench() {
    if (!unity || !unityAwake) return;
    benchReady = false;
    sendBench('Configure', JSON.stringify({
      hasState: workUnderWay(),
      state: state.bench,
      intro: params.get('intro') !== '0' && !calm && !workUnderWay(),
      calm: calm
    }));
  }

  // A step or warning note stays up for a few seconds before labels for whatever the pointer is
  // over take its place: the pointer is usually still over the box it was just used on, and a
  // warning must be readable.
  var holdNoteUntil = 0;
  var pendingHover = null;
  var hoverTimer = null;

  function note(text, kind, temporary) {
    if (!temporary) {
      persistentNote = { text: text, kind: kind || '' };
      holdNoteUntil = Date.now() + (kind === 'warn' ? 4000 : 2200);
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

  function countText(n, word) { return n + ' ' + word + (n === 1 ? '' : 'es') + ' to go'; }

  // The next thing to do, working down the sheet a row at a time as the handout does.
  function nextStep() {
    var b = state.bench;
    for (var r = 0; r < ROWS; r++) {
      var needRow = 0, needCol = [], needStir = 0, needRecord = 0;
      for (var c = 0; c < COLS; c++) {
        if (M.skipped(r, c)) continue;
        var i = index(r, c);
        if (!b.a[i]) needRow++;
        if (!b.b[i]) needCol.push(c);
        if (b.a[i] && b.b[i] && !b.s[i]) needStir++;
        if (!accepted(r, c)) needRecord++;
      }
      if (needRow) return 'Next: with the ' + rowName(r) + ' pipet, put one drop on each X in the ' + rowName(r) + ' row (' + countText(needRow, 'box') + ').';
      if (needCol.length) return 'Next: add a drop of ' + colName(needCol[0]) + ' to the box under ' + colName(needCol[0]) + ' in the ' + rowName(r) + ' row.';
      if (needStir) return 'Next: pick up the toothpick and stir each box in the ' + rowName(r) + ' row (' + countText(needStir, 'box') + ').';
      if (needRecord) return 'Next: record what you see in each box of the ' + rowName(r) + ' row in Table 1 (' + countText(needRecord, 'box') + '). Click a box on the sheet for a close look.';
    }
    return 'Every box is recorded. Go on to part 2.';
  }

  // The standing note follows the sheet and the table as they fill in. If it is the note on
  // show, the new wording replaces it at once; a warning or a label on show stays until it is done.
  function updateNote() {
    if (!benchReady) return;
    var text = nextStep();
    if (text === persistentNote.text) return;
    var onShow = persistentNote.kind !== 'warn' && $('stage-note').textContent === persistentNote.text;
    persistentNote = { text: text, kind: '' };
    if (onShow) note(text, '', true);
  }

  function setView(view) {
    Array.prototype.forEach.call(document.querySelectorAll('.view-button'), function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-view') === view ? 'true' : 'false');
    });
  }

  function markLooking(row, col) {
    Array.prototype.forEach.call(document.querySelectorAll('.grid-table td.looking'), function (td) { td.classList.remove('looking'); });
    var td = row >= 0 ? $('box-' + key(row, col)) : null;
    if (td) td.classList.add('looking');
  }

  function boxText(e) {
    if (e.skip) return 'The sheet says to skip this box.';
    var name = M.boxName(e.row, e.col);
    if (!e.a && !e.b) return name + ': nothing here yet.';
    if (!e.a || !e.b) return name + ': one drop so far, of ' + (e.a ? rowName(e.row) : colName(e.col)) + '.';
    if (!e.s) return name + ': both drops are in. Stir them with the toothpick.';
    return name + ': stirred. Click for a close look.';
  }

  function belongs(id) {
    var places = [];
    var r = M.ROWS.indexOf(id), c = M.COLUMNS.indexOf(id);
    if (r >= 0) places.push('the ' + nameOf(id) + ' row');
    if (c >= 0) places.push('the ' + nameOf(id) + ' column');
    return places.join(' and ');
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
        if (e.state && Array.isArray(e.state.a)) state.bench = e.state;
        benchReady = true;
        note(nextStep());
        checkGrid();
        break;
      case 'state':
        if (e.state && Array.isArray(e.state.a)) state.bench = e.state;
        saveState();
        checkGrid();
        break;
      case 'checked':
        takeVerdicts(e);
        break;
      case 'hover':
        if (e.item === 'pipet') hoverNote(nameOf(e.id) + ', ' + M.solution(e.id).conc + '. Click to pick it up.');
        else if (e.item === 'toothpick') hoverNote('Toothpick. Click to pick it up, then click a box to stir its two drops.');
        else if (e.item === 'box') hoverNote(boxText(e));
        else hoverNote(null);
        break;
      case 'holding':
        clearTimeout(hoverTimer);
        pendingHover = null;
        if (e.item === 'pipet') note('Holding the ' + nameOf(e.id) + ' pipet. Tap or click a box in ' + belongs(e.id) + ' to put a drop there, or anywhere off the sheet to put the pipet back.', '', true);
        else note('Holding the toothpick. Tap or click a box that has both drops in it to stir them, or anywhere off the sheet to put it back.', '', true);
        break;
      case 'returned':
        note(persistentNote.text, persistentNote.kind, true);
        break;
      case 'dropped':
        note(nextStep());
        break;
      case 'stirred':
        note(M.boxName(e.row, e.col) + ' is stirred. ' + nextStep());
        break;
      case 'blocked':
        if (e.reason === 'skip') note('The sheet says to skip this box.', 'warn');
        else if (e.reason === 'wrong-box') note(nameOf(e.tool) + ' goes in ' + belongs(e.tool) + '. This box is for ' + M.boxName(e.row, e.col) + '.', 'warn');
        else if (e.reason === 'already') note('This box already has its drop of ' + nameOf(e.tool) + '.', 'warn');
        else if (e.reason === 'stir-empty') note('There is nothing in this box to stir yet.', 'warn');
        else if (e.reason === 'stir-half') note('This box still needs its drop of ' + (e.a ? colName(e.col) : rowName(e.row)) + ' before you stir it.', 'warn');
        break;
      case 'look':
        lastLook = e.row + ',' + e.col;
        markLooking(e.row, e.col);
        gridFocus = key(e.row, e.col);
        showGridMessage();
        note('Close-up of ' + M.boxName(e.row, e.col) + (e.a && e.b && e.s ? '. Record what you see in Table 1.' : (e.a && e.b ? '. Stir it before you record it.' : '.')));
        break;
      case 'reset':
        if (e.state && Array.isArray(e.state.a)) state.bench = e.state;
        state.obs = {};
        verdicts = {};
        eachBox(function (r, c) { $('obs-' + key(r, c)).value = ''; });
        markLooking(-1, -1);
        gridFocus = '';
        lastLook = '';
        note('The sheet is clean. ' + nextStep());
        checkGrid();
        break;
      case 'view':        // the camera has set off for this view
        setView(e.view);
        lab.view = e.view;
        lab.viewSettled = false;
        if (e.view !== 'close') markLooking(-1, -1);
        break;
      case 'arrived':     // and has got there
        setView(e.view);
        lab.view = e.view;
        lab.viewSettled = true;
        break;
    }
  }

  // The box the Close-up button goes to: the one last looked at, or else the first with anything in it.
  function closeTarget() {
    if (lastLook) return lastLook;
    var found = '';
    eachBox(function (r, c) {
      var i = index(r, c);
      if (!found && (state.bench.a[i] || state.bench.b[i])) found = r + ',' + c;
    });
    return found || '0,0';
  }

  function bindBenchControls() {
    Array.prototype.forEach.call(document.querySelectorAll('.view-button'), function (button) {
      button.addEventListener('click', function () {
        var view = button.getAttribute('data-view');
        if (view === 'close') sendBench('LookAtBox', closeTarget()); else sendBench('SetView', view);
      });
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
      results = { obs: {}, cations: { ok: null }, anions: { ok: null }, eq: [] };
      gridFocus = '';
      lastLook = '';
      saveState();
      $('start-confirm').hidden = true;
      $('start-over').hidden = false;
      refreshAll();
      configureBench();
      window.scrollTo({ top: 0 });
    });
  }

  // puts everything in the saved work back on the page
  function refreshAll() {
    eachBox(function (r, c) { $('obs-' + key(r, c)).value = state.obs[key(r, c)] || ''; });
    ['cations', 'anions'].forEach(function (kind) {
      (kind === 'cations' ? M.CATIONS : M.ANIONS).forEach(function (ion) { $(kind + '-' + ion).checked = state[kind].indexOf(ion) >= 0; });
    });
    QUESTIONS.forEach(function (q, n) {
      var entry = state.eq[n];
      ['a', 'b', 'c', 'd', 'p1', 'p2'].forEach(function (f) { $('eq-' + n + '-' + f).value = entry[f]; });
      $('eq-' + n + '-p1-shown').textContent = M.pretty(entry.p1);
      $('eq-' + n + '-p2-shown').textContent = M.pretty(entry.p2);
      if (entry.checked) checkEquation(n, false);
      else { results.eq[n] = { ok: null, message: '' }; setState($('eq-' + n), results.eq[n]); $('msg-eq-' + n).textContent = ''; }
    });
    $('student-name').value = state.name;
    markLooking(-1, -1);
    showGrid();
    updateEquationStatus();
  }

  // ---- Wiring for the Unity loader in index.html ---------------------------------------------------

  var lab = window.DoubleLab = {
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

  buildGrid();
  buildIons();
  buildEquations();
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
