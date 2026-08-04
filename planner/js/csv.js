/* Lectura de CSV/Excel y mapeo automático de columnas (incluye exportaciones de Apollo.io). */
window.BTP = window.BTP || {};
(function (BTP) {
  'use strict';

  var norm = BTP.util.norm;

  /** Parser CSV (RFC 4180) con detección de delimitador. */
  function parse(text) {
    text = String(text || '').replace(/^\ufeff/, '');
    var delim = detectDelimiter(text);
    var rows = [], row = [], field = '', inQuotes = false, i = 0;
    while (i < text.length) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { inQuotes = true; i++; continue; }
      if (ch === delim) { row.push(field); field = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += ch; i++;
    }
    row.push(field);
    rows.push(row);
    return rows.filter(function (r) {
      return r.some(function (c) { return String(c).trim() !== ''; });
    });
  }

  function detectDelimiter(text) {
    var firstLine = text.split(/\r?\n/)[0] || '';
    var counts = { ',': 0, ';': 0, '\t': 0 };
    var inQuotes = false;
    for (var i = 0; i < firstLine.length; i++) {
      var ch = firstLine[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (!inQuotes && counts.hasOwnProperty(ch)) counts[ch]++;
    }
    var best = ',', bestN = -1;
    Object.keys(counts).forEach(function (d) {
      if (counts[d] > bestN) { bestN = counts[d]; best = d; }
    });
    return bestN > 0 ? best : ',';
  }

  function serialize(rows, delim) {
    delim = delim || ',';
    return rows.map(function (r) {
      return r.map(function (cell) {
        var s = cell == null ? '' : String(cell);
        return /["\n\r]|[,;\t]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(delim);
    }).join('\r\n');
  }

  /* --- Mapeo de columnas ------------------------------------------------ */

  /* Alias en orden de preferencia. Incluye cabeceras de exportación de Apollo.io
     ("Company", "Company Address", "Company City", ...) y de CRMs en español. */
  var FIELDS = [
    { key: 'name', label: 'Nombre / Empresa', aliases: ['company', 'empresa', 'nombre', 'cliente', 'razonsocial', 'companyname', 'accountname', 'account', 'organization', 'organizationname', 'nombreempresa', 'nombrecomercial'] },
    { key: 'address', label: 'Dirección', aliases: ['companyaddress', 'direccion', 'domicilio', 'calle', 'address', 'streetaddress', 'street', 'direccionfiscal', 'billingstreet'] },
    { key: 'postal', label: 'Código postal', aliases: ['codigopostal', 'cp', 'postalcode', 'zip', 'zipcode', 'billingpostalcode'] },
    { key: 'city', label: 'Ciudad', aliases: ['companycity', 'ciudad', 'localidad', 'poblacion', 'municipio', 'city', 'billingcity'] },
    { key: 'province', label: 'Provincia', aliases: ['companystate', 'provincia', 'state', 'region', 'comunidad', 'distrito', 'billingstate'] },
    { key: 'country', label: 'País', aliases: ['companycountry', 'pais', 'country', 'billingcountry'] },
    { key: 'contact', label: 'Contacto', aliases: ['contacto', 'personanombre', 'contactname', 'personname', 'nombrecontacto', 'fullname'] },
    { key: 'firstName', label: 'Nombre contacto', aliases: ['firstname', 'nombrepila'] },
    { key: 'lastName', label: 'Apellidos contacto', aliases: ['lastname', 'apellidos', 'apellido'] },
    { key: 'title', label: 'Cargo', aliases: ['title', 'cargo', 'puesto', 'jobtitle', 'position'] },
    { key: 'phone', label: 'Teléfono', aliases: ['companyphone', 'telefono', 'tlf', 'tfno', 'phone', 'workdirectphone', 'corporatephone', 'mobilephone', 'movil', 'telefono1'] },
    { key: 'email', label: 'Email', aliases: ['email', 'correo', 'correoelectronico', 'mail', 'emailaddress'] },
    { key: 'website', label: 'Web', aliases: ['website', 'web', 'url', 'sitioweb', 'dominio', 'domain', 'primarydomain', 'websiteurl'] },
    { key: 'industry', label: 'Sector', aliases: ['industry', 'sector', 'actividad', 'rubro', 'segmento', 'categoria'] },
    { key: 'type', label: 'Tipo (cliente/prospecto)', aliases: ['tipo', 'tipocliente', 'relacion', 'estado', 'stage', 'status', 'customertype', 'lifecyclestage'] },
    { key: 'priority', label: 'Prioridad', aliases: ['prioridad', 'priority', 'importancia', 'rating', 'clasificacion', 'abc'] },
    { key: 'value', label: 'Valor / potencial (€)', aliases: ['valor', 'potencial', 'facturacion', 'annualrevenue', 'revenue', 'importe', 'valorpotencial', 'ingresos', 'volumen'] },
    { key: 'lastVisit', label: 'Última visita', aliases: ['ultimavisita', 'fechaultimavisita', 'lastvisit', 'ultimocontacto', 'lastcontacted', 'lastactivity'] },
    { key: 'duration', label: 'Duración visita (min)', aliases: ['duracion', 'duracionvisita', 'minutos', 'visitduration', 'duracionmin'] },
    { key: 'lat', label: 'Latitud', aliases: ['lat', 'latitud', 'latitude'] },
    { key: 'lng', label: 'Longitud', aliases: ['lng', 'lon', 'long', 'longitud', 'longitude'] },
    { key: 'tags', label: 'Etiquetas', aliases: ['etiquetas', 'tags', 'labels', 'lists', 'listas', 'keywords'] },
    { key: 'notes', label: 'Notas', aliases: ['notas', 'notes', 'comentarios', 'observaciones', 'descripcion'] }
  ];

  /** Deduce qué columna del fichero corresponde a cada campo. */
  function autoMap(headers) {
    var used = {};
    var map = {};
    var normHeaders = headers.map(norm);

    FIELDS.forEach(function (f) {
      for (var a = 0; a < f.aliases.length; a++) {
        var idx = normHeaders.indexOf(f.aliases[a]);
        if (idx >= 0 && !used[idx]) { map[f.key] = idx; used[idx] = true; return; }
      }
    });
    // Segunda pasada, coincidencia parcial para lo que quede sin asignar.
    FIELDS.forEach(function (f) {
      if (map[f.key] !== undefined) return;
      for (var a = 0; a < f.aliases.length; a++) {
        for (var h = 0; h < normHeaders.length; h++) {
          if (used[h] || !normHeaders[h]) continue;
          if (normHeaders[h].indexOf(f.aliases[a]) >= 0) {
            map[f.key] = h; used[h] = true; return;
          }
        }
      }
    });
    return map;
  }

  function cell(row, idx) {
    if (idx === undefined || idx === null || idx < 0) return '';
    return (row[idx] == null ? '' : String(row[idx])).trim();
  }

  function parseNumber(s) {
    if (!s) return 0;
    var t = String(s).replace(/[^\d,.\-]/g, '');
    if (/,\d{1,2}$/.test(t) && t.indexOf('.') >= 0) t = t.replace(/\./g, '').replace(',', '.');
    else if (/,/.test(t) && !/\./.test(t)) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
    var n = parseFloat(t);
    return isNaN(n) ? 0 : n;
  }

  function parseType(s) {
    var n = norm(s);
    if (!n) return 'prospecto';
    if (/(cliente|customer|activo|cuenta|account|existing|won|activa)/.test(n) && !/potencial|prospect/.test(n)) return 'cliente';
    return 'prospecto';
  }

  function parsePriority(s) {
    var n = norm(s);
    if (!n) return 2;
    if (/^(3|alta|high|a|alto|muyalta)$/.test(n)) return 3;
    if (/^(1|baja|low|c|bajo)$/.test(n)) return 1;
    if (/^(2|media|medium|b|medio)$/.test(n)) return 2;
    var num = parseInt(n, 10);
    if (num >= 3) return 3;
    if (num === 1) return 1;
    return 2;
  }

  function parseDate(s) {
    var t = String(s || '').trim();
    if (!t) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.exec(t);
    if (m) {
      var y = m[3].length === 2 ? '20' + m[3] : m[3];
      return y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    }
    var d = new Date(t);
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  }

  /** Convierte filas + mapa de columnas en registros de cliente. */
  function toClients(rows, map) {
    var out = [];
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      var name = cell(row, map.name);
      if (!name) continue;
      var contact = cell(row, map.contact);
      if (!contact) {
        contact = [cell(row, map.firstName), cell(row, map.lastName)]
          .filter(Boolean).join(' ').trim();
      }
      var lat = cell(row, map.lat), lng = cell(row, map.lng);
      out.push({
        name: name,
        contact: contact,
        title: cell(row, map.title),
        address: cell(row, map.address),
        postal: cell(row, map.postal),
        city: cell(row, map.city),
        province: cell(row, map.province),
        country: cell(row, map.country) || 'España',
        phone: cell(row, map.phone),
        email: cell(row, map.email),
        website: cell(row, map.website),
        industry: cell(row, map.industry),
        type: map.type !== undefined ? parseType(cell(row, map.type)) : 'prospecto',
        priority: map.priority !== undefined ? parsePriority(cell(row, map.priority)) : 2,
        value: parseNumber(cell(row, map.value)),
        lastVisit: parseDate(cell(row, map.lastVisit)),
        duration: parseNumber(cell(row, map.duration)) || null,
        lat: lat ? parseFloat(lat.replace(',', '.')) : null,
        lng: lng ? parseFloat(lng.replace(',', '.')) : null,
        tags: cell(row, map.tags),
        notes: cell(row, map.notes)
      });
    }
    return out;
  }

  /** Exporta la cartera completa a CSV. */
  function clientsToCsv(clients) {
    var headers = ['Nombre', 'Tipo', 'Prioridad', 'Contacto', 'Cargo', 'Direccion', 'CP', 'Ciudad',
      'Provincia', 'Pais', 'Telefono', 'Email', 'Web', 'Sector', 'Valor', 'UltimaVisita',
      'DuracionMin', 'Etiquetas', 'Notas', 'Latitud', 'Longitud'];
    var rows = [headers];
    clients.forEach(function (c) {
      rows.push([c.name, c.type, c.priority, c.contact, c.title, c.address, c.postal, c.city,
        c.province, c.country, c.phone, c.email, c.website, c.industry, c.value, c.lastVisit,
        c.duration || '', (c.tags || []).join('; '), c.notes, c.lat == null ? '' : c.lat, c.lng == null ? '' : c.lng]);
    });
    return serialize(rows, ';');
  }

  BTP.csv = {
    parse: parse,
    serialize: serialize,
    autoMap: autoMap,
    toClients: toClients,
    clientsToCsv: clientsToCsv,
    FIELDS: FIELDS,
    parseNumber: parseNumber,
    parseDate: parseDate
  };
})(window.BTP);
