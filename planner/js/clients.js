/* Cartera de clientes: listado, ficha de edición e importación con mapeo de columnas. */
window.BTP = window.BTP || {};
(function (BTP) {
  'use strict';

  var U = BTP.util;
  var el = U.el;
  var onChange = function () { };

  function setOnChange(fn) { onChange = fn || function () { }; }

  /* --- Listado ---------------------------------------------------------- */

  function matches(c, q) {
    if (!q) return true;
    var hay = U.norm([c.name, c.city, c.province, c.industry, c.contact, (c.tags || []).join(' ')].join(' '));
    return hay.indexOf(U.norm(q)) >= 0;
  }

  function renderList(container, query) {
    var clients = BTP.store.state.clients.slice().sort(function (a, b) {
      return a.name.localeCompare(b.name, 'es');
    }).filter(function (c) { return matches(c, query); });

    container.innerHTML = '';
    if (!BTP.store.state.clients.length) {
      container.appendChild(el('div', {
        class: 'empty',
        html: '<b>Cartera vacía.</b><br>Importa un CSV/Excel, carga los datos de ejemplo o añade clientes a mano.'
      }));
      return;
    }
    container.appendChild(el('div', { class: 'list-count', text: clients.length + ' de ' + BTP.store.state.clients.length + ' registros' }));

    clients.forEach(function (c) {
      var geoCls = c.lat != null ? (c.geoStatus === 'aproximado' ? 'geo-approx' : 'geo-ok') : 'geo-none';
      var row = el('div', { class: 'client-row ' + geoCls }, [
        el('span', { class: 'dot ' + c.type }),
        el('div', { class: 'cr-main' }, [
          el('div', { class: 'cr-name' }, [
            el('span', { text: c.name }),
            c.pinned ? el('span', { class: 'tag pin', text: 'fija' }) : null
          ]),
          el('div', { class: 'cr-sub', text: [c.city, c.province, c.industry].filter(Boolean).join(' · ') }),
          c.lat == null ? el('div', { class: 'cr-warn', text: 'sin coordenadas' }) : null
        ]),
        el('div', { class: 'cr-actions' }, [
          el('button', {
            class: 'mini', text: '🎯', title: 'Ver en el mapa',
            onclick: function () { BTP.map.flyTo(c.lat, c.lng, 13); }
          }),
          el('button', {
            class: 'mini', text: '✎', title: 'Editar',
            onclick: function () { openEditor(c.id); }
          }),
          el('button', {
            class: 'mini danger', text: '🗑', title: 'Eliminar',
            onclick: function () {
              if (!confirm('¿Eliminar ' + c.name + '?')) return;
              BTP.store.removeClient(c.id);
              onChange();
            }
          })
        ])
      ]);
      container.appendChild(row);
    });
  }

  /* --- Modal genérico --------------------------------------------------- */

  function openModal(title, contentNode, footerNodes) {
    var backdrop = U.$('#modal');
    backdrop.innerHTML = '';
    var box = el('div', { class: 'modal-box' }, [
      el('div', { class: 'modal-head' }, [
        el('h3', { text: title }),
        el('button', { class: 'mini', text: '✕', onclick: closeModal })
      ]),
      el('div', { class: 'modal-body' }, [contentNode]),
      el('div', { class: 'modal-foot' }, footerNodes || [])
    ]);
    backdrop.appendChild(box);
    backdrop.classList.add('open');
    return box;
  }

  function closeModal() {
    var backdrop = U.$('#modal');
    backdrop.classList.remove('open');
    backdrop.innerHTML = '';
  }

  /* --- Ficha de cliente ------------------------------------------------- */

  var FORM_FIELDS = [
    { k: 'name', l: 'Nombre / empresa', w: 'full', req: true },
    { k: 'type', l: 'Tipo', t: 'select', opts: [['prospecto', 'Cliente potencial'], ['cliente', 'Cliente existente']] },
    { k: 'priority', l: 'Prioridad', t: 'select', opts: [['3', 'Alta'], ['2', 'Media'], ['1', 'Baja']] },
    { k: 'contact', l: 'Persona de contacto' },
    { k: 'title', l: 'Cargo' },
    { k: 'address', l: 'Dirección', w: 'full' },
    { k: 'postal', l: 'Código postal' },
    { k: 'city', l: 'Ciudad' },
    { k: 'province', l: 'Provincia' },
    { k: 'country', l: 'País' },
    { k: 'phone', l: 'Teléfono' },
    { k: 'email', l: 'Email' },
    { k: 'website', l: 'Web' },
    { k: 'industry', l: 'Sector' },
    { k: 'value', l: 'Valor potencial (€)', t: 'number' },
    { k: 'lastVisit', l: 'Última visita', t: 'date' },
    { k: 'duration', l: 'Duración visita (min)', t: 'number' },
    { k: 'tagsText', l: 'Etiquetas (separadas por ;)' },
    { k: 'lat', l: 'Latitud', t: 'number' },
    { k: 'lng', l: 'Longitud', t: 'number' },
    { k: 'notes', l: 'Notas', t: 'textarea', w: 'full' }
  ];

  function openEditor(id) {
    var c = id ? BTP.store.getClient(id) : null;
    var data = c ? Object.assign({}, c) : BTP.store.normalizeClient({ name: '' });
    data.tagsText = (data.tags || []).join('; ');

    var form = el('div', { class: 'form-grid' });
    var inputs = {};
    FORM_FIELDS.forEach(function (f) {
      var input;
      if (f.t === 'select') {
        input = el('select', {});
        f.opts.forEach(function (o) {
          input.appendChild(el('option', { value: o[0], text: o[1] }));
        });
        input.value = String(data[f.k]);
      } else if (f.t === 'textarea') {
        input = el('textarea', { rows: '3' });
        input.value = data[f.k] || '';
      } else {
        input = el('input', { type: f.t || 'text' });
        input.value = data[f.k] == null ? '' : data[f.k];
      }
      inputs[f.k] = input;
      form.appendChild(el('label', { class: 'field ' + (f.w === 'full' ? 'full' : '') }, [
        el('span', { text: f.l }), input
      ]));
    });

    var pinLabel = el('label', { class: 'field check full' }, [
      (function () {
        var cb = el('input', { type: 'checkbox' });
        cb.checked = !!data.pinned;
        inputs.pinned = cb;
        return cb;
      })(),
      el('span', { text: 'Visita obligatoria: inclúyela siempre al optimizar' })
    ]);
    form.appendChild(pinLabel);

    var status = el('div', { class: 'modal-status' });

    openModal(c ? 'Editar cliente' : 'Nuevo cliente', el('div', {}, [form, status]), [
      el('button', {
        class: 'btn ghost', text: 'Geocodificar dirección',
        onclick: function () {
          var tmp = collect();
          status.textContent = 'Buscando coordenadas…';
          BTP.geocode.geocodeClient(tmp).then(function (ok) {
            if (ok) {
              inputs.lat.value = tmp.lat;
              inputs.lng.value = tmp.lng;
              status.textContent = 'Encontrado: ' + (tmp.geoLabel || '');
            } else {
              status.textContent = 'No se ha encontrado la dirección. Revisa calle/ciudad o introduce lat/lng a mano.';
            }
          });
        }
      }),
      el('button', { class: 'btn ghost', text: 'Cancelar', onclick: closeModal }),
      el('button', {
        class: 'btn primary', text: 'Guardar',
        onclick: function () {
          var out = collect();
          if (!out.name) { status.textContent = 'El nombre es obligatorio.'; return; }
          BTP.store.upsertClient(out);
          closeModal();
          onChange();
        }
      })
    ]);

    function collect() {
      var out = Object.assign({}, data);
      FORM_FIELDS.forEach(function (f) { out[f.k] = inputs[f.k].value; });
      out.pinned = inputs.pinned.checked;
      out.tags = out.tagsText ? out.tagsText.split(/[;,|]/).map(function (t) { return t.trim(); }).filter(Boolean) : [];
      delete out.tagsText;
      out.id = c ? c.id : out.id;
      if (out.lat === '' ) out.lat = null;
      if (out.lng === '' ) out.lng = null;
      if (out.lat != null && out.lng != null && out.lat !== '' && out.lng !== '') out.geoStatus = 'ok';
      return BTP.store.normalizeClient(out);
    }
  }

  /* --- Importación ------------------------------------------------------ */

  function handleFile(file) {
    var name = (file.name || '').toLowerCase();
    if (/\.(xlsx|xlsm|xls)$/.test(name)) return readExcel(file);
    return readText(file).then(function (text) { return BTP.csv.parse(text); });
  }

  function readText(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = reject;
      r.readAsText(file, 'utf-8');
    });
  }

  function readExcel(file) {
    if (typeof XLSX === 'undefined') {
      return Promise.reject(new Error('Para leer Excel hace falta conexión (librería SheetJS). Guarda el fichero como CSV y vuelve a intentarlo.'));
    }
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        try {
          var wb = XLSX.read(new Uint8Array(r.result), { type: 'array' });
          var sheet = wb.Sheets[wb.SheetNames[0]];
          resolve(XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }));
        } catch (e) { reject(e); }
      };
      r.onerror = reject;
      r.readAsArrayBuffer(file);
    });
  }

  /** Diálogo de mapeo: muestra la correspondencia detectada y permite corregirla. */
  function openImportDialog(rows, fileName) {
    if (!rows || rows.length < 2) {
      alert('El fichero no contiene datos suficientes.');
      return;
    }
    var headers = rows[0].map(function (h) { return String(h || '').trim(); });
    var map = BTP.csv.autoMap(headers);

    var grid = el('div', { class: 'map-grid' });
    var selects = {};
    BTP.csv.FIELDS.forEach(function (f) {
      var sel = el('select', {});
      sel.appendChild(el('option', { value: '', text: '— no importar —' }));
      headers.forEach(function (h, i) {
        sel.appendChild(el('option', { value: String(i), text: (h || '(columna ' + (i + 1) + ')') }));
      });
      sel.value = map[f.key] === undefined ? '' : String(map[f.key]);
      selects[f.key] = sel;
      grid.appendChild(el('div', { class: 'map-row' }, [
        el('span', { class: 'map-label', text: f.label }), sel
      ]));
    });

    var preview = el('div', { class: 'preview' });
    var defaults = el('div', { class: 'import-defaults' }, [
      el('label', { class: 'field' }, [
        el('span', { text: 'Tipo por defecto (si no hay columna)' }),
        (function () {
          var s = el('select', {});
          s.appendChild(el('option', { value: 'prospecto', text: 'Cliente potencial' }));
          s.appendChild(el('option', { value: 'cliente', text: 'Cliente existente' }));
          selects.__defaultType = s;
          return s;
        })()
      ])
    ]);

    function refresh() {
      var current = {};
      Object.keys(selects).forEach(function (k) {
        if (k.indexOf('__') === 0) return;
        if (selects[k].value !== '') current[k] = parseInt(selects[k].value, 10);
      });
      var clients = BTP.csv.toClients(rows, current);
      var defType = selects.__defaultType.value;
      if (current.type === undefined) {
        clients.forEach(function (c) { c.type = defType; });
      }
      preview.innerHTML = '';
      preview.appendChild(el('div', { class: 'preview-head', text: clients.length + ' registros detectados. Muestra de los 5 primeros:' }));
      clients.slice(0, 5).forEach(function (c) {
        preview.appendChild(el('div', { class: 'preview-row' }, [
          el('b', { text: c.name || '(sin nombre)' }),
          el('span', { text: ' — ' + [c.address, c.city, c.province].filter(Boolean).join(', ') }),
          el('span', { class: 'muted', text: c.contact ? ' · ' + c.contact : '' })
        ]));
      });
      return clients;
    }

    Object.keys(selects).forEach(function (k) { selects[k].addEventListener('change', refresh); });
    refresh();

    openModal('Importar «' + (fileName || 'fichero') + '»',
      el('div', {}, [
        el('p', { class: 'muted', text: 'Se han emparejado las columnas automáticamente (reconoce exportaciones de Apollo.io y de CRMs en español). Revísalo si hace falta.' }),
        defaults, grid, preview
      ]),
      [
        el('button', { class: 'btn ghost', text: 'Cancelar', onclick: closeModal }),
        el('button', {
          class: 'btn primary', text: 'Importar',
          onclick: function () {
            var clients = refresh();
            var res = BTP.store.addClients(clients);
            closeModal();
            onChange({ imported: res });
            alert('Importados ' + res.added + ' nuevos y actualizados ' + res.updated + '.\n\n' +
              'Usa «Geocodificar pendientes» para situarlos en el mapa.');
          }
        })
      ]);
  }

  BTP.clients = {
    renderList: renderList,
    openEditor: openEditor,
    openImportDialog: openImportDialog,
    handleFile: handleFile,
    openModal: openModal,
    closeModal: closeModal,
    setOnChange: setOnChange
  };
})(window.BTP);
