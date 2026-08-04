/* Utilidades generales del planificador. */
window.BTP = window.BTP || {};
(function (BTP) {
  'use strict';

  var EARTH_R = 6371; // km

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function uid() {
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function stripAccents(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  /** Clave normalizada: minúsculas, sin acentos, sólo alfanumérico. */
  function norm(s) {
    return stripAccents(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function haversine(a, b) {
    var dLat = (b.lat - a.lat) * Math.PI / 180;
    var dLng = (b.lng - a.lng) * Math.PI / 180;
    var la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /** Proyección plana local (km) respecto a un punto de referencia. */
  function toXY(p, ref) {
    return {
      x: (p.lng - ref.lng) * Math.PI / 180 * EARTH_R * Math.cos(ref.lat * Math.PI / 180),
      y: (p.lat - ref.lat) * Math.PI / 180 * EARTH_R
    };
  }

  /** Distancia en km de un punto al segmento a-b (para el modo corredor). */
  function pointToSegmentKm(p, a, b) {
    var P = toXY(p, a), B = toXY(b, a);
    var L2 = B.x * B.x + B.y * B.y;
    if (L2 === 0) return Math.sqrt(P.x * P.x + P.y * P.y);
    var t = (P.x * B.x + P.y * B.y) / L2;
    t = Math.max(0, Math.min(1, t));
    var dx = P.x - t * B.x, dy = P.y - t * B.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function parseHM(str) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(str || '').trim());
    if (!m) return 0;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  function fmtHM(mins) {
    var m = Math.round(mins);
    var h = Math.floor(m / 60) % 24, mm = m % 60;
    return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
  }

  function fmtDur(mins) {
    var m = Math.round(mins);
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60), r = m % 60;
    return r ? h + ' h ' + r + ' min' : h + ' h';
  }

  function fmtKm(km) {
    return (km < 10 ? km.toFixed(1) : Math.round(km).toString()) + ' km';
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function addDays(iso, n) {
    var parts = String(iso || todayISO()).split('-');
    var d = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
    d.setUTCDate(d.getUTCDate() + n);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  function fmtDateES(iso) {
    var parts = String(iso || '').split('-');
    if (parts.length !== 3) return iso || '';
    var d = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
    return DIAS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MESES[d.getUTCMonth()];
  }

  function daysSince(iso) {
    if (!iso) return null;
    var parts = String(iso).split('-');
    if (parts.length !== 3) return null;
    var d = Date.UTC(+parts[0], +parts[1] - 1, +parts[2]);
    return Math.floor((Date.now() - d) / 86400000);
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms || 250);
    };
  }

  function download(filename, content, mime) {
    var blob = new Blob(['\ufeff' + content], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  BTP.util = {
    $: $, $$: $$, el: el, uid: uid, norm: norm, stripAccents: stripAccents, escapeHtml: escapeHtml,
    haversine: haversine, pointToSegmentKm: pointToSegmentKm, toXY: toXY,
    parseHM: parseHM, fmtHM: fmtHM, fmtDur: fmtDur, fmtKm: fmtKm,
    todayISO: todayISO, addDays: addDays, fmtDateES: fmtDateES, daysSince: daysSince,
    debounce: debounce, download: download, sleep: sleep
  };
})(window.BTP);
