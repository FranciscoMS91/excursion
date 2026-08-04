/* Arranque y conexión entre panel de control, mapa e itinerario. */
(function (BTP) {
  'use strict';

  var U = BTP.util, $ = U.$, $$ = U.$$;
  var S = BTP.store.state.settings;
  var plan = null;
  var toastTimer = null;

  /* --- Avisos ----------------------------------------------------------- */

  function toast(msg, ms) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 3500);
  }

  function topStatus(msg) { $('#top-status').textContent = msg || ''; }

  /* --- Enlace formulario <-> ajustes ------------------------------------ */

  function bindInput(id, key, type, after) {
    var node = $('#' + id);
    if (!node) return;
    if (type === 'check') node.checked = !!S[key];
    else node.value = S[key] == null ? '' : S[key];

    var evt = (node.type === 'range') ? 'input' : 'change';
    node.addEventListener(evt, function () {
      if (type === 'check') S[key] = node.checked;
      else if (type === 'number') S[key] = node.value === '' ? 0 : Number(node.value);
      else S[key] = node.value;
      BTP.store.saveSettings();
      if (after) after();
    });
    if (node.type === 'range') node.addEventListener('input', function () { if (after) after(); });
  }

  function rangeLabel(id, fmt) {
    var node = $('#' + id), out = $('#' + id + '-val');
    if (!node || !out) return;
    var update = function () { out.textContent = fmt ? fmt(node.value) : node.value; };
    node.addEventListener('input', update);
    update();
  }

  function bindForm() {
    $('#origin').value = S.originText || '';
    $('#dest').value = S.destText || '';

    bindInput('startDate', 'startDate');
    bindInput('days', 'days', 'number');
    bindInput('dayStart', 'dayStart');
    bindInput('dayEnd', 'dayEnd');
    bindInput('defaultVisitMin', 'defaultVisitMin', 'number');
    bindInput('lunchMin', 'lunchMin', 'number');
    bindInput('lunchStart', 'lunchStart');
    bindInput('returnToOrigin', 'returnToOrigin', 'check');
    bindInput('destIsStop', 'destIsStop', 'check');
    bindInput('filterMinPriority', 'filterMinPriority', 'number');
    bindInput('filterNotVisitedDays', 'filterNotVisitedDays', 'number');
    bindInput('filterIndustry', 'filterIndustry');
    bindInput('filterTag', 'filterTag');
    bindInput('maxCandidates', 'maxCandidates', 'number');
    bindInput('useOsrm', 'useOsrm', 'check');
    bindInput('speedKmh', 'speedKmh', 'number');
    bindInput('detour', 'detour', 'number');
    bindInput('radius', 'radiusKm', 'number', drawZone);
    bindInput('corridor', 'corridorKm', 'number', drawZone);
    bindInput('wPriority', 'wPriority', 'number');
    bindInput('wValue', 'wValue', 'number');
    bindInput('wRecency', 'wRecency', 'number');
    bindInput('prospectBias', 'prospectBias', 'number');

    rangeLabel('radius');
    rangeLabel('corridor');
    rangeLabel('wPriority');
    rangeLabel('wValue');
    rangeLabel('wRecency');
    rangeLabel('prospectBias', function (v) {
      var n = Number(v);
      if (n <= -0.6) return 'fidelizar clientes';
      if (n < -0.15) return 'más clientes';
      if (n <= 0.15) return 'equilibrado';
      if (n < 0.6) return 'más prospectos';
      return 'captar prospectos';
    });

    // Tipos de cliente a incluir
    $$('.f-type').forEach(function (cb) {
      cb.checked = (S.filterTypes || []).indexOf(cb.value) >= 0;
      cb.addEventListener('change', function () {
        S.filterTypes = $$('.f-type').filter(function (x) { return x.checked; })
          .map(function (x) { return x.value; });
        BTP.store.saveSettings();
      });
    });

    // Modo destino / corredor
    $$('#mode button').forEach(function (btn) {
      if (btn.getAttribute('data-mode') === S.mode) btn.classList.add('active');
      else btn.classList.remove('active');
      btn.addEventListener('click', function () {
        S.mode = btn.getAttribute('data-mode');
        BTP.store.saveSettings();
        $$('#mode button').forEach(function (b) { b.classList.toggle('active', b === btn); });
        $('#radius-field').classList.toggle('hidden', S.mode !== 'destino');
        $('#corridor-field').classList.toggle('hidden', S.mode !== 'corredor');
        drawZone();
      });
    });
    $('#radius-field').classList.toggle('hidden', S.mode !== 'destino');
    $('#corridor-field').classList.toggle('hidden', S.mode !== 'corredor');

    var reDraw = U.debounce(function () { resolvePoint('origin').then(drawZone); }, 900);
    $('#origin').addEventListener('change', reDraw);
    $('#dest').addEventListener('change', U.debounce(function () {
      resolvePoint('dest').then(function (p) {
        drawZone();
        if (p) BTP.map.flyTo(p.lat, p.lng, 9);
      });
    }, 500));

    $('#btn-gps').addEventListener('click', useGeolocation);
  }

  /* --- Geocodificación de origen y destino ------------------------------ */

  function point(kind) {
    var lat = S[kind + 'Lat'], lng = S[kind + 'Lng'];
    if (lat == null || lng == null) return null;
    return { name: S[kind + 'Text'] || (kind === 'origin' ? 'Origen' : 'Destino'), lat: lat, lng: lng };
  }

  function resolvePoint(kind) {
    var input = $('#' + (kind === 'origin' ? 'origin' : 'dest'));
    var status = $('#' + (kind === 'origin' ? 'origin' : 'dest') + '-status');
    var text = input.value.trim();
    if (!text) {
      S[kind + 'Text'] = ''; S[kind + 'Lat'] = null; S[kind + 'Lng'] = null;
      BTP.store.saveSettings();
      status.textContent = '';
      return Promise.resolve(null);
    }
    if (S[kind + 'Text'] === text && S[kind + 'Lat'] != null) return Promise.resolve(point(kind));

    var direct = coordsFromText(text, kind);
    if (direct) {
      status.textContent = '✓ Coordenadas introducidas directamente';
      return Promise.resolve(direct);
    }

    status.textContent = 'Buscando dirección…';
    return BTP.geocode.geocodeStrict(text).then(function (hit) {
      if (!hit) {
        status.textContent = '⚠ No encontrada. Prueba con «calle, ciudad».';
        S[kind + 'Lat'] = null; S[kind + 'Lng'] = null;
        BTP.store.saveSettings();
        return null;
      }
      S[kind + 'Text'] = text; S[kind + 'Lat'] = hit.lat; S[kind + 'Lng'] = hit.lng;
      BTP.store.saveSettings();
      status.textContent = '✓ ' + hit.label.split(',').slice(0, 3).join(',');
      return point(kind);
    }).catch(function () {
      status.textContent = '⚠ Sin conexión con el buscador de direcciones. ' +
        'Puedes indicar las coordenadas como «40.4168, -3.7038».';
      return coordsFromText(text, kind);
    });
  }

  /** Permite escribir «lat, lng» directamente cuando no hay geocodificador. */
  function coordsFromText(text, kind) {
    var m = /^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,;]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/.exec(text);
    if (!m) return null;
    var lat = parseFloat(m[1].replace(',', '.'));
    var lng = parseFloat(m[2].replace(',', '.'));
    if (isNaN(lat) || isNaN(lng)) return null;
    S[kind + 'Text'] = text; S[kind + 'Lat'] = lat; S[kind + 'Lng'] = lng;
    BTP.store.saveSettings();
    return point(kind);
  }

  function useGeolocation() {
    if (!navigator.geolocation) { toast('Este navegador no permite geolocalización.'); return; }
    $('#origin-status').textContent = 'Obteniendo ubicación…';
    navigator.geolocation.getCurrentPosition(function (pos) {
      var lat = pos.coords.latitude, lng = pos.coords.longitude;
      S.originLat = lat; S.originLng = lng;
      S.originText = 'Mi ubicación (' + lat.toFixed(4) + ', ' + lng.toFixed(4) + ')';
      $('#origin').value = S.originText;
      $('#origin-status').textContent = '✓ Ubicación actual';
      BTP.store.saveSettings();
      drawZone();
      BTP.map.flyTo(lat, lng, 11);
    }, function () {
      $('#origin-status').textContent = '⚠ No se pudo obtener la ubicación.';
    }, { enableHighAccuracy: true, timeout: 10000 });
  }

  /* --- Pintado ---------------------------------------------------------- */

  function plannedIds() {
    var out = {};
    if (!plan) return out;
    plan.days.forEach(function (d) {
      d.items.forEach(function (it) {
        if (it.type !== 'visita') return;
        var n = plan.nodes[it.node];
        if (n.client) out[n.client.id] = true;
      });
    });
    return out;
  }

  function drawZone() {
    BTP.map.renderZone(point('origin'), point('dest'), S);
  }

  function refreshAll() {
    BTP.map.renderClients(BTP.store.state.clients, plannedIds());
    BTP.clients.renderList($('#client-list'), $('#client-search').value);
    drawZone();
    updateStorageInfo();
  }

  function updateStorageInfo() {
    var cs = BTP.store.state.clients;
    var geo = cs.filter(function (c) { return c.lat != null; }).length;
    $('#storage-info').textContent = cs.length + ' registros · ' + geo + ' con coordenadas · ' +
      Object.keys(BTP.store.state.geocache).length + ' direcciones en caché. Todo se guarda en este navegador.';
  }

  function renderItinerary() {
    BTP.itinerary.render(plan, $('#itinerary'), function (evt) {
      if (evt && evt.type === 'reorder') {
        topStatus('Recalculando…');
        BTP.optimize.rescheduleSequence(plan, evt.seq).then(function (p) {
          plan = p;
          topStatus('');
          renderItinerary();
          BTP.map.renderPlan(plan, BTP.itinerary.state.activeDay);
          BTP.map.renderClients(BTP.store.state.clients, plannedIds());
        });
      } else {
        optimize();
      }
    });
  }

  /* --- Optimización ------------------------------------------------------ */

  function optimize() {
    var btn = $('#btn-optimize');
    btn.disabled = true;
    btn.textContent = 'Calculando…';
    topStatus('Preparando el viaje…');

    Promise.all([resolvePoint('origin'), resolvePoint('dest')]).then(function (pts) {
      var origin = pts[0], dest = pts[1];
      if (!origin) throw new Error('Indica tu punto de partida.');
      if (!dest) throw new Error('Indica el destino del viaje.');
      if (!S.startDate) { S.startDate = U.todayISO(); $('#startDate').value = S.startDate; }

      drawZone();
      var sel = BTP.optimize.selectCandidates(BTP.store.state.clients, S, origin, dest);
      showCandidateSummary(sel);
      if (!sel.candidates.length) {
        throw new Error('Ningún cliente cumple los filtros dentro de la zona. Amplía el radio o revisa los filtros.');
      }
      topStatus('Calculando tiempos de ruta entre ' + (sel.candidates.length + 2) + ' puntos…');
      return BTP.optimize.buildPlan({
        origin: origin, dest: dest, candidates: sel.candidates, settings: S
      });
    }).then(function (p) {
      plan = p;
      BTP.itinerary.state.activeDay = null;
      renderItinerary();
      BTP.map.renderPlan(plan, null);
      BTP.map.renderClients(BTP.store.state.clients, plannedIds());
      var pts = [];
      plan.days.forEach(function (d) { (d.points || []).forEach(function (x) { pts.push(x); }); });
      BTP.map.fitTo(pts);
      topStatus('');
      toast(plan.totals.visits + ' visitas en ' + plan.totals.days + ' día(s) · ' +
        Math.round(plan.totals.km) + ' km');
    }).catch(function (err) {
      topStatus('');
      toast(err.message || 'No se ha podido calcular el viaje.', 6000);
      console.error(err);
    }).then(function () {
      btn.disabled = false;
      btn.textContent = 'Optimizar viaje';
    });
  }

  function showCandidateSummary(sel) {
    var parts = [sel.enZona + ' en la zona'];
    if (sel.recortados) parts.push(sel.recortados + ' descartadas por el límite de candidatas');
    if (sel.stats.sinCoords) parts.push(sel.stats.sinCoords + ' sin coordenadas');
    if (sel.stats.filtrados) parts.push(sel.stats.filtrados + ' excluidas por filtros');
    $('#cand-summary').textContent = parts.join(' · ');
  }

  /* --- Pestañas y acciones del panel ------------------------------------ */

  function bindTabs() {
    $$('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        var id = tab.getAttribute('data-tab');
        $$('.tab').forEach(function (t) { t.classList.toggle('active', t === tab); });
        $$('.tab-panel').forEach(function (p) { p.classList.toggle('active', p.id === 'tab-' + id); });
      });
    });
  }

  function bindActions() {
    $('#btn-optimize').addEventListener('click', optimize);

    $('#client-search').addEventListener('input', U.debounce(function () {
      BTP.clients.renderList($('#client-list'), $('#client-search').value);
    }, 200));
    $('#btn-new-client').addEventListener('click', function () { BTP.clients.openEditor(null); });

    $('#btn-import').addEventListener('click', function () { $('#file-input').click(); });
    $('#file-input').addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      BTP.clients.handleFile(file).then(function (rows) {
        BTP.clients.openImportDialog(rows, file.name);
      }).catch(function (err) {
        alert('No se ha podido leer el fichero: ' + err.message);
      });
      e.target.value = '';
    });

    $('#btn-geocode').addEventListener('click', function () {
      var box = $('#geo-progress');
      var bar = box.querySelector('.bar');
      var label = box.querySelector('span');
      box.classList.remove('hidden');
      bar.style.width = '0%';
      label.textContent = 'Preparando…';
      $('#btn-geocode').disabled = true;
      BTP.geocode.geocodeMissing(BTP.store.state.clients, function (done, total, c) {
        bar.style.width = (done / total * 100).toFixed(1) + '%';
        label.textContent = done + ' / ' + total + ' · ' + c.name;
        if (done % 5 === 0 || done === total) refreshAll();
      }).then(function (res) {
        $('#btn-geocode').disabled = false;
        refreshAll();
        if (!res.total) {
          label.textContent = 'No hay direcciones pendientes';
          return;
        }
        if (res.abortado) {
          label.textContent = 'Interrumpido: no hay conexión con Nominatim';
          toast('Sin conexión con el servicio de geocodificación. Vuelve a intentarlo más tarde; ' +
            'lo ya localizado se conserva.', 6000);
          return;
        }
        label.textContent = 'Listo: ' + res.ok + ' de ' + res.total + ' localizados';
        toast(res.ok + ' de ' + res.total + ' direcciones localizadas' +
          (res.red ? ' · ' + res.red + ' sin respuesta, reintenta luego' : ''));
      });
    });

    $('#btn-demo').addEventListener('click', function () {
      if (!BTP.demoData) return;
      var res = BTP.store.addClients(BTP.demoData);
      refreshAll();
      toast('Cargadas ' + res.added + ' empresas de ejemplo');
      BTP.map.fitTo(BTP.store.state.clients);
    });

    $('#btn-export-clients').addEventListener('click', function () {
      U.download('cartera-clientes.csv', BTP.csv.clientsToCsv(BTP.store.state.clients), 'text/csv');
    });

    $('#btn-clear-clients').addEventListener('click', function () {
      if (!confirm('Se borrarán todos los clientes guardados en este navegador. ¿Continuar?')) return;
      BTP.store.clearClients();
      plan = null;
      BTP.map.renderPlan(null);
      renderItinerary();
      refreshAll();
    });

    $('#btn-export-csv').addEventListener('click', function () {
      if (!plan) { toast('Primero optimiza un viaje.'); return; }
      U.download('itinerario.csv', BTP.itinerary.planToCsv(plan), 'text/csv');
    });
    $('#btn-export-ics').addEventListener('click', function () {
      if (!plan) { toast('Primero optimiza un viaje.'); return; }
      U.download('itinerario.ics', BTP.itinerary.planToIcs(plan), 'text/calendar');
    });
    $('#btn-print').addEventListener('click', function () {
      if (!plan) { toast('Primero optimiza un viaje.'); return; }
      window.print();
    });
  }

  /* --- Inicio ------------------------------------------------------------ */

  function init() {
    BTP.map.init('map', {
      onEditClient: function (id) { BTP.clients.openEditor(id); },
      onTogglePin: function (id) {
        var c = BTP.store.getClient(id);
        if (!c) return;
        c.pinned = !c.pinned;
        BTP.store.saveClients();
        refreshAll();
        toast(c.pinned ? c.name + ': visita obligatoria' : c.name + ': ya no es obligatoria');
      }
    });

    if (!S.startDate) S.startDate = U.todayISO();
    bindTabs();
    bindForm();
    bindActions();
    BTP.clients.setOnChange(function () { refreshAll(); });

    renderItinerary();
    refreshAll();

    if (BTP.store.state.clients.length) {
      BTP.map.fitTo(BTP.store.state.clients.filter(function (c) { return c.lat != null; }));
    } else {
      toast('Cartera vacía: ve a «Datos» para importar tu CSV o cargar el ejemplo.', 6000);
    }
    BTP.map.invalidate();
    window.addEventListener('resize', U.debounce(BTP.map.invalidate, 200));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window.BTP);
