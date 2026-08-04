/* Persistencia en localStorage: clientes, ajustes, caché de geocodificación. */
window.BTP = window.BTP || {};
(function (BTP) {
  'use strict';

  var KEY_CLIENTS = 'btp.clients.v1';
  var KEY_SETTINGS = 'btp.settings.v1';
  var KEY_GEOCACHE = 'btp.geocache.v1';

  var DEFAULT_SETTINGS = {
    originText: '',
    originLat: null,
    originLng: null,
    destText: '',
    destLat: null,
    destLng: null,
    mode: 'destino',          // 'destino' | 'corredor'
    radiusKm: 60,
    corridorKm: 40,
    startDate: '',
    days: 3,
    dayStart: '08:30',
    dayEnd: '18:30',
    defaultVisitMin: 60,
    lunchStart: '14:00',
    lunchMin: 60,
    returnToOrigin: true,
    destIsStop: true,
    useOsrm: true,
    speedKmh: 80,
    detour: 1.25,
    maxCandidates: 80,
    wPriority: 1,
    wValue: 1,
    wRecency: 0.6,
    prospectBias: 0,          // -1 favorece clientes existentes, +1 favorece prospectos
    filterTypes: ['cliente', 'prospecto'],
    filterMinPriority: 1,
    filterIndustry: '',
    filterNotVisitedDays: 0,
    filterTag: ''
  };

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.warn('No se pudo leer', key, e);
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('No se pudo guardar', key, e);
      return false;
    }
  }

  var state = {
    clients: read(KEY_CLIENTS, []),
    settings: Object.assign({}, DEFAULT_SETTINGS, read(KEY_SETTINGS, {})),
    geocache: read(KEY_GEOCACHE, {})
  };

  if (!state.settings.startDate) state.settings.startDate = BTP.util.todayISO();

  function saveClients() { write(KEY_CLIENTS, state.clients); }
  function saveSettings() { write(KEY_SETTINGS, state.settings); }
  function saveGeocache() { write(KEY_GEOCACHE, state.geocache); }

  /** Normaliza un registro suelto a la forma canónica de cliente. */
  function normalizeClient(raw) {
    var c = Object.assign({}, raw);
    c.id = c.id || BTP.util.uid();
    c.name = (c.name || '').trim();
    c.type = (c.type === 'cliente' || c.type === 'prospecto') ? c.type : 'prospecto';
    c.priority = [1, 2, 3].indexOf(Number(c.priority)) >= 0 ? Number(c.priority) : 2;
    c.value = Number(c.value) || 0;
    c.duration = c.duration ? Number(c.duration) : null;
    c.lat = (c.lat === '' || c.lat === null || c.lat === undefined) ? null : Number(c.lat);
    c.lng = (c.lng === '' || c.lng === null || c.lng === undefined) ? null : Number(c.lng);
    if (isNaN(c.lat)) c.lat = null;
    if (isNaN(c.lng)) c.lng = null;
    c.geoStatus = c.geoStatus || (c.lat != null && c.lng != null ? 'ok' : 'pendiente');
    c.tags = Array.isArray(c.tags) ? c.tags : (c.tags ? String(c.tags).split(/[;,|]/).map(function (t) { return t.trim(); }).filter(Boolean) : []);
    ['contact', 'title', 'address', 'postal', 'city', 'province', 'country',
      'phone', 'email', 'website', 'industry', 'lastVisit', 'notes'].forEach(function (k) {
        c[k] = (c[k] == null ? '' : String(c[k])).trim();
      });
    if (!c.country) c.country = 'España';
    c.pinned = !!c.pinned;
    return c;
  }

  /** Dirección completa en una línea, para geocodificar y mostrar. */
  function fullAddress(c) {
    return [c.address, c.postal, c.city, c.province, c.country]
      .filter(function (x) { return x && String(x).trim(); })
      .join(', ');
  }

  function addClients(list) {
    var added = 0, updated = 0;
    var byKey = {};
    state.clients.forEach(function (c) { byKey[dedupeKey(c)] = c; });
    list.forEach(function (raw) {
      var c = normalizeClient(raw);
      if (!c.name) return;
      var k = dedupeKey(c);
      var existing = byKey[k];
      if (existing) {
        Object.keys(c).forEach(function (f) {
          if (f === 'id') return;
          if (c[f] !== '' && c[f] !== null && !(Array.isArray(c[f]) && !c[f].length)) existing[f] = c[f];
        });
        updated++;
      } else {
        state.clients.push(c);
        byKey[k] = c;
        added++;
      }
    });
    saveClients();
    return { added: added, updated: updated };
  }

  function dedupeKey(c) {
    return BTP.util.norm(c.name) + '|' + BTP.util.norm(c.city);
  }

  function upsertClient(c) {
    var norm = normalizeClient(c);
    var idx = -1;
    for (var i = 0; i < state.clients.length; i++) {
      if (state.clients[i].id === norm.id) { idx = i; break; }
    }
    if (idx >= 0) state.clients[idx] = norm; else state.clients.push(norm);
    saveClients();
    return norm;
  }

  function removeClient(id) {
    state.clients = state.clients.filter(function (c) { return c.id !== id; });
    saveClients();
  }

  function getClient(id) {
    for (var i = 0; i < state.clients.length; i++) {
      if (state.clients[i].id === id) return state.clients[i];
    }
    return null;
  }

  function clearClients() {
    state.clients = [];
    saveClients();
  }

  BTP.store = {
    state: state,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    saveClients: saveClients,
    saveSettings: saveSettings,
    saveGeocache: saveGeocache,
    normalizeClient: normalizeClient,
    fullAddress: fullAddress,
    addClients: addClients,
    upsertClient: upsertClient,
    removeClient: removeClient,
    getClient: getClient,
    clearClients: clearClients
  };
})(window.BTP);
