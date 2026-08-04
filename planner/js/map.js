/* Capa de mapa (Leaflet + OpenStreetMap): clientes, zona de búsqueda y rutas por día. */
window.BTP = window.BTP || {};
(function (BTP) {
  'use strict';

  var U = BTP.util;

  var DAY_COLORS = ['#2563eb', '#e11d48', '#059669', '#d97706', '#7c3aed', '#0891b2', '#be185d', '#4d7c0f'];
  var TYPE_COLORS = { cliente: '#16a34a', prospecto: '#f59e0b' };

  var map = null;
  var layers = {};
  var handlers = {};

  function dayColor(i) { return DAY_COLORS[i % DAY_COLORS.length]; }

  function init(elementId, opts) {
    handlers = opts || {};
    if (typeof L === 'undefined') {
      var host = document.getElementById(elementId);
      if (host) {
        host.innerHTML = '<div class="map-error">No se ha podido cargar Leaflet (<code>vendor/leaflet.js</code>). ' +
          'El resto de la aplicación sigue funcionando, pero sin mapa.</div>';
      }
      return null;
    }
    map = L.map(elementId, { zoomControl: true, preferCanvas: true })
      .setView([40.2, -4.0], 6);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; colaboradores de <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);

    layers.zone = L.layerGroup().addTo(map);
    layers.clients = L.layerGroup().addTo(map);
    layers.routes = L.layerGroup().addTo(map);
    layers.stops = L.layerGroup().addTo(map);
    layers.anchors = L.layerGroup().addTo(map);

    map.on('click', function (e) {
      if (handlers.onMapClick) handlers.onMapClick(e.latlng);
    });
    return map;
  }

  function clientPopup(c) {
    var addr = BTP.store.fullAddress(c);
    var rows = [];
    if (c.contact) rows.push('<b>' + U.escapeHtml(c.contact) + '</b>' + (c.title ? ' · ' + U.escapeHtml(c.title) : ''));
    if (addr) rows.push(U.escapeHtml(addr));
    if (c.phone) rows.push('☎ <a href="tel:' + U.escapeHtml(c.phone) + '">' + U.escapeHtml(c.phone) + '</a>');
    if (c.email) rows.push('✉ <a href="mailto:' + U.escapeHtml(c.email) + '">' + U.escapeHtml(c.email) + '</a>');
    if (c.website) rows.push('🔗 ' + U.escapeHtml(c.website));
    if (c.industry) rows.push('Sector: ' + U.escapeHtml(c.industry));
    if (c.value) rows.push('Potencial: ' + c.value.toLocaleString('es-ES') + ' €');
    if (c.lastVisit) rows.push('Última visita: ' + U.escapeHtml(c.lastVisit));
    if (c.notes) rows.push('<i>' + U.escapeHtml(c.notes) + '</i>');

    var badge = '<span class="pop-badge ' + c.type + '">' + (c.type === 'cliente' ? 'Cliente' : 'Prospecto') +
      '</span><span class="pop-badge prio">Prioridad ' + ['', 'baja', 'media', 'alta'][c.priority] + '</span>';

    return '<div class="popup">' +
      '<h4>' + U.escapeHtml(c.name) + '</h4>' + badge +
      '<p>' + rows.join('<br>') + '</p>' +
      '<div class="popup-actions">' +
      '<button data-act="pin" data-id="' + c.id + '">' + (c.pinned ? '★ Fijada' : '☆ Visita obligatoria') + '</button>' +
      '<button data-act="edit" data-id="' + c.id + '">Editar</button>' +
      '</div></div>';
  }

  function bindPopupActions(marker, c) {
    marker.on('popupopen', function (e) {
      var root = e.popup.getElement();
      U.$$('button[data-act]', root).forEach(function (btn) {
        btn.addEventListener('click', function () {
          var act = btn.getAttribute('data-act');
          if (act === 'edit' && handlers.onEditClient) handlers.onEditClient(c.id);
          if (act === 'pin' && handlers.onTogglePin) handlers.onTogglePin(c.id);
          map.closePopup();
        });
      });
    });
  }

  /** Dibuja todos los clientes geocodificados. */
  function renderClients(clients, highlightIds) {
    if (!map) return;
    layers.clients.clearLayers();
    var hi = highlightIds || {};
    clients.forEach(function (c) {
      if (c.lat == null || c.lng == null) return;
      var planned = !!hi[c.id];
      var marker = L.circleMarker([c.lat, c.lng], {
        radius: planned ? 4 : 4 + c.priority,
        color: planned ? '#ffffff' : TYPE_COLORS[c.type],
        weight: planned ? 1 : 2,
        opacity: planned ? 0.5 : 0.95,
        fillColor: TYPE_COLORS[c.type],
        fillOpacity: planned ? 0.25 : 0.65
      });
      marker.bindPopup(clientPopup(c), { minWidth: 240 });
      bindPopupActions(marker, c);
      marker.addTo(layers.clients);
    });
  }

  /** Círculo de radio o franja del corredor origen→destino. */
  function renderZone(origin, dest, settings) {
    if (!map) return;
    layers.zone.clearLayers();
    layers.anchors.clearLayers();

    if (origin && origin.lat != null) {
      L.marker([origin.lat, origin.lng], { icon: pinIcon('A', '#111827') })
        .bindPopup('<b>Origen</b><br>' + U.escapeHtml(origin.name || ''))
        .addTo(layers.anchors);
    }
    if (dest && dest.lat != null) {
      L.marker([dest.lat, dest.lng], { icon: pinIcon('B', '#b91c1c') })
        .bindPopup('<b>Destino</b><br>' + U.escapeHtml(dest.name || ''))
        .addTo(layers.anchors);
    }
    if (!dest || dest.lat == null) return;

    if (settings.mode === 'corredor' && origin && origin.lat != null) {
      var poly = corridorPolygon(origin, dest, Number(settings.corridorKm));
      L.polygon(poly, { color: '#2563eb', weight: 1, fillOpacity: 0.06, dashArray: '4 4' }).addTo(layers.zone);
      L.polyline([[origin.lat, origin.lng], [dest.lat, dest.lng]],
        { color: '#2563eb', weight: 1, dashArray: '6 6', opacity: 0.7 }).addTo(layers.zone);
    } else {
      L.circle([dest.lat, dest.lng], {
        radius: Number(settings.radiusKm) * 1000,
        color: '#2563eb', weight: 1, fillOpacity: 0.06, dashArray: '4 4'
      }).addTo(layers.zone);
    }
  }

  /** Rectángulo (en lat/lng) que envuelve el segmento origen→destino. */
  function corridorPolygon(a, b, widthKm) {
    var B = U.toXY(b, a);
    var len = Math.sqrt(B.x * B.x + B.y * B.y) || 1;
    var ux = B.x / len, uy = B.y / len;
    var px = -uy * widthKm, py = ux * widthKm;
    var ex = ux * widthKm, ey = uy * widthKm;   // margen en los extremos
    var corners = [
      { x: -ex + px, y: -ey + py },
      { x: B.x + ex + px, y: B.y + ey + py },
      { x: B.x + ex - px, y: B.y + ey - py },
      { x: -ex - px, y: -ey - py }
    ];
    var R = 6371;
    return corners.map(function (p) {
      return [
        a.lat + (p.y / R) * 180 / Math.PI,
        a.lng + (p.x / (R * Math.cos(a.lat * Math.PI / 180))) * 180 / Math.PI
      ];
    });
  }

  function pinIcon(label, color) {
    return L.divIcon({
      className: 'btp-pin',
      html: '<span style="background:' + color + '">' + label + '</span>',
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });
  }

  function stopIcon(number, color) {
    return L.divIcon({
      className: 'btp-stop',
      html: '<span style="background:' + color + '">' + number + '</span>',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
  }

  /** Pinta las rutas por día y numera las paradas. */
  function renderPlan(plan, activeDay) {
    if (!map) return;
    layers.routes.clearLayers();
    layers.stops.clearLayers();
    if (!plan) return;

    plan.days.forEach(function (day, di) {
      var visible = (activeDay === null || activeDay === undefined || activeDay === di);
      var color = dayColor(di);
      var path = day.geometry;
      if (!path && day.points) {
        path = day.points.map(function (p) { return [p.lat, p.lng]; });
      }
      if (path && path.length > 1) {
        L.polyline(path, {
          color: color,
          weight: visible ? 5 : 2,
          opacity: visible ? 0.85 : 0.25,
          dashArray: day.geometry ? null : '8 6'
        }).addTo(layers.routes);
      }

      var n = 0;
      day.items.forEach(function (it) {
        if (it.type !== 'visita') return;
        n++;
        var node = plan.nodes[it.node];
        var marker = L.marker([node.lat, node.lng], { icon: stopIcon(n, color), opacity: visible ? 1 : 0.35 });
        var body = '<div class="popup"><h4>' + U.escapeHtml(node.name) + '</h4>' +
          '<p>Día ' + (di + 1) + ' · ' + U.fmtHM(it.startMin) + '–' + U.fmtHM(it.endMin) + '</p>';
        if (node.client) body += '<p>' + U.escapeHtml(BTP.store.fullAddress(node.client)) + '</p>';
        body += '</div>';
        marker.bindPopup(body);
        marker.addTo(layers.stops);
      });
    });
  }

  function fitTo(points) {
    if (!map) return;
    var valid = (points || []).filter(function (p) { return p && p.lat != null && p.lng != null; });
    if (!valid.length) return;
    if (valid.length === 1) { map.setView([valid[0].lat, valid[0].lng], 11); return; }
    map.fitBounds(L.latLngBounds(valid.map(function (p) { return [p.lat, p.lng]; })), { padding: [40, 40] });
  }

  function flyTo(lat, lng, zoom) {
    if (!map || lat == null || lng == null) return;
    map.flyTo([lat, lng], zoom || 13, { duration: 0.6 });
  }

  function invalidate() { if (map) setTimeout(function () { map.invalidateSize(); }, 50); }

  BTP.map = {
    init: init,
    renderClients: renderClients,
    renderZone: renderZone,
    renderPlan: renderPlan,
    fitTo: fitTo,
    flyTo: flyTo,
    invalidate: invalidate,
    dayColor: dayColor,
    TYPE_COLORS: TYPE_COLORS,
    getMap: function () { return map; }
  };
})(window.BTP);
