/*
 * Density of an Unknown Metal: page logic.
 * Keeps the student's work, draws the graph, checks the worksheet, and talks to the 3D lab (a
 * Unity build in the canvas: a fume hood with the bench inside it). The page does not know which
 * metal a code stands for or what the true readings are. The 3D lab works that out from the code,
 * and the page sends it each recorded reading and shows the verdict that comes back.
 */
(function () {
  'use strict';

  var M = window.DensityLabModel;
  var PIECES = [1, 2, 3, 4, 5];
  var STORE_KEY = 'density-lab:v2';   // v1 work used an older rule for the unknowns
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var params = new URLSearchParams(window.location.search);
  // Automated tests of the page run it without the 3D lab, against a stand-in they supply.
  var standIn = typeof window.DensityLabStandIn === 'function' ? window.DensityLabStandIn : null;

  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (text != null) node.textContent = text;
    return node;
  }
  function svg(tag, attrs, text) {
    var node = document.createElementNS(SVG_NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (text != null) node.textContent = text;
    return node;
  }

  // ---- Saved work ----------------------------------------------------------------------------

  function blankState(code) {
    var rec = {};
    PIECES.forEach(function (n) { rec[n] = { mass: '', volume: '' }; });
    return {
      v: 2,
      code: code || M.randomCode(),
      name: '',
      order: [],
      rec: rec,
      ws: { x1: '', y1: '', x2: '', y2: '', slopeWork: '', slope: '', bWork: '', b: '', equation: '' },
      flags: { readings: 0, worksheet: 0 }
    };
  }

  function loadState() {
    try {
      var saved = JSON.parse(window.localStorage.getItem(STORE_KEY));
      if (!saved || saved.v !== 2 || !M.isCode(saved.code)) return null;
      var fresh = blankState(saved.code);
      PIECES.forEach(function (n) { if (!saved.rec || !saved.rec[n]) saved.rec = fresh.rec; });
      saved.ws = Object.assign(fresh.ws, saved.ws || {});
      saved.flags = Object.assign(fresh.flags, saved.flags || {});
      if (!Array.isArray(saved.order)) saved.order = [];
      return saved;
    } catch (e) {
      return null;
    }
  }

  function saveState() {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* private window: work simply is not kept */ }
  }

  var state = loadState();
  var requested = M.normalizeCode(params.get('code') || '');
  if (requested && M.isCode(requested) && (!state || state.code !== requested)) state = blankState(requested);
  if (!state) state = blankState();

  var graph = null;          // { points, fit, xAxis, yAxis } once the data is complete
  var lastFlagged = {};      // field -> last value that was flagged, so retyping is not counted twice
  var results = { readings: {}, worksheet: {} };

  // ---- Data table ----------------------------------------------------------------------------

  function buildDataRows() {
    var body = $('data-rows');
    PIECES.forEach(function (n) {
      var row = el('tr');
      row.appendChild(el('th', { scope: 'row' }, String(n)));
      ['mass', 'volume'].forEach(function (kind) {
        var cell = el('td');
        var input = el('input', {
          type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false',
          id: kind + '-' + n,
          'aria-label': (kind === 'mass' ? 'Mass of piece ' + n + ' in grams' : 'Cylinder reading after adding piece ' + n + ' in millilitres'),
          'aria-describedby': 'msg-' + kind + '-' + n
        });
        input.value = state.rec[n][kind];
        input.addEventListener('input', function () {
          state.rec[n][kind] = input.value;
          paint(input, $('msg-' + kind + '-' + n), { ok: null, message: '' });
          saveState();
        });
        input.addEventListener('change', function () { checkReadings(kind + '-' + n); });
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') input.blur(); });
        cell.appendChild(input);
        cell.appendChild(el('p', { 'class': 'msg', id: 'msg-' + kind + '-' + n, role: 'status' }));
        row.appendChild(cell);
      });
      body.appendChild(row);
    });
  }

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

  // ---- Checking the readings --------------------------------------------------------------------
  // The page screens each entry itself (empty, not a number, wrong unit). A proper reading goes to
  // the 3D lab, which compares it with the balance or the cylinder and sends back a verdict. Until
  // the verdict for the current entry is in, the entry is shown as neither right nor wrong.

  var verdicts = {};      // field -> { context, verdict }: the 3D lab's last word on that field
  var asked = {};         // request number -> { field: context } for the readings sent with it
  var nextAsk = 1;
  var toCount = {};       // fields the student just finished: count a flag once their result is in

  // A volume verdict depends on the order the pieces went in as well as on what was typed.
  function contextOf(n, kind) {
    var text = state.rec[n][kind];
    return kind === 'mass' ? text : text + '|' + state.order.join(',');
  }

  function readingResult(n, kind) {
    var screened = M.screenReading(kind, state.rec[n][kind]);
    if (!screened.ready) return { ok: screened.ok, message: screened.message };
    var known = verdicts[kind + '-' + n];
    if (!known || known.context !== contextOf(n, kind)) return { ok: null, message: '', waiting: true };
    return M.readingMessage(kind, known.verdict, n);
  }

  // changedField: the input the student just finished, so a wrong entry is counted once.
  function checkReadings(changedField) {
    if (changedField) toCount[changedField] = true;
    showReadings();
    askBench();
  }

  function showReadings() {
    PIECES.forEach(function (n) {
      ['mass', 'volume'].forEach(function (kind) {
        var field = kind + '-' + n;
        var result = readingResult(n, kind);
        results.readings[field] = result;
        paint($(field), $('msg-' + field), result);
        if (toCount[field] && !result.waiting) {
          delete toCount[field];
          countFlag('readings', field, state.rec[n][kind], result);
        }
      });
    });
    saveState();
    updateTableStatus();
    updateGraph();
  }

  function askBench() {
    if (!benchReady) return;
    var id = nextAsk++, sent = {}, readings = [];
    PIECES.forEach(function (n) {
      var row = { piece: n, hasMass: false, mass: 0, massDecimals: 0, hasVolume: false, volume: 0, volumeDecimals: 0 };
      var mass = M.screenReading('mass', state.rec[n].mass), volume = M.screenReading('volume', state.rec[n].volume);
      if (mass.ready) { row.hasMass = true; row.mass = mass.value; row.massDecimals = mass.decimals; sent['mass-' + n] = contextOf(n, 'mass'); }
      if (volume.ready) { row.hasVolume = true; row.volume = volume.value; row.volumeDecimals = volume.decimals; sent['volume-' + n] = contextOf(n, 'volume'); }
      readings.push(row);
    });
    asked[id] = sent;
    sendBench('Check', JSON.stringify({ id: id, readings: readings }));
  }

  function takeVerdicts(e) {
    var sent = asked[e.id];
    delete asked[e.id];
    if (!sent || e.code !== state.code) return;
    (e.rows || []).forEach(function (row) {
      ['mass', 'volume'].forEach(function (kind) {
        var field = kind + '-' + row.piece;
        if (row[kind] && sent[field] !== undefined) verdicts[field] = { context: sent[field], verdict: row[kind] };
      });
    });
    showReadings();
  }

  function readingsAccepted() {
    var okCount = 0;
    Object.keys(results.readings).forEach(function (k) { if (results.readings[k].ok === true) okCount += 1; });
    return okCount;
  }

  function updateTableStatus() {
    var done = readingsAccepted();
    var text = '';
    if (done === 10) text = 'All ten readings are recorded.';
    else if (done > 0) text = done + ' of 10 readings recorded.';
    $('table-status').textContent = text;
  }

  // ---- Graph ---------------------------------------------------------------------------------

  var guides = [];

  function updateGraph() {
    var ready = readingsAccepted() === 10;
    var points = ready ? M.plottedPoints(state.order, state.rec) : null;
    var fit = points ? M.fitLine(points) : null;
    if (!points || !fit) {
      graph = null;
      fillPlottedTable();
      $('graph-area').hidden = true;
      $('graph-locked').hidden = false;
      $('worksheet').disabled = true;
      $('calc-locked').hidden = false;
      checkWorksheet();
      return;
    }
    var xMax = Math.max.apply(null, points.map(function (p) { return p.x; }));
    var yMax = Math.max.apply(null, points.map(function (p) { return p.y; }));
    var next = { points: points, fit: fit, xAxis: M.axisFor(xMax), yAxis: M.axisFor(yMax) };
    var changed = !graph || JSON.stringify(graph.points) !== JSON.stringify(next.points);
    graph = next;
    $('graph-area').hidden = false;
    $('graph-locked').hidden = true;
    $('worksheet').disabled = false;
    $('calc-locked').hidden = true;
    if (changed) {
      guides = [];
      drawGraph();
      fillPlottedTable();
    }
    checkWorksheet();
  }

  var G = { w: 760, h: 560, left: 76, right: 24, top: 60, bottom: 64 };
  function sx(v) { return G.left + v / graph.xAxis.max * (G.w - G.left - G.right); }
  function sy(v) { return G.h - G.bottom - v / graph.yAxis.max * (G.h - G.top - G.bottom); }
  function fmt(v, places) { return M.round(v, places).toFixed(places); }

  function drawGraph() {
    var holder = $('graph-holder');
    holder.textContent = '';
    var root = svg('svg', {
      viewBox: '0 0 ' + G.w + ' ' + G.h, role: 'img',
      'aria-label': 'Graph of total mass of metal against volume of metal, with five recorded points and a straight trendline.'
    });
    var x0 = sx(0), x1 = sx(graph.xAxis.max), y0 = sy(0), y1 = sy(graph.yAxis.max);

    root.appendChild(svg('text', { x: x0, y: 26, 'class': 'graph-title' }, 'Total mass vs. volume of metal'));
    root.appendChild(svg('text', { x: x0, y: 45, 'class': 'graph-subtitle' }, 'Unknown ' + state.code + ', pieces added one at a time to 26.2 mL of water'));
    root.appendChild(svg('rect', { x: x0, y: y1, width: x1 - x0, height: y0 - y1, 'class': 'plot-paper' }));

    var i, v, steps;
    steps = Math.round(graph.xAxis.max / graph.xAxis.minor);
    for (i = 0; i <= steps; i++) {
      v = i * graph.xAxis.minor;
      root.appendChild(svg('line', { x1: sx(v), x2: sx(v), y1: y0, y2: y1, 'class': 'grid-minor' }));
    }
    steps = Math.round(graph.yAxis.max / graph.yAxis.minor);
    for (i = 0; i <= steps; i++) {
      v = i * graph.yAxis.minor;
      root.appendChild(svg('line', { x1: x0, x2: x1, y1: sy(v), y2: sy(v), 'class': 'grid-minor' }));
    }
    steps = Math.round(graph.xAxis.max / graph.xAxis.major);
    for (i = 0; i <= steps; i++) {
      v = i * graph.xAxis.major;
      root.appendChild(svg('line', { x1: sx(v), x2: sx(v), y1: y0, y2: y1, 'class': 'grid-major' }));
      root.appendChild(svg('text', { x: sx(v), y: y0 + 19, 'text-anchor': 'middle', 'class': 'tick-label' }, fmt(v, graph.xAxis.places)));
    }
    steps = Math.round(graph.yAxis.max / graph.yAxis.major);
    for (i = 0; i <= steps; i++) {
      v = i * graph.yAxis.major;
      root.appendChild(svg('line', { x1: x0, x2: x1, y1: sy(v), y2: sy(v), 'class': 'grid-major' }));
      root.appendChild(svg('text', { x: x0 - 9, y: sy(v) + 4.5, 'text-anchor': 'end', 'class': 'tick-label' }, fmt(v, graph.yAxis.places)));
    }
    root.appendChild(svg('rect', { x: x0, y: y1, width: x1 - x0, height: y0 - y1, 'class': 'plot-frame' }));
    root.appendChild(svg('text', { x: (x0 + x1) / 2, y: G.h - 16, 'text-anchor': 'middle', 'class': 'axis-title' }, 'Volume of metal, by difference (mL)'));
    var yTitle = svg('text', { x: 0, y: 0, 'text-anchor': 'middle', 'class': 'axis-title', transform: 'translate(20 ' + (y0 + y1) / 2 + ') rotate(-90)' }, 'Total mass of metal (g)');
    root.appendChild(yTitle);

    var clip = svg('clipPath', { id: 'plot-clip' });
    clip.appendChild(svg('rect', { x: x0, y: y1, width: x1 - x0, height: y0 - y1 }));
    root.appendChild(clip);

    var plot = svg('g', { 'clip-path': 'url(#plot-clip)' });
    plot.appendChild(svg('line', {
      x1: sx(0), y1: sy(graph.fit.intercept),
      x2: sx(graph.xAxis.max), y2: sy(graph.fit.slope * graph.xAxis.max + graph.fit.intercept),
      'class': 'trendline'
    }));
    root.appendChild(plot);

    var guideLayer = svg('g', { id: 'guide-layer' });
    root.appendChild(guideLayer);

    // click anywhere on the plot to drop a guide on the trendline
    var hit = svg('rect', { x: x0, y: y1, width: x1 - x0, height: y0 - y1, 'class': 'plot-hit' });
    hit.addEventListener('click', function (e) {
      var pt = root.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      var local = pt.matrixTransform(root.getScreenCTM().inverse());
      var value = (local.x - x0) / (x1 - x0) * graph.xAxis.max;
      var snapped = Math.round(value / graph.xAxis.minor) * graph.xAxis.minor;
      snapped = Math.min(graph.xAxis.max, Math.max(0, snapped));
      var yv = graph.fit.slope * snapped + graph.fit.intercept;
      if (yv < 0 || yv > graph.yAxis.max) return;
      guides.push(M.round(snapped, 6));
      if (guides.length > 2) guides.shift();
      drawGuides();
    });
    root.appendChild(hit);

    graph.points.forEach(function (p) {
      root.appendChild(svg('circle', { cx: sx(p.x), cy: sy(p.y), r: 5, 'class': 'data-dot' }));
    });
    graph.points.forEach(function (p, index) {
      var target = svg('circle', { cx: sx(p.x), cy: sy(p.y), r: 15, 'class': 'graph-point', tabindex: '0', role: 'img',
        'aria-label': 'After piece ' + p.piece + ': ' + fmt(p.x, 1) + ' millilitres, ' + fmt(p.y, 2) + ' grams' });
      var show = function () { showTip(p, index); };
      target.addEventListener('pointerenter', show);
      target.addEventListener('focus', show);
      target.addEventListener('pointerleave', hideTip);
      target.addEventListener('blur', hideTip);
      root.appendChild(target);
    });

    holder.appendChild(root);
    holder.appendChild(el('div', { 'class': 'graph-tip', id: 'graph-tip', hidden: '' }));
    drawGuides();
  }

  function drawGuides() {
    var layer = document.getElementById('guide-layer');
    if (!layer) return;
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    guides.forEach(function (gx) {
      var gy = graph.fit.slope * gx + graph.fit.intercept;
      layer.appendChild(svg('line', { x1: sx(gx), y1: sy(gy), x2: sx(gx), y2: sy(0), 'class': 'guide-line' }));
      layer.appendChild(svg('line', { x1: sx(gx), y1: sy(gy), x2: sx(0), y2: sy(gy), 'class': 'guide-line' }));
      layer.appendChild(svg('circle', { cx: sx(gx), cy: sy(gy), r: 5.5, 'class': 'guide-dot' }));
    });
    $('clear-guides').hidden = guides.length === 0;
  }

  function showTip(p) {
    var tip = $('graph-tip');
    if (!tip) return;
    tip.textContent = '';
    tip.appendChild(el('strong', null, fmt(p.x, 1) + ' mL, ' + fmt(p.y, 2) + ' g'));
    tip.appendChild(document.createTextNode('after adding piece ' + p.piece));
    tip.style.left = (sx(p.x) / G.w * 100) + '%';
    tip.style.top = (sy(p.y) / G.h * 100) + '%';
    tip.hidden = false;
  }

  function hideTip() {
    var tip = $('graph-tip');
    if (tip) tip.hidden = true;
  }

  function fillPlottedTable() {
    [['plotted-rows', 'piece '], ['plotted-print-rows', '']].forEach(function (target) {
      var body = $(target[0]);
      body.textContent = '';
      if (!graph) return;
      graph.points.forEach(function (p) {
        var row = el('tr');
        row.appendChild(el('td', null, target[1] + p.piece));
        row.appendChild(el('td', null, fmt(p.reading, 1)));
        row.appendChild(el('td', null, fmt(p.x, 1)));
        row.appendChild(el('td', null, fmt(p.y, 2)));
        body.appendChild(row);
      });
    });
  }

  // ---- Worksheet -------------------------------------------------------------------------------

  var WS_FIELDS = {
    'ws-x1': 'x1', 'ws-y1': 'y1', 'ws-x2': 'x2', 'ws-y2': 'y2',
    'ws-slope-work': 'slopeWork', 'ws-slope': 'slope', 'ws-b-work': 'bWork', 'ws-b': 'b', 'ws-equation': 'equation'
  };

  function bindWorksheet() {
    Object.keys(WS_FIELDS).forEach(function (id) {
      var input = $(id), key = WS_FIELDS[id];
      input.value = state.ws[key];
      input.addEventListener('input', function () {
        state.ws[key] = input.value;
        if (input.tagName === 'TEXTAREA') syncPrintCopy(input);
        else input.removeAttribute('data-state');
        saveState();
      });
      if (input.tagName === 'TEXTAREA') {
        var copy = el('div', { 'class': 'print-copy' });
        input.parentNode.insertBefore(copy, input.nextSibling);
        syncPrintCopy(input);
      } else {
        input.addEventListener('change', function () { checkWorksheet(id); });
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') input.blur(); });
      }
    });
  }

  function syncPrintCopy(textarea) {
    var copy = textarea.nextSibling;
    if (copy && copy.className === 'print-copy') copy.textContent = textarea.value;
  }

  function checkWorksheet(changedId) {
    var ws = state.ws;
    var none = { ok: null, message: '' };
    var r = results.worksheet = {};
    if (!graph) {
      r.p1 = r.p2 = r.slope = r.b = r.equation = none;
      updateReportStatus();
      return;
    }
    var p1 = M.checkPoint(graph, ws.x1, ws.y1), p2 = M.checkPoint(graph, ws.x2, ws.y2);
    var pt1 = p1.ok === true ? p1.point : null, pt2 = p2.ok === true ? p2.point : null;
    var spacing = M.checkPointSpacing(graph, pt1, pt2);
    if (spacing.ok === false) { p2.ok = false; p2.message = spacing.message; pt2 = null; }

    paintPoint('1', p1, '');
    paintPoint('2', p2, spacing.ok === true ? spacing.message : '');
    r.p1 = p1; r.p2 = p2;

    r.slope = M.checkSlope(pt1, pt2, ws.slope);
    paint($('ws-slope'), $('msg-slope'), r.slope);
    r.b = M.checkIntercept(pt1, pt2, r.slope.ok === true ? ws.slope : '', ws.b);
    paint($('ws-b'), $('msg-b'), r.b);
    r.equation = M.checkEquation(r.slope.ok === true ? ws.slope : '', r.b.ok === true ? ws.b : '', ws.equation);
    paint($('ws-equation'), $('msg-equation'), r.equation);

    if (changedId) {
      var map = { 'ws-x1': r.p1, 'ws-y1': r.p1, 'ws-x2': r.p2, 'ws-y2': r.p2, 'ws-slope': r.slope, 'ws-b': r.b, 'ws-equation': r.equation };
      if (map[changedId]) countFlag('worksheet', changedId, $(changedId).value, map[changedId]);
    }
    saveState();
    updateReportStatus();
  }

  function paintPoint(which, result, tip) {
    var xInput = $('ws-x' + which), yInput = $('ws-y' + which), msg = $('msg-p' + which);
    var message = result.x.message || result.y.message || result.message || '';
    var xState = result.x.ok, yState = result.y.ok;
    if (result.x.ok === true && result.y.ok === true) xState = yState = result.ok;
    paint(xInput, null, { ok: xState });
    paint(yInput, null, { ok: yState });
    msg.textContent = message || tip || '';
    if (!message && tip) msg.setAttribute('data-kind', 'tip'); else msg.removeAttribute('data-kind');
  }

  function worksheetAccepted() {
    var r = results.worksheet, n = 0;
    ['p1', 'p2', 'slope', 'b', 'equation'].forEach(function (k) { if (r[k] && r[k].ok === true) n += 1; });
    return n;
  }

  // ---- Report ----------------------------------------------------------------------------------

  function updateReportStatus() {
    var readings = readingsAccepted(), sheet = worksheetAccepted();
    var text;
    if (readings === 10 && sheet === 5) text = 'Everything is checked. Add your name, then print or save the report as a PDF.';
    else if (readings < 10) text = 'Still to do: ' + (10 - readings) + ' of the 10 readings in part 1.';
    else text = 'Still to do: ' + (5 - sheet) + ' of the 5 worksheet answers in part 3.';
    $('report-status').textContent = text;

    $('print-name').textContent = 'Name: ' + (state.name || '________________');
    $('print-date').textContent = 'Printed ' + new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    $('print-checks').textContent = 'Checked by the lab page: ' + readings + ' of 10 readings accepted (' + state.flags.readings +
      ' flagged before correction); ' + sheet + ' of 5 worksheet answers accepted (' + state.flags.worksheet + ' flagged before correction).';
  }

  // ---- The 3D bench ----------------------------------------------------------------------------

  var unity = null;
  var unityAwake = false;
  var benchReady = false;     // the 3D lab has set up this student's unknown and can check readings
  var persistentNote = { text: '', kind: '' };

  function sendBench(method, value) {
    if (!unity) return;
    try { unity.SendMessage('Lab', method, value == null ? '' : String(value)); } catch (e) { console.error(e); }
  }

  // A fresh lab opens on the whole fume hood and then moves in to the bench. Someone coming back
  // to work already under way starts at the bench, and ?intro=0 always does. Visitors who ask
  // their system for reduced motion get straight cuts between views and no opening move.
  var calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function workUnderWay() {
    return state.order.length > 0 || PIECES.some(function (n) { return state.rec[n].mass !== '' || state.rec[n].volume !== ''; });
  }

  // The 3D lab makes the five pieces from the code. Once it says "configured", the page sends it
  // the readings, and pieces whose mass is accepted may go straight into the cylinder.
  function configureBench() {
    if (!unity || !unityAwake) return;
    benchReady = false;
    sendBench('Configure', JSON.stringify({
      code: state.code,
      order: state.order,
      intro: params.get('intro') !== '0' && !calm && !workUnderWay(),
      calm: calm
    }));
  }

  function note(text, kind, temporary) {
    if (!temporary) persistentNote = { text: text, kind: kind || '' };
    var node = $('stage-note');
    node.textContent = text;
    if (kind) node.setAttribute('data-kind', kind); else node.removeAttribute('data-kind');
  }

  function listPieces(numbers) {
    if (numbers.length === 1) return 'piece ' + numbers[0];
    return 'pieces ' + numbers.slice(0, -1).join(', ') + ' and ' + numbers[numbers.length - 1];
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
        if (Array.isArray(e.order)) state.order = e.order;
        benchReady = true;
        note(state.order.length === 5 ? 'All five pieces are in the cylinder.' : 'Drag a piece onto the balance to begin.');
        checkReadings();
        break;
      case 'checked':
        takeVerdicts(e);
        break;
      case 'hover':
        if (e.piece) note('Piece ' + e.piece + (e.where === 'pan' ? ', on the balance' : ''), '', true);
        else note(persistentNote.text, persistentNote.kind, true);
        break;
      case 'pan':
        if (e.pieces && e.pieces.length) note('On the balance: ' + listPieces(e.pieces) + '.');
        else note('The balance pan is empty.');
        break;
      case 'blocked':
        note('Find the mass of piece ' + e.piece + ' on the balance before it goes into the water.', 'warn');
        break;
      case 'added':
        state.order = e.order;
        note('Piece ' + e.piece + ' is in the cylinder. Open the cylinder close-up to read the new water level.');
        checkReadings();
        break;
      case 'reset':
        state.order = [];
        PIECES.forEach(function (n) {
          state.rec[n].volume = '';
          $('volume-' + n).value = '';
        });
        note('The bench is reset. The cylinder holds 26.2 mL of water again.');
        checkReadings();
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

  // ---- Start over, name, print -------------------------------------------------------------------

  function bindReport() {
    var name = $('student-name');
    name.value = state.name;
    name.addEventListener('input', function () { state.name = name.value; saveState(); updateReportStatus(); });
    $('print-report').addEventListener('click', function () { window.print(); });
    $('clear-guides').addEventListener('click', function () { guides = []; drawGuides(); });

    var details = document.querySelector('.plotted');
    var wasOpen = false;
    window.addEventListener('beforeprint', function () { wasOpen = details.open; details.open = true; updateReportStatus(); });
    window.addEventListener('afterprint', function () { details.open = wasOpen; });

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
      saveState();
      $('new-confirm').hidden = true;
      $('new-unknown').hidden = false;
      refreshAll();
      configureBench();
      window.scrollTo({ top: 0 });
    });
  }

  function refreshAll() {
    $('unknown-code').textContent = state.code;
    $('initial-volume').textContent = M.INITIAL_ML.toFixed(1);
    PIECES.forEach(function (n) {
      $('mass-' + n).value = state.rec[n].mass;
      $('volume-' + n).value = state.rec[n].volume;
    });
    Object.keys(WS_FIELDS).forEach(function (id) {
      $(id).value = state.ws[WS_FIELDS[id]];
      if ($(id).tagName === 'TEXTAREA') syncPrintCopy($(id));
    });
    $('student-name').value = state.name;
    graph = null;
    checkReadings();
  }

  // ---- Wiring for the Unity loader in index.html ---------------------------------------------------

  var lab = window.DensityLab = {
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

  buildDataRows();
  bindWorksheet();
  bindBenchControls();
  bindReport();
  refreshAll();
  saveState();

  // ---- Stand-in for the 3D lab, supplied by automated tests -------------------------------------

  if (standIn) {
    unity = standIn(onBenchEvent);
    lab.mockAdd = function (piece) { unity.add(piece); };
    onBenchEvent('{"type":"ready"}');
  }
})();
