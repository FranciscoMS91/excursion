/* Panel de itinerario: agenda por días, reordenación manual y exportaciones. */
window.BTP = window.BTP || {};
(function (BTP) {
  'use strict';

  var U = BTP.util;
  var el = U.el;

  var state = { activeDay: null, onChange: null, plan: null };

  function nodeAddress(node) {
    if (node.client) return BTP.store.fullAddress(node.client);
    return node.name || '';
  }

  /** Secuencia de nodos visitados, en el orden en que se muestran. */
  function currentSequence(plan) {
    var seq = [];
    plan.days.forEach(function (day) {
      day.items.forEach(function (it) { if (it.type === 'visita') seq.push(it.node); });
    });
    return seq;
  }

  function render(plan, container, onChange) {
    state.plan = plan;
    state.onChange = onChange || state.onChange;
    container.innerHTML = '';

    if (!plan) {
      container.appendChild(el('div', { class: 'empty', html: '<b>Sin plan todavía.</b><br>Define origen y destino y pulsa <i>Optimizar viaje</i>.' }));
      return;
    }

    container.appendChild(renderKpis(plan));
    container.appendChild(renderTabs(plan, container, onChange));

    var body = el('div', { class: 'itin-body' });
    plan.days.forEach(function (day, di) {
      if (state.activeDay !== null && state.activeDay !== di) return;
      body.appendChild(renderDay(plan, day, di));
    });
    if (plan.dropped && plan.dropped.length) body.appendChild(renderDropped(plan));
    container.appendChild(body);
  }

  function kpi(value, label, cls) {
    return el('div', { class: 'kpi ' + (cls || '') }, [
      el('span', { class: 'kpi-val', text: value }),
      el('span', { class: 'kpi-lab', text: label })
    ]);
  }

  function renderKpis(plan) {
    var t = plan.totals;
    var perDay = t.days ? (t.visits / t.days) : 0;
    var box = el('div', { class: 'kpis' }, [
      kpi(String(t.visits), 'visitas', 'main'),
      kpi(perDay.toFixed(1), 'visitas/día'),
      kpi(Math.round(t.km) + ' km', 'recorrido'),
      kpi(U.fmtDur(t.driveMin), 'al volante'),
      kpi(U.fmtDur(t.visitMin), 'en visitas'),
      kpi(String(t.days), t.days === 1 ? 'jornada' : 'jornadas')
    ]);
    var note = el('div', { class: 'itin-note' }, [
      el('span', { text: 'Tiempos ' + (plan.matrixSource === 'OSRM' ? 'de ruta real (OSRM)' : 'estimados (sin conexión a OSRM)') }),
      plan.dropped && plan.dropped.length
        ? el('span', { class: 'warn', text: ' · ' + plan.dropped.length + ' visita(s) no caben en el viaje' })
        : null
    ]);
    return el('div', {}, [box, note]);
  }

  function renderTabs(plan, container, onChange) {
    var tabs = el('div', { class: 'day-tabs' });
    function tab(label, value, color) {
      var b = el('button', {
        class: 'day-tab' + (state.activeDay === value ? ' active' : ''),
        text: label,
        onclick: function () {
          state.activeDay = value;
          render(state.plan, container, onChange);
          BTP.map.renderPlan(state.plan, state.activeDay);
        }
      });
      if (color) b.style.borderBottomColor = color;
      return b;
    }
    tabs.appendChild(tab('Todo el viaje', null));
    plan.days.forEach(function (d, i) {
      tabs.appendChild(tab('Día ' + (i + 1), i, BTP.map.dayColor(i)));
    });
    return tabs;
  }

  function renderDay(plan, day, di) {
    var color = BTP.map.dayColor(di);
    var head = el('div', { class: 'day-head' }, [
      el('span', { class: 'day-dot' }),
      el('div', {}, [
        el('div', { class: 'day-title', text: 'Día ' + (di + 1) + ' · ' + U.fmtDateES(day.date) }),
        el('div', {
          class: 'day-sub',
          text: U.fmtHM(day.startMin) + '–' + U.fmtHM(day.endMin) + ' · ' + day.visits +
            ' visitas · ' + Math.round(day.km) + ' km · ' + U.fmtDur(day.driveMin) + ' al volante'
        })
      ]),
      el('button', {
        class: 'mini', text: 'Google Maps',
        onclick: function () { window.open(googleMapsUrl(plan, day), '_blank', 'noopener'); }
      })
    ]);
    head.querySelector('.day-dot').style.background = color;

    var list = el('div', { class: 'timeline' });
    var startNode = plan.nodes[day.fromNode];
    list.appendChild(el('div', { class: 'tl-row start' }, [
      el('span', { class: 'tl-time', text: U.fmtHM(day.startMin) }),
      el('span', { class: 'tl-icon', text: di === 0 ? '🏠' : '🛏️' }),
      el('span', { class: 'tl-main', text: (di === 0 ? 'Salida desde ' : 'Salida desde ') + startNode.name })
    ]));

    var n = 0;
    day.items.forEach(function (it) {
      if (it.type === 'trayecto') {
        list.appendChild(el('div', { class: 'tl-row drive' }, [
          el('span', { class: 'tl-time', text: '' }),
          el('span', { class: 'tl-icon', text: '🚗' }),
          el('span', { class: 'tl-main', text: U.fmtDur(it.min) + ' · ' + U.fmtKm(it.km) })
        ]));
      } else if (it.type === 'comida') {
        list.appendChild(el('div', { class: 'tl-row lunch' }, [
          el('span', { class: 'tl-time', text: U.fmtHM(it.startMin) }),
          el('span', { class: 'tl-icon', text: '🍽️' }),
          el('span', { class: 'tl-main', text: 'Pausa para comer (' + U.fmtDur(it.min) + ')' })
        ]));
      } else if (it.type === 'visita') {
        n++;
        list.appendChild(plan.nodes[it.node].client
          ? renderVisit(plan, it, n, di)
          : renderWaypoint(plan, it, n, di));
      } else if (it.type === 'regreso') {
        list.appendChild(el('div', { class: 'tl-row drive' }, [
          el('span', { class: 'tl-time', text: U.fmtHM(it.startMin) }),
          el('span', { class: 'tl-icon', text: '🏁' }),
          el('span', {
            class: 'tl-main',
            text: 'Regreso a ' + plan.nodes[0].name + ' · ' + U.fmtDur(it.min) + ' · ' + U.fmtKm(it.km) +
              ' (llegada ' + U.fmtHM(it.endMin) + ')'
          })
        ]));
      }
    });

    if (day.late) {
      list.appendChild(el('div', { class: 'tl-row warn-row' }, [
        el('span', { class: 'tl-time', text: '' }),
        el('span', { class: 'tl-icon', text: '⚠️' }),
        el('span', { class: 'tl-main', text: 'La llegada se produce fuera del horario definido.' })
      ]));
    }

    var card = el('div', { class: 'day-card' }, [head, list]);
    card.style.setProperty('--day-color', color);
    return card;
  }

  /** Paso obligatorio por el destino: no es una visita comercial. */
  function renderWaypoint(plan, it, n, di) {
    var node = plan.nodes[it.node];
    var badge = el('span', { class: 'tl-num', text: String(n) });
    badge.style.background = BTP.map.dayColor(di);
    return el('div', { class: 'tl-row waypoint' }, [
      el('span', { class: 'tl-time', text: U.fmtHM(it.startMin) }),
      badge,
      el('div', { class: 'tl-main' }, [
        el('div', { class: 'v-name', text: 'Paso por ' + node.name }),
        el('div', { class: 'v-addr', text: 'Parada de referencia del destino, sin tiempo de visita.' })
      ])
    ]);
  }

  function renderVisit(plan, it, n, di) {
    var node = plan.nodes[it.node];
    var c = node.client;
    var row = el('div', {
      class: 'tl-row visit' + (c && c.pinned ? ' pinned' : ''),
      draggable: 'true',
      'data-node': it.node
    });
    row.appendChild(el('span', { class: 'tl-time', text: U.fmtHM(it.startMin) }));
    var badge = el('span', { class: 'tl-num', text: String(n) });
    badge.style.background = BTP.map.dayColor(di);
    row.appendChild(badge);

    var main = el('div', { class: 'tl-main' });
    main.appendChild(el('div', { class: 'v-name' }, [
      el('span', { text: node.name }),
      c ? el('span', { class: 'tag ' + c.type, text: c.type === 'cliente' ? 'cliente' : 'prospecto' }) : null,
      c && c.pinned ? el('span', { class: 'tag pin', text: 'fija' }) : null
    ]));
    if (c) {
      main.appendChild(el('div', { class: 'v-addr', text: nodeAddress(node) }));
      var meta = [];
      if (c.contact) meta.push(c.contact + (c.title ? ' (' + c.title + ')' : ''));
      if (c.phone) meta.push('☎ ' + c.phone);
      if (c.email) meta.push('✉ ' + c.email);
      if (meta.length) main.appendChild(el('div', { class: 'v-meta', text: meta.join(' · ') }));
      if (c.notes) main.appendChild(el('div', { class: 'v-notes', text: c.notes }));
    }
    main.appendChild(el('div', { class: 'v-dur', text: U.fmtHM(it.startMin) + '–' + U.fmtHM(it.endMin) + ' (' + U.fmtDur(it.min) + ')' }));
    row.appendChild(main);

    var actions = el('div', { class: 'v-actions' }, [
      el('button', {
        class: 'mini', title: 'Centrar en el mapa', text: '🎯',
        onclick: function () { BTP.map.flyTo(node.lat, node.lng, 14); }
      }),
      c ? el('button', {
        class: 'mini', title: 'Marcar como visita obligatoria', text: c.pinned ? '★' : '☆',
        onclick: function () {
          c.pinned = !c.pinned;
          BTP.store.saveClients();
          if (state.onChange) state.onChange({ type: 'pin' });
        }
      }) : null,
      el('button', {
        class: 'mini danger', title: 'Quitar del viaje', text: '✕',
        onclick: function () {
          var seq = currentSequence(state.plan).filter(function (x) { return x !== it.node; });
          if (state.onChange) state.onChange({ type: 'reorder', seq: seq });
        }
      })
    ]);
    row.appendChild(actions);

    row.addEventListener('dragstart', function (e) {
      e.dataTransfer.setData('text/plain', String(it.node));
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', function () { row.classList.remove('dragging'); });
    row.addEventListener('dragover', function (e) { e.preventDefault(); row.classList.add('drop-target'); });
    row.addEventListener('dragleave', function () { row.classList.remove('drop-target'); });
    row.addEventListener('drop', function (e) {
      e.preventDefault();
      row.classList.remove('drop-target');
      var moved = parseInt(e.dataTransfer.getData('text/plain'), 10);
      if (isNaN(moved) || moved === it.node) return;
      var seq = currentSequence(state.plan).filter(function (x) { return x !== moved; });
      var at = seq.indexOf(it.node);
      seq.splice(at < 0 ? seq.length : at, 0, moved);
      if (state.onChange) state.onChange({ type: 'reorder', seq: seq });
    });

    return row;
  }

  function renderDropped(plan) {
    var box = el('div', { class: 'dropped' });
    box.appendChild(el('div', { class: 'dropped-head', text: 'No caben en este viaje (' + plan.dropped.length + ')' }));
    plan.dropped.forEach(function (i) {
      var node = plan.nodes[i];
      box.appendChild(el('div', { class: 'dropped-row' }, [
        el('span', { text: node.name }),
        el('span', { class: 'muted', text: node.client ? (node.client.city || '') : '' })
      ]));
    });
    box.appendChild(el('div', { class: 'muted small', text: 'Amplía los días del viaje, alarga la jornada o reduce la duración de las visitas para incluirlas.' }));
    return box;
  }

  /* --- Exportaciones ---------------------------------------------------- */

  function googleMapsUrl(plan, day) {
    var pts = (day.points || []).slice();
    if (pts.length < 2) return 'https://www.google.com/maps';
    var origin = pts[0], destination = pts[pts.length - 1];
    var waypoints = pts.slice(1, -1).slice(0, 9);
    var url = 'https://www.google.com/maps/dir/?api=1&travelmode=driving' +
      '&origin=' + origin.lat.toFixed(6) + ',' + origin.lng.toFixed(6) +
      '&destination=' + destination.lat.toFixed(6) + ',' + destination.lng.toFixed(6);
    if (waypoints.length) {
      url += '&waypoints=' + waypoints.map(function (p) {
        return p.lat.toFixed(6) + ',' + p.lng.toFixed(6);
      }).join('|');
    }
    return url;
  }

  function planToCsv(plan) {
    var rows = [['Dia', 'Fecha', 'Orden', 'Hora inicio', 'Hora fin', 'Empresa', 'Tipo', 'Contacto',
      'Cargo', 'Telefono', 'Email', 'Direccion', 'Ciudad', 'Provincia', 'Km desde parada anterior',
      'Conduccion (min)', 'Notas']];
    plan.days.forEach(function (day, di) {
      var n = 0, lastDrive = null;
      day.items.forEach(function (it) {
        if (it.type === 'trayecto') { lastDrive = it; return; }
        if (it.type !== 'visita') return;
        n++;
        var node = plan.nodes[it.node];
        if (!node.client) return;   // el paso por el destino no es una visita
        var c = node.client;
        rows.push([di + 1, day.date, n, U.fmtHM(it.startMin), U.fmtHM(it.endMin), node.name,
          c.type || '', c.contact || '', c.title || '', c.phone || '', c.email || '',
          c.address || '', c.city || '', c.province || '',
          lastDrive ? Math.round(lastDrive.km) : 0,
          lastDrive ? Math.round(lastDrive.min) : 0,
          c.notes || '']);
        lastDrive = null;
      });
    });
    return BTP.csv.serialize(rows, ';');
  }

  function icsEscape(s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;')
      .replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }

  function icsStamp(dateIso, minutes) {
    var h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
    return dateIso.replace(/-/g, '') + 'T' + ('0' + h).slice(-2) + ('0' + m).slice(-2) + '00';
  }

  function planToIcs(plan) {
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Planificador de viajes comerciales//ES', 'CALSCALE:GREGORIAN'];
    plan.days.forEach(function (day) {
      day.items.forEach(function (it) {
        if (it.type !== 'visita') return;
        var node = plan.nodes[it.node];
        if (!node.client) return;
        var c = node.client;
        var desc = [];
        if (c.contact) desc.push('Contacto: ' + c.contact + (c.title ? ' (' + c.title + ')' : ''));
        if (c.phone) desc.push('Teléfono: ' + c.phone);
        if (c.email) desc.push('Email: ' + c.email);
        if (c.notes) desc.push(c.notes);
        lines.push('BEGIN:VEVENT');
        lines.push('UID:' + (c.id || node.name.replace(/\W/g, '')) + '-' + day.date + '@planner');
        lines.push('DTSTAMP:' + icsStamp(U.todayISO(), 0) + 'Z');
        lines.push('DTSTART:' + icsStamp(day.date, it.startMin));
        lines.push('DTEND:' + icsStamp(day.date, it.endMin));
        lines.push('SUMMARY:' + icsEscape('Visita · ' + node.name));
        lines.push('LOCATION:' + icsEscape(nodeAddress(node)));
        lines.push('DESCRIPTION:' + icsEscape(desc.join('\n')));
        lines.push('END:VEVENT');
      });
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  BTP.itinerary = {
    render: render,
    planToCsv: planToCsv,
    planToIcs: planToIcs,
    googleMapsUrl: googleMapsUrl,
    currentSequence: currentSequence,
    state: state
  };
})(window.BTP);
