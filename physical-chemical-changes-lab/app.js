/*
 * Physical and Chemical Changes: page logic.
 * Keeps what the student records and talks to the 3D lab (a Unity build in the canvas: a fume
 * hood with a rack of seven test tubes, the bottles and jars, a stirring rod and a thermometer).
 *
 * The page does not know what any chemical looks like or what happens in any tube. Every entry
 * that can be checked goes to the 3D lab, which answers with a verdict; the page shows it. The
 * descriptions a student writes in their own words are not checked: the instructor reads those.
 */
(function () {
  'use strict';

  var M = window.ChangesLabModel;
  var STORE_KEY = 'physical-chemical-changes-lab:v1';
  var PICTURE_KEY = STORE_KEY + ':picture';
  var params = new URLSearchParams(window.location.search);
  // Automated tests of the page run it without the 3D lab, against a stand-in they supply.
  var standIn = typeof window.ChangesLabStandIn === 'function' ? window.ChangesLabStandIn : null;
  var TUBES = M.TUBES.length;
  var MIN_WORDS = 8;          // characters: a description or an example has to say something

  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (text != null) node.textContent = text;
    return node;
  }

  // ---- Saved work ----------------------------------------------------------------------------

  function blankState() {
    return {
      v: 1,
      name: '',
      bench: null,          // the bench as the 3D lab last reported it; null for a bench not yet touched
      lab: -1,              // the bench clock at the last word from the 3D lab
      picks: {},            // field -> the value chosen or typed (a list of words for a group of ticks)
      checked: {},          // field -> true once its Check button was pressed (groups of ticks only)
      text: {},             // field -> a description or an example in the student's own words
      flags: { before: 0, after: 0, temp: 0, questions: 0 }
    };
  }

  function loadState() {
    try {
      var saved = JSON.parse(window.localStorage.getItem(STORE_KEY));
      if (!saved || saved.v !== 1) return null;
      var fresh = blankState();
      if (!saved.bench || !Array.isArray(saved.bench.a) || saved.bench.a.length !== TUBES) saved.bench = null;
      if (typeof saved.lab !== 'number') saved.lab = -1;
      ['picks', 'checked', 'text'].forEach(function (k) { if (!saved[k] || typeof saved[k] !== 'object') saved[k] = {}; });
      saved.flags = Object.assign(fresh.flags, saved.flags || {});
      if (typeof saved.name !== 'string') saved.name = '';
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
  var results = {};          // field -> { ok, message }
  var seen = [];             // per tube: true once what is in it can be described (from the 3D lab)

  // ---- Fields: every entry the 3D lab can judge ------------------------------------------------
  // id -> { kind, a, b, part, group (which count of flags it belongs to), ticks (a group of tick boxes),
  //         tube (the tube whose progress the verdict depends on, or -1), node (what shows right or wrong), msg }

  var FIELDS = {};
  var ORDER = [];

  function field(id, spec) {
    spec.id = id;
    FIELDS[id] = spec;
    ORDER.push(id);
    return spec;
  }

  function valueOf(id) {
    var v = state.picks[id];
    if (FIELDS[id].ticks) return Array.isArray(v) ? FIELDS[id].options.map(function (o) { return o.value; }).filter(function (o) { return v.indexOf(o) >= 0; }).join(',') : '';
    return v == null ? '' : String(v);
  }

  // A verdict belongs to the value it was given for and to how far the tube had got at the time.
  function contextOf(id) {
    var f = FIELDS[id], t = f.tube;
    var bench = state.bench, stage = '';
    if (t >= 0) stage = (M.mixed(bench, t) ? 'm' : '') + (M.stirred(bench, t) ? 's' : '') + (seen[t] ? 'v' : '') + (f.kind === 'temp' ? ':' + (bench && bench.maxTemp ? Math.round(bench.maxTemp[t] * 2) : 0) : '');
    return valueOf(id) + '|' + stage;
  }

  var verdicts = {};      // field -> { context, verdict }
  var asked = {};         // request number -> { field: context }
  var nextAsk = 1;
  var toCount = {};       // fields the student just entered: count a flag once the result is in

  function resultOf(id) {
    var f = FIELDS[id], value = valueOf(id);
    if (!value) return { ok: null, message: '' };
    if (f.ticks && !state.checked[id]) return { ok: null, message: '' };
    if (f.kind === 'temp' && M.parseTemp(value) === null) return { ok: false, message: 'Enter the temperature as the thermometer shows it, such as 21.8.', format: true };
    var known = verdicts[id];
    if (!known || known.context !== contextOf(id)) return { ok: null, message: '', waiting: true };
    var why = known.verdict === 'notyet' ? whyNotYet(f) : '';
    return M.message(f.kind, known.verdict, f.part, why);
  }

  function whyNotYet(f) {
    if (f.kind === 'temp') {
      return M.mixed(state.bench, f.tube) ? 'Stand the thermometer in tube ' + (f.tube + 1) + ' and watch it for a few seconds.' : 'Put both into tube ' + (f.tube + 1) + ' first.';
    }
    return M.notYet(state.bench, seen, f.tube);
  }

  function show(id) {
    var f = FIELDS[id], result = resultOf(id);
    results[id] = result;
    var name = result.ok === true ? 'ok' : (result.ok === false ? 'bad' : '');
    if (name) f.node.setAttribute('data-state', name); else f.node.removeAttribute('data-state');
    if (toCount[id] && !result.waiting) {
      delete toCount[id];
      if (result.ok === false && !result.format && lastFlagged[id] !== valueOf(id)) {
        lastFlagged[id] = valueOf(id);
        state.flags[f.group] += 1;
      }
    }
  }

  // Messages are shown once for each block (a chemical, a tube, a question), not under every list.
  var BLOCKS = [];        // { msg, ids }
  function block(msg, ids) { BLOCKS.push({ msg: msg, ids: ids }); }

  function showAll() {
    ORDER.forEach(show);
    BLOCKS.forEach(function (b) {
      var bad = b.ids.filter(function (id) { return results[id].ok === false; })[0];
      var tip = b.ids.filter(function (id) { return results[id].ok === null && results[id].message; })[0];
      var pick = bad || tip;
      b.msg.textContent = pick ? results[pick].message : '';
      if (bad) b.msg.removeAttribute('data-kind'); else b.msg.setAttribute('data-kind', 'tip');
    });
    saveState();
    updateReportStatus();
    updateNote();
  }

  function itemFor(id) {
    var f = FIELDS[id], value = valueOf(id);
    var item = { field: id, kind: f.kind, a: f.a, b: f.b || 0, part: f.part || '', text: value, value: 0 };
    if (f.kind === 'temp') { item.value = M.parseTemp(value); item.text = ''; }
    return item;
  }

  // Sends to the 3D lab every entry whose verdict is missing or out of date.
  function askBench(only) {
    var sent = {}, items = [];
    (only || ORDER).forEach(function (id) {
      var f = FIELDS[id], value = valueOf(id);
      if (!value) return;
      if (f.ticks && !state.checked[id]) return;
      if (f.kind === 'temp' && M.parseTemp(value) === null) return;
      var context = contextOf(id);
      if (verdicts[id] && verdicts[id].context === context) return;
      items.push(itemFor(id));
      sent[id] = context;
    });
    showAll();
    if (!items.length || !benchReady) return;
    var id = nextAsk++;
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
    showAll();
  }

  // ---- Building the entries ----------------------------------------------------------------------

  function select(id, options, label) {
    var node = el('select', { id: id, 'aria-label': label });
    node.appendChild(el('option', { value: '' }, '–'));
    options.forEach(function (o) { node.appendChild(el('option', { value: o.value }, o.text)); });
    node.addEventListener('change', function () {
      if (node.value) state.picks[id] = node.value; else delete state.picks[id];
      toCount[id] = true;
      askBench([id]);
    });
    return node;
  }

  function labelled(name, control) {
    var wrap = el('label', { 'class': 'field pick' });
    wrap.appendChild(el('span', { 'class': 'field-name' }, name));
    wrap.appendChild(control);
    return wrap;
  }

  // A group of tick boxes with its own Check button: it is judged when the button is pressed, and
  // goes back to unjudged as soon as a tick is changed.
  function ticks(id, options, label) {
    var group = el('div', { 'class': 'ticks', id: id, role: 'group', 'aria-label': label });
    options.forEach(function (o) {
      var item = el('label', { 'class': 'tick' });
      var input = el('input', { type: 'checkbox', id: id + '-' + o.value, value: o.value });
      input.addEventListener('change', function () {
        var list = Array.isArray(state.picks[id]) ? state.picks[id] : (state.picks[id] = []);
        var at = list.indexOf(o.value);
        if (input.checked && at < 0) list.push(o.value);
        if (!input.checked && at >= 0) list.splice(at, 1);
        delete state.checked[id];
        showAll();
      });
      item.appendChild(input);
      item.appendChild(el('span', null, o.text));
      group.appendChild(item);
    });
    var button = el('button', { type: 'button', 'class': 'quiet-button tick-check', id: id + '-check' }, 'Check');
    button.addEventListener('click', function () {
      if (!valueOf(id)) return;
      state.checked[id] = true;
      toCount[id] = true;
      askBench([id]);
    });
    group.appendChild(button);
    return group;
  }

  function words(id, label, rows) {
    var wrap = el('label', { 'class': 'field words' });
    wrap.appendChild(el('span', { 'class': 'field-name' }, label));
    var box = el('textarea', { id: id, rows: String(rows || 2) });
    box.addEventListener('input', function () {
      state.text[id] = box.value;
      copy.textContent = box.value;
      saveState();
      updateReportStatus();
    });
    var copy = el('div', { 'class': 'print-copy' });
    wrap.appendChild(box);
    wrap.appendChild(copy);
    return wrap;
  }

  function tempInput(id, label) {
    var input = el('input', { type: 'text', id: id, inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', placeholder: '°C', 'aria-label': label });
    input.addEventListener('input', function () {
      if (input.value.trim()) state.picks[id] = input.value; else delete state.picks[id];
      input.removeAttribute('data-state');
      saveState();
    });
    function done() { toCount[id] = true; askBench([id]); }
    input.addEventListener('change', done);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') done(); });
    return input;
  }

  function buildCards() {
    for (var t = 0; t < TUBES; t++) {
      var tube = M.TUBES[t], n = t + 1;
      var card = el('article', { 'class': 'tube-card', id: 'tube-' + t });
      var head = el('h3', { 'class': 'tube-head' });
      head.appendChild(el('span', { 'class': 'tube-number' }, 'Tube ' + n));
      head.appendChild(document.createTextNode(M.tubeTitle(t)));
      var look = el('button', { type: 'button', 'class': 'link-button look-button', 'data-look': 'tube,' + t }, 'Look at tube ' + n);
      head.appendChild(look);
      card.appendChild(head);

      // before mixing: one block for each of the two
      card.appendChild(el('p', { 'class': 'card-label' }, 'Before mixing'));
      for (var slot = 0; slot < 2; slot++) {
        var r = M.pairIndex(t, slot), base = 'b-' + t + '-' + slot;
        var part = el('div', { 'class': 'before-block' });
        var title = el('p', { 'class': 'chemical' });
        title.appendChild(el('strong', null, M.reagentLabel(r)));
        var see = el('button', { type: 'button', 'class': 'link-button look-button', 'data-look': 'reagent,' + r }, 'look');
        title.appendChild(see);
        part.appendChild(title);
        var picks = el('div', { 'class': 'pick-row' });
        var ids = [];
        [['state', 'State', M.STATES], ['color', 'Color', M.COLORS], ['look', 'It looks', M.LOOKS_BEFORE]].forEach(function (p) {
          var id = base + '-' + p[0];
          var node = select(id, p[2], p[1] + ' of ' + M.REAGENTS[r].name + ' before mixing, tube ' + n);
          field(id, { kind: 'before', a: r, part: p[0], group: 'before', tube: -1, node: node });
          picks.appendChild(labelled(p[1], node));
          ids.push(id);
        });
        part.appendChild(picks);
        var msg = el('p', { 'class': 'msg', role: 'status' });
        part.appendChild(msg);
        block(msg, ids);
        card.appendChild(part);
      }

      // after mixing
      card.appendChild(el('p', { 'class': 'card-label' }, tube.stir ? 'After mixing and stirring' : 'After mixing'));
      var after = el('div', { 'class': 'after-block' }), afterIds = [];
      var statesId = 'a-' + t + '-states';
      var group = ticks(statesId, M.STATES, 'What is in tube ' + n + ' after mixing');
      field(statesId, { kind: 'after', a: t, part: 'states', group: 'after', tube: t, ticks: true, options: M.STATES, node: group });
      var statesWrap = el('div', { 'class': 'field pick' });
      statesWrap.appendChild(el('span', { 'class': 'field-name' }, 'In the tube now (tick all that apply)'));
      statesWrap.appendChild(group);
      after.appendChild(statesWrap);
      afterIds.push(statesId);
      var afterPicks = el('div', { 'class': 'pick-row' });
      [['color', 'Color of the liquid', M.COLORS], ['look', 'It looks', M.LOOKS_AFTER]].forEach(function (p) {
        var id = 'a-' + t + '-' + p[0];
        var node = select(id, p[2], p[1] + ' in tube ' + n + ' after mixing');
        field(id, { kind: 'after', a: t, part: p[0], group: 'after', tube: t, node: node });
        afterPicks.appendChild(labelled(p[1], node));
        afterIds.push(id);
      });
      after.appendChild(afterPicks);
      after.appendChild(words('a-' + t + '-words', 'Everything you saw, in your own words', 3));
      var afterMsg = el('p', { 'class': 'msg', role: 'status' });
      after.appendChild(afterMsg);
      block(afterMsg, afterIds);
      card.appendChild(after);

      // the thermometer, for the four tubes of Table 1
      if (tube.table === 1) {
        var temps = el('div', { 'class': 'temp-block' }), tempIds = [];
        [['0', 'Thermometer before mixing', 'before'], ['1', 'Highest after mixing', 'after']].forEach(function (p) {
          var id = 't-' + t + '-' + p[0];
          var input = tempInput(id, p[1] + ', tube ' + n + ', in degrees Celsius');
          field(id, { kind: 'temp', a: t, b: +p[0], part: p[2], group: 'temp', tube: p[0] === '1' ? t : -1, node: input });
          var wrap = labelled(p[1], input);
          wrap.classList.add('temp');
          temps.appendChild(wrap);
          tempIds.push(id);
        });
        var tempMsg = el('p', { 'class': 'msg', role: 'status' });
        temps.appendChild(tempMsg);
        block(tempMsg, tempIds);
        card.appendChild(temps);
      }
      $('cards-' + tube.table).appendChild(card);
    }
  }

  function buildQuestions() {
    // 1: the kinds of evidence, for the four mixtures of Table 1
    var evidence = $('evidence-rows');
    for (var t = 0; t < 4; t++) {
      var id = 'e-' + t;
      var row = el('div', { 'class': 'evidence-row' });
      row.appendChild(el('p', { 'class': 'evidence-name' }, 'Tube ' + (t + 1) + ': ' + M.tubeTitle(t)));
      var group = ticks(id, M.EVIDENCE, 'Evidence of a chemical change in tube ' + (t + 1));
      field(id, { kind: 'evidence', a: t, group: 'questions', tube: t, ticks: true, options: M.EVIDENCE, node: group });
      row.appendChild(group);
      var msg = el('p', { 'class': 'msg', role: 'status' });
      row.appendChild(msg);
      block(msg, [id]);
      evidence.appendChild(row);
    }
    // 2: homogeneous or heterogeneous, for the three mixtures of Table 2
    var mixtures = $('mixture-rows');
    for (var u = 4; u < TUBES; u++) pickRow(mixtures, 'm-' + u, 'Tube ' + (u + 1) + ': ' + M.tubeTitle(u), M.MIXTURES, { kind: 'mixture', a: u, group: 'questions', tube: u });
    // 3: the nine everyday events
    var events = $('event-rows');
    M.EVENTS.forEach(function (text, i) { pickRow(events, 'v-' + i, text, M.CHANGES, { kind: 'event', a: i, group: 'questions', tube: -1 }); });

    ['own-chemical', 'own-physical'].forEach(function (id) {
      var box = $(id), copy = el('div', { 'class': 'print-copy' });
      box.parentNode.insertBefore(copy, box.nextSibling);
      box.addEventListener('input', function () { state.text[id] = box.value; copy.textContent = box.value; saveState(); updateReportStatus(); });
    });
  }

  function pickRow(holder, id, text, options, spec) {
    var row = el('div', { 'class': 'pick-line' });
    row.appendChild(el('label', { 'for': id }, text));
    var node = select(id, options, text);
    spec.node = node;
    field(id, spec);
    row.appendChild(node);
    var msg = el('p', { 'class': 'msg', role: 'status' });
    row.appendChild(msg);
    block(msg, [id]);
    holder.appendChild(row);
  }

  // puts everything in the saved work back on the page
  function refreshAll() {
    ORDER.forEach(function (id) {
      var f = FIELDS[id], v = state.picks[id];
      if (f.ticks) f.options.forEach(function (o) { $(id + '-' + o.value).checked = Array.isArray(v) && v.indexOf(o.value) >= 0; });
      else f.node.value = v == null ? '' : v;
    });
    Array.prototype.forEach.call(document.querySelectorAll('textarea'), function (box) {
      box.value = state.text[box.id] || '';
      var copy = box.nextSibling;
      if (copy && copy.className === 'print-copy') copy.textContent = box.value;
    });
    $('student-name').value = state.name;
    showPicture(loadPicture());
    showAll();
    showRun();
  }

  // ---- The picture of the tubes -----------------------------------------------------------------------
  // The 3D lab photographs the rack from the front. It is kept beside the saved work so that it
  // is there to print after a reload.

  function showPicture(picture) {
    var img = $('strips-img'), has = !!(picture && picture.image && (picture.mixed || []).some(Boolean));
    img.hidden = !has;
    $('strips-caption').hidden = !has;
    if (!has) { img.removeAttribute('src'); return; }
    img.src = picture.image;
    img.alt = 'Photograph of your seven test tubes in their rack, seen from the front.';
    var done = picture.mixed.filter(Boolean).length;
    $('strips-caption').textContent = 'Your tubes as they are now, 1 to 7 from the left' + (done < TUBES ? ' (' + done + ' of 7 mixed so far).' : '.') + ' This picture is printed with your report.';
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
  var pictureTimer = null;
  // a little after the last change, so that a liquid being poured has reached its level
  function askPicture(delay) {
    clearTimeout(pictureTimer);
    pictureTimer = setTimeout(function () {
      if (benchReady && state.bench && state.bench.a.some(Boolean)) sendBench('Snapshot', '');
    }, delay == null ? 1500 : delay);
  }

  // ---- Report ------------------------------------------------------------------------------------

  function counts(group) {
    var ids = ORDER.filter(function (id) { return FIELDS[id].group === group; });
    return { done: ids.filter(function (id) { return results[id] && results[id].ok === true; }).length, all: ids.length };
  }
  function wordsMissing() {
    var n = 0;
    Array.prototype.forEach.call(document.querySelectorAll('textarea'), function (box) { if (box.value.trim().length < MIN_WORDS) n++; });
    return n;
  }

  function updateReportStatus() {
    if (!$('report-status')) return;
    var before = counts('before'), after = counts('after'), temp = counts('temp'), questions = counts('questions');
    var mixedTubes = 0;
    for (var t = 0; t < TUBES; t++) if (M.mixed(state.bench, t)) mixedTubes++;
    var missing = wordsMissing(), text;
    if (mixedTubes < TUBES) text = 'Still to do: ' + (TUBES - mixedTubes) + ' of the 7 tubes on the bench.';
    else if (before.done < before.all) text = 'Still to do: ' + (before.all - before.done) + ' of the ' + before.all + ' "before mixing" entries in Tables 1 and 2.';
    else if (after.done < after.all) text = 'Still to do: ' + (after.all - after.done) + ' of the ' + after.all + ' "after mixing" entries in Tables 1 and 2.';
    else if (temp.done < temp.all) text = 'Still to do: ' + (temp.all - temp.done) + ' of the ' + temp.all + ' thermometer readings in Table 1.';
    else if (questions.done < questions.all) text = 'Still to do: ' + (questions.all - questions.done) + ' of the ' + questions.all + ' answers in questions 1 to 3 of part 4.';
    else if (missing) text = 'Still to do: ' + missing + (missing === 1 ? ' box' : ' boxes') + ' to fill in with your own words (the descriptions, and questions 4 and 5).';
    else text = 'Everything is filled in. Add your name, then print or save the report as a PDF.';
    $('report-status').textContent = text;

    $('print-name').textContent = 'Name: ' + (state.name || '________________');
    $('print-date').textContent = 'Printed ' + new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    $('print-checks').textContent = 'Checked by the lab page: ' + before.done + ' of ' + before.all + ' "before mixing" entries accepted (' + state.flags.before +
      ' flagged before correction); ' + after.done + ' of ' + after.all + ' "after mixing" entries accepted (' + state.flags.after + ' flagged before correction); ' +
      temp.done + ' of ' + temp.all + ' thermometer readings accepted (' + state.flags.temp + ' flagged before correction); ' +
      questions.done + ' of ' + questions.all + ' answers to questions 1 to 3 accepted (' + state.flags.questions + ' flagged before correction). ' +
      'The descriptions in the student\'s own words, and questions 4 and 5, are not checked by the page.';
  }

  // ---- The 3D bench ----------------------------------------------------------------------------

  var unity = null;
  var unityAwake = false;
  var benchReady = false;     // the 3D lab has set out the bench and can check entries
  var persistentNote = { text: '', kind: '' };
  var clock = { fast: false, waiting: false, thermo: -1, temp: null };
  var lastSaved = 0;
  var lastLook = 'tube,0';    // what the Close-up button goes back to
  var justUsed = -1;          // the tube something was just done to, while the pointer is still over it

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
    return !!b && (b.a.some(Boolean) || b.b.some(Boolean));
  }

  function configureBench() {
    if (!unity || !unityAwake) return;
    benchReady = false;
    sendBench('Configure', JSON.stringify({
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
  var lastStep = '';

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

  function nextStep() {
    return M.nextStep(state.bench || { a: [], b: [], stirred: [], maxTemp: [], thermo: -1 }, seen);
  }

  // The standing note follows the bench as work goes on. When the next step changes, its new
  // wording replaces the note on show at once; a warning or a label on show stays until it is done.
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

  // The line under the bench: what the thermometer shows, and where it is.
  function showRun() {
    var text = '';
    if (clock.temp !== null && benchReady) {
      text = 'Thermometer: ' + Number(clock.temp).toFixed(1) + ' °C' + (clock.thermo >= 0 ? ', standing in tube ' + (clock.thermo + 1) : ', lying on the towel');
    }
    $('run-status').textContent = text;
    var button = $('speed-up');
    button.disabled = !clock.waiting;
    button.setAttribute('aria-pressed', clock.fast ? 'true' : 'false');
    button.textContent = clock.fast ? 'Back to real time' : 'Speed up the wait';
  }

  function takeBench(bench) {
    if (!bench || !Array.isArray(bench.a)) return;
    state.bench = bench;
    state.lab = bench.lab;
  }

  function nameOf(i) { return M.REAGENTS[i].name; }
  function toolOf(i) {
    var r = M.REAGENTS[i];
    if (r.tool === 'forceps') return 'the forceps with a piece of ' + r.name;
    if (r.tool === 'spatula') return 'the spatula with ' + r.name + ' on it';
    if (r.tool === 'pipet') return 'the pipet from the beaker of water';
    return 'the ' + r.name + ' dropper';
  }

  function tubeText(e) {
    var n = e.n + 1, t = M.TUBES[e.n];
    var what;
    if (!e.a && !e.b) what = 'empty';
    else if (e.a && e.b) what = nameOf(M.pairIndex(e.n, 0)) + ' and ' + nameOf(M.pairIndex(e.n, 1)) + (t.stir ? (e.stirred ? ', stirred' : ', not stirred yet') : '');
    else what = nameOf(M.pairIndex(e.n, e.a ? 0 : 1)) + ' so far';
    return 'Tube ' + n + ': ' + what + '. Click for a close look.';
  }

  function hoverText(e) {
    switch (e.item) {
      case 'reagent':
        return M.reagentLabel(e.n).replace(/^./, function (c) { return c.toUpperCase(); }) + '. Click to pick up its ' + M.REAGENTS[e.n].tool + ', then click a tube.';
      case 'rod':
        return 'Stirring rod. Click to pick it up, then click tube 5, 6 or 7 to stir it.';
      case 'thermometer':
        return e.n >= 0 ? 'Thermometer, standing in tube ' + (e.n + 1) + '. Click to pick it up.' : 'Thermometer. Click to pick it up, then click a tube to stand it in.';
      case 'tube':
        return tubeText(e);
      case 'name':
        return M.reagentLabel(e.n) + '. Click its name for a close look.';
    }
    return null;
  }

  function holdingText(e) {
    switch (e.item) {
      case 'reagent':
        return 'Holding ' + toolOf(e.n) + '. Tap or click the tube it goes into, or anywhere else to put it back.';
      case 'rod':
        return 'Holding the stirring rod. Tap or click tube 5, 6 or 7 to stir it, or anywhere else to put the rod back.';
      case 'thermometer':
        return 'Holding the thermometer. Tap or click a tube to stand it in, or anywhere else to put it back on the towel.';
    }
    return '';
  }

  function tubesFor(reagent) {
    var list = [];
    M.TUBES.forEach(function (t, i) { if (M.reagentIndex(t.pair[0]) === reagent || M.reagentIndex(t.pair[1]) === reagent) list.push(i + 1); });
    return list.length > 1 ? 'tubes ' + list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1] : 'tube ' + list[0];
  }

  function blockedText(e) {
    var n = e.tube + 1;
    switch (e.reason) {
      case 'wrong-tube':
        return 'Not in tube ' + n + ': ' + nameOf(e.reagent) + ' goes into ' + tubesFor(e.reagent) + '.';
      case 'already':
        return 'Tube ' + n + ' already has its ' + nameOf(e.reagent) + '.';
      case 'no-stir':
        return 'Tube ' + n + ' is not stirred. Only tubes 5, 6 and 7 are.' + (e.tube === 0 ? ' Tube 1 must be left alone while it changes.' : '');
      case 'stir-early':
        return 'Put both things into tube ' + n + ' before you stir it.';
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
        takeBench(e.state);
        benchReady = true;
        saveState();
        askBench();
        note(nextStep());
        askPicture(600);
        showRun();
        break;
      case 'state':
        takeBench(e.state);
        saveState();
        askBench();
        askPicture();
        showRun();
        break;
      case 'tick':
        clock = { fast: !!e.fast, waiting: !!e.waiting, thermo: e.thermo, temp: e.temp };
        state.lab = e.lab;
        if (state.bench) state.bench.lab = e.lab;
        var changed = JSON.stringify(e.seen || []) !== JSON.stringify(seen), warmer = false;
        seen = e.seen || seen;
        // the highest the thermometer has shown in each tube goes up while it stands there
        if (state.bench && Array.isArray(e.max) && JSON.stringify(e.max) !== JSON.stringify(state.bench.maxTemp)) {
          state.bench.maxTemp = e.max;
          warmer = true;
        }
        // the clock runs on while the page is open: keep where it has got to, every couple of seconds
        if (Date.now() - lastSaved > 2000) { lastSaved = Date.now(); saveState(); }
        showRun();
        if (changed || warmer) askBench(); else updateNote();
        if (changed) askPicture(300);
        break;
      case 'checked':
        takeVerdicts(e);
        break;
      case 'strips':
        keepPicture({ mixed: e.mixed, image: e.image });
        break;
      case 'hover':
        // The pointer is still over the tube that was just used: the next step stays up, and the
        // tube's label waits until the pointer has been somewhere else.
        if (e.item === 'tube' && e.n === justUsed) break;
        justUsed = -1;
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
      case 'added':
      case 'stirred':
      case 'probe':
        justUsed = e.tube;
        note(nextStep());
        break;
      case 'blocked':
        note(blockedText(e), 'warn');
        break;
      case 'look':
        lastLook = e.what + ',' + e.n;
        break;
      case 'reset':
        takeBench(e.state);
        verdicts = {};
        seen = [];
        keepPicture(null);
        askBench();
        note('The tubes are clean and back in the rack. ' + nextStep());
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
      button.addEventListener('click', function () {
        var view = button.getAttribute('data-view');
        if (view === 'close') sendBench('LookClosely', lastLook); else sendBench('SetView', view);
      });
    });
    // "Look at tube 3" beside a card, "look" beside a chemical: the camera goes there, and the page scrolls up to the bench
    document.addEventListener('click', function (e) {
      var button = e.target.closest ? e.target.closest('[data-look]') : null;
      if (!button) return;
      sendBench('LookClosely', button.getAttribute('data-look'));
      var stage = $('stage').getBoundingClientRect();
      if (stage.bottom < 80 || stage.top > window.innerHeight - 80) $('stage').scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' });
    });
    $('speed-up').addEventListener('click', function () { sendBench('SetSpeed', clock.fast ? '1' : '40'); });
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

  // ---- Name, print, start over -------------------------------------------------------------------

  function bindReport() {
    var nameInput = $('student-name');
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
      toCount = {};
      seen = [];
      clock = { fast: false, waiting: false, thermo: -1, temp: null };
      saveState();
      keepPicture(null);
      $('start-confirm').hidden = true;
      $('start-over').hidden = false;
      refreshAll();
      configureBench();
      window.scrollTo({ top: 0 });
    });
  }

  // ---- Wiring for the Unity loader in index.html ---------------------------------------------------

  var lab = window.ChangesLab = {
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

  buildCards();
  buildQuestions();
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
