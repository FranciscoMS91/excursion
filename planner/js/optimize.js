/* Selección de candidatos, optimización de la secuencia de visitas y reparto por días. */
window.BTP = window.BTP || {};
(function (BTP) {
  'use strict';

  var U = BTP.util;

  /* --- 1. Filtrado y puntuación de candidatos --------------------------- */

  function passesFilters(c, s) {
    if (!c.name) return false;
    if (c.lat == null || c.lng == null) return false;
    if (s.filterTypes && s.filterTypes.length && s.filterTypes.indexOf(c.type) < 0) return false;
    if (c.priority < (Number(s.filterMinPriority) || 1)) return false;
    if (s.filterIndustry) {
      if (U.norm(c.industry).indexOf(U.norm(s.filterIndustry)) < 0) return false;
    }
    if (s.filterTag) {
      var tags = (c.tags || []).map(U.norm).join('|');
      if (tags.indexOf(U.norm(s.filterTag)) < 0) return false;
    }
    var minDays = Number(s.filterNotVisitedDays) || 0;
    if (minDays > 0) {
      var since = U.daysSince(c.lastVisit);
      if (since !== null && since < minDays) return false;
    }
    return true;
  }

  function scoreOf(c, s, maxValue) {
    var pr = (c.priority - 1) / 2;                                  // 0 · 0,5 · 1
    var val = maxValue > 0 ? Math.min(1, c.value / maxValue) : 0;
    var since = U.daysSince(c.lastVisit);
    var rec = since === null ? 1 : Math.min(since / 365, 1);        // nunca visitado = 1
    var base = (Number(s.wPriority) || 0) * pr +
      (Number(s.wValue) || 0) * val +
      (Number(s.wRecency) || 0) * rec;
    var bias = Number(s.prospectBias) || 0;
    base += (c.type === 'prospecto' ? bias : -bias) * 0.5;
    return Math.max(0.05, base + 0.15);
  }

  /**
   * Devuelve los clientes elegibles para el viaje, ya puntuados y ordenados.
   * origin es {lat,lng} y stops la lista ordenada de etapas.
   */
  function selectCandidates(clients, s, origin, stops) {
    stops = stops || [];
    var ruta = origin ? [origin].concat(stops) : stops.slice();
    var maxValue = 0;
    clients.forEach(function (c) { if (c.value > maxValue) maxValue = c.value; });

    var inArea = [];
    var stats = { total: clients.length, sinCoords: 0, filtrados: 0, fuera: 0, citas: 0, cercaDeCita: 0 };

    // El entorno de una cita pactada entra siempre: si hay reunión en Zaragoza,
    // interesan las empresas de Zaragoza aunque queden fuera del corredor.
    var nearKm = Number(s.apptNearbyKm) || 35;
    var apptPoints = clients.filter(function (c) {
      return BTP.store.hasAppointment(c) && c.lat != null && c.lng != null;
    });
    function nearAppointment(c) {
      for (var i = 0; i < apptPoints.length; i++) {
        if (U.haversine(c, apptPoints[i]) <= nearKm) return true;
      }
      return false;
    }

    clients.forEach(function (c) {
      if (c.lat == null || c.lng == null) { stats.sinCoords++; return; }
      // Una cita pactada es un compromiso: entra aunque los filtros o la zona la dejen fuera.
      var forced = BTP.store.hasAppointment(c);
      if (forced) stats.citas++;
      if (!forced && !passesFilters(c, s)) { stats.filtrados++; return; }
      // Distancia a la etapa más cercana: ordena el recorte de candidatas.
      var dDest = Infinity;
      stops.forEach(function (e) {
        var d = U.haversine(c, e);
        if (d < dDest) dDest = d;
      });
      if (dDest === Infinity) dDest = 0;
      var dOrig = origin ? U.haversine(c, origin) : 0;
      var inside;
      if (s.mode === 'corredor' && ruta.length >= 2) {
        inside = U.pointToPathKm(c, ruta) <= Number(s.corridorKm);
      } else {
        inside = dDest <= Number(s.radiusKm);
      }
      var nearAppt = false;
      if (!inside && !forced) {
        nearAppt = apptPoints.length > 0 && nearAppointment(c);
        if (!nearAppt) { stats.fuera++; return; }
        stats.cercaDeCita++;
      }
      inArea.push({
        client: c,
        score: scoreOf(c, s, maxValue),
        distDest: dDest,
        distOrigin: dOrig,
        forced: forced,
        nearAppt: nearAppt
      });
    });

    // Primero las citas, luego su entorno; el resto por puntuación y cercanía al destino.
    function rank(x) { return x.forced ? 0 : (x.nearAppt ? 1 : 2); }
    inArea.sort(function (a, b) {
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      var ra = a.score / (1 + a.distDest / 60);
      var rb = b.score / (1 + b.distDest / 60);
      return rb - ra;
    });

    var cap = Number(s.maxCandidates) || 80;
    var recortados = Math.max(0, inArea.length - cap);
    return { candidates: inArea.slice(0, cap), stats: stats, recortados: recortados, enZona: inArea.length };
  }

  /* --- 2. Contexto de cálculo ------------------------------------------ */

  /** Construye los nodos del problema: 0 = origen, 1..n = paradas. */
  function buildNodes(origin, stops, candidates, s) {
    var nodes = [{ kind: 'origen', name: origin.name || 'Origen', lat: origin.lat, lng: origin.lng, visitMin: 0 }];
    candidates.forEach(function (cand) {
      nodes.push({
        kind: 'cliente',
        client: cand.client,
        score: cand.score,
        name: cand.client.name,
        lat: cand.client.lat,
        lng: cand.client.lng,
        visitMin: Number(cand.client.duration) || Number(s.defaultVisitMin) || 60
      });
    });
    if (s.destIsStop) {
      (stops || []).forEach(function (e, i) {
        nodes.push({
          kind: 'etapa', orden: i, name: e.name || ('Etapa ' + (i + 1)),
          lat: e.lat, lng: e.lng, visitMin: 0, score: 0
        });
      });
    }
    return nodes;
  }

  /** Cita pactada de un nodo, o null. dayIndex es relativo al primer día. */
  function apptOf(node, s) {
    var c = node && node.client;
    if (!c || !c.apptTime) return null;
    return {
      start: U.parseHM(c.apptTime),
      dayIndex: c.apptDate ? U.daysBetween(s.startDate, c.apptDate) : null,
      date: c.apptDate || ''
    };
  }

  function makeCtx(nodes, matrix, s) {
    var appts = nodes.map(function (n) { return apptOf(n, s); });
    var fijas = nodes.map(function (n, i) {
      // Una cita pactada siempre fija su sitio; una etapa sólo si se ha pedido
      // respetar el orden escrito.
      return !!appts[i] || (n.kind === 'etapa' && s.lockStopOrder !== false);
    });
    return {
      nodes: nodes,
      matrix: matrix,
      settings: s,
      visitMin: function (i) { return nodes[i].visitMin || 0; },
      score: function (i) { return nodes[i].score || 0; },
      appt: function (i) { return appts[i]; },
      anchor: function (i) { return fijas[i]; },
      anyAppt: appts.some(function (a) { return !!a; })
    };
  }

  /* --- 3. Reparto por días (simulación horaria) ------------------------- */

  function simulate(seq, ctx) {
    var s = ctx.settings;
    var dur = ctx.matrix.dur, dist = ctx.matrix.dist;
    var dayStart = U.parseHM(s.dayStart);
    var dayEnd = U.parseHM(s.dayEnd);
    var lunchAt = U.parseHM(s.lunchStart);
    var lunchMin = Number(s.lunchMin) || 0;
    var maxDays = Math.max(1, Number(s.days) || 1);

    var days = [], dropped = [], conflicts = [];
    var d = 0, cur = 0, t = dayStart, lunchDone = false, outOfDays = false;
    var day = newDay(0, 0);

    function newDay(i, fromNode) {
      return {
        index: i, date: U.addDays(s.startDate, i), startMin: dayStart, endMin: dayStart,
        items: [], driveMin: 0, visitMin: 0, km: 0, visits: 0,
        fromNode: fromNode, toNode: fromNode, geometry: null, late: false, hasAppt: false
      };
    }

    function closeDay() {
      day.endMin = t;
      day.toNode = cur;
      days.push(day);
    }

    function pushDrive(node) {
      var drive = dur[cur][node], km = dist[cur][node];
      if (drive > 0.01) {
        day.items.push({ type: 'trayecto', from: cur, to: node, startMin: t, endMin: t + drive, min: drive, km: km });
        day.driveMin += drive;
        day.km += km;
      }
      return t + drive;
    }

    function recordVisit(node, startMin, fixed) {
      var vis = ctx.visitMin(node);
      day.items.push({ type: 'visita', node: node, startMin: startMin, endMin: startMin + vis, min: vis, fixed: !!fixed });
      day.visitMin += vis;
      if (ctx.nodes[node].kind === 'cliente') day.visits++;
      t = startMin + vis;
      cur = node;
    }

    /* Índice de la próxima cita a partir de cada posición de la secuencia. */
    var nextAppt = new Array(seq.length);
    for (var z = seq.length - 1, nxt = -1; z >= 0; z--) {
      nextAppt[z] = nxt;
      if (ctx.appt(seq[z])) nxt = z;
    }

    /**
     * Salta hasta el día de la cita. Si saliendo por la mañana no se llega a
     * tiempo, el desplazamiento se hace la tarde anterior y se pernocta cerca.
     */
    function advanceToApptDay(apptNode, ap, target) {
      while (d < target) {
        if (d === target - 1 && cur !== apptNode && dayStart + dur[cur][apptNode] > ap.start + 0.5) {
          var tk = dur[cur][apptNode], tkm = dist[cur][apptNode];
          day.items.push({
            type: 'traslado', from: cur, to: apptNode,
            startMin: t, endMin: t + tk, min: tk, km: tkm
          });
          day.driveMin += tk;
          day.km += tkm;
          t += tk;
          cur = apptNode;
        }
        closeDay();
        d++;
        day = newDay(d, cur);
        t = dayStart;
        lunchDone = false;
      }
    }

    /**
     * ¿Esta parada cabe en el hueco de la mañana anterior a la próxima cita?
     * Si es así se adelanta el día, en vez de gastarla en la jornada de hoy.
     */
    function fitsMorningGap(node, k) {
      var idx = nextAppt[k];
      if (idx < 0) return null;
      var aNode = seq[idx], ap = ctx.appt(aNode);
      if (ap.dayIndex === null || ap.dayIndex <= d || ap.dayIndex >= maxDays) return null;
      // Sólo si se va a pernoctar junto a la cita: si no, la mañana no empieza allí.
      if (dayStart + dur[cur][aNode] <= ap.start + 0.5) return null;
      var total = dayStart + dur[aNode][node] + ctx.visitMin(node) + dur[node][aNode];
      if (total > ap.start + 0.5) return null;
      return { node: aNode, ap: ap, target: ap.dayIndex };
    }

    /* Una cita pactada manda: se viaja al día que toca y se espera si hace falta. */
    function placeAppointment(node, ap) {
      var target = ap.dayIndex === null ? d : ap.dayIndex;
      if (target < 0 || target >= maxDays) {
        conflicts.push({ node: node, type: 'fuera-de-rango', dayIndex: ap.dayIndex });
        dropped.push(node);
        return;
      }
      if (target < d) {
        conflicts.push({ node: node, type: 'dia-pasado', dayIndex: ap.dayIndex });
        dropped.push(node);
        return;
      }
      advanceToApptDay(node, ap, target);

      var arrive = pushDrive(node);
      var hueco = ap.start - arrive;
      if (hueco < -0.5) {
        conflicts.push({ node: node, type: 'tarde', minutes: Math.round(-hueco) });
      } else if (hueco > 0.5) {
        var comida = 0;
        if (!lunchDone && lunchMin > 0 && ap.start >= lunchAt && hueco >= lunchMin) {
          comida = lunchMin;
          day.items.push({ type: 'comida', startMin: arrive, endMin: arrive + comida, min: comida });
          lunchDone = true;
        }
        if (hueco - comida > 0.5) {
          day.items.push({ type: 'espera', startMin: arrive + comida, endMin: ap.start, min: hueco - comida });
        }
      }

      t = Math.max(ap.start, arrive);
      recordVisit(node, t, true);
      day.hasAppt = true;
      if (t > dayEnd) day.late = true;
      outOfDays = false;   // tras la cita puede seguir cabiendo algo ese mismo día
    }

    for (var k = 0; k < seq.length; k++) {
      var node = seq[k];
      var ap = ctx.appt(node);

      if (ap) { placeAppointment(node, ap); continue; }
      if (outOfDays) { dropped.push(node); continue; }

      var gap = fitsMorningGap(node, k);
      if (gap) advanceToApptDay(gap.node, gap.ap, gap.target);

      var placed = false;
      while (!placed) {
        var fresh = day.items.length === 0;
        var drive = dur[cur][node];
        var arrive = t + drive;
        var lunchHere = (lunchMin > 0 && !lunchDone && arrive >= lunchAt) ? lunchMin : 0;
        var finish = arrive + lunchHere + ctx.visitMin(node);

        if (finish <= dayEnd) {
          pushDrive(node);
          if (lunchHere) {
            day.items.push({ type: 'comida', startMin: arrive, endMin: arrive + lunchHere, min: lunchHere });
            lunchDone = true;
          }
          recordVisit(node, arrive + lunchHere, false);
          placed = true;
        } else if (fresh) {
          // No cabe ni con el día entero por delante: se descarta esta parada.
          dropped.push(node);
          placed = true;
        } else if (d + 1 < maxDays) {
          closeDay();
          d++;
          day = newDay(d, cur);
          t = dayStart;
          lunchDone = false;
        } else {
          outOfDays = true;
          dropped.push(node);
          placed = true;
        }
      }
    }

    // Regreso al punto de partida.
    if (s.returnToOrigin && cur !== 0) {
      var back = dur[cur][0], backKm = dist[cur][0];
      if (t + back > dayEnd && day.items.length && d + 1 < maxDays) {
        closeDay();
        d++;
        day = newDay(d, cur);
        t = dayStart;
      }
      day.items.push({ type: 'regreso', from: cur, to: 0, startMin: t, endMin: t + back, min: back, km: backKm });
      day.driveMin += back;
      day.km += backKm;
      t += back;
      if (t > dayEnd) day.late = true;
      cur = 0;
    }

    if (day.items.length || !days.length) closeDay();

    var totals = { km: 0, driveMin: 0, visitMin: 0, visits: 0, days: days.length };
    days.forEach(function (dd) {
      totals.km += dd.km; totals.driveMin += dd.driveMin;
      totals.visitMin += dd.visitMin; totals.visits += dd.visits;
    });

    return { days: days, dropped: dropped, conflicts: conflicts, totals: totals };
  }

  /* --- 4. Optimización de la secuencia --------------------------------- */

  function tourCost(seq, ctx) {
    var dur = ctx.matrix.dur, c = 0, prev = 0;
    for (var i = 0; i < seq.length; i++) { c += dur[prev][seq[i]]; prev = seq[i]; }
    if (ctx.settings.returnToOrigin) c += dur[prev][0];
    return c;
  }

  function insertionCost(seq, pos, node, ctx) {
    var dur = ctx.matrix.dur;
    var prev = pos === 0 ? 0 : seq[pos - 1];
    var next = pos < seq.length ? seq[pos] : null;
    if (next === null) {
      var back = ctx.settings.returnToOrigin ? (dur[node][0] - dur[prev][0]) : 0;
      return dur[prev][node] + back;
    }
    return dur[prev][node] + dur[node][next] - dur[prev][next];
  }

  function bestPosition(seq, node, ctx) {
    var best = 0, bestCost = Infinity;
    for (var pos = 0; pos <= seq.length; pos++) {
      var c = insertionCost(seq, pos, node, ctx);
      if (c < bestCost) { bestCost = c; best = pos; }
    }
    return { pos: best, cost: bestCost };
  }

  function totalBudgetMin(s) {
    var perDay = U.parseHM(s.dayEnd) - U.parseHM(s.dayStart) - (Number(s.lunchMin) || 0);
    return Math.max(0, perDay) * Math.max(1, Number(s.days) || 1);
  }

  /* Las mejoras locales nunca cruzan una cita pactada: su orden es intocable. */

  function twoOpt(seq, ctx) {
    if (seq.length < 3) return seq;
    var best = seq.slice(), bestCost = tourCost(best, ctx), improved = true, guard = 0;
    while (improved && guard++ < 40) {
      improved = false;
      var anchor = best.map(function (n) { return ctx.anchor(n); });
      for (var i = 0; i < best.length - 1; i++) {
        if (anchor[i]) continue;
        for (var j = i + 1; j < best.length; j++) {
          if (anchor[j]) break;
          var cand = best.slice(0, i)
            .concat(best.slice(i, j + 1).reverse())
            .concat(best.slice(j + 1));
          var c = tourCost(cand, ctx);
          if (c < bestCost - 0.01) { best = cand; bestCost = c; improved = true; anchor = best.map(function (n) { return ctx.anchor(n); }); }
        }
      }
    }
    return best;
  }

  function orOpt(seq, ctx) {
    if (seq.length < 3) return seq;
    var best = seq.slice(), bestCost = tourCost(best, ctx), improved = true, guard = 0;
    while (improved && guard++ < 20) {
      improved = false;
      var pre = prefixAnchors(best, ctx);
      for (var len = 1; len <= 3 && len < best.length; len++) {
        for (var i = 0; i + len <= best.length; i++) {
          if (pre[i + len] !== pre[i]) continue;          // el tramo contiene una cita
          var region = pre[i];
          var seg = best.slice(i, i + len);
          var rest = best.slice(0, i).concat(best.slice(i + len));
          var preR = prefixAnchors(rest, ctx);
          for (var p = 0; p <= rest.length; p++) {
            if (p === i || preR[p] !== region) continue;  // sólo dentro del mismo tramo
            var cand = rest.slice(0, p).concat(seg, rest.slice(p));
            var c = tourCost(cand, ctx);
            if (c < bestCost - 0.01) {
              best = cand; bestCost = c; improved = true;
              pre = prefixAnchors(best, ctx);
              i = 0;
            }
          }
        }
      }
    }
    return best;
  }

  /** pre[k] = número de paradas fijas entre las k primeras. */
  function prefixAnchors(seq, ctx) {
    var pre = [0];
    for (var i = 0; i < seq.length; i++) pre.push(pre[i] + (ctx.anchor(seq[i]) ? 1 : 0));
    return pre;
  }

  /**
   * Inserta el nodo en la posición más barata que no empeore la agenda.
   * Se compara contra la situación de partida en lugar de exigir cero
   * problemas: una cita imposible de cumplir (por ejemplo con la fecha
   * fuera del viaje) no debe impedir que se planifique todo lo demás.
   */
  function insertFeasible(seq, node, ctx, maxTries) {
    var base = simulate(seq, ctx);
    var opts = [];
    for (var pos = 0; pos <= seq.length; pos++) {
      opts.push({ pos: pos, cost: insertionCost(seq, pos, node, ctx) });
    }
    opts.sort(function (a, b) { return a.cost - b.cost; });
    var tries = Math.min(opts.length, maxTries || 8);
    for (var i = 0; i < tries; i++) {
      var trial = seq.slice();
      trial.splice(opts[i].pos, 0, node);
      var sim = simulate(trial, ctx);
      if (sim.dropped.indexOf(node) >= 0) continue;           // no ha entrado
      if (sim.dropped.length > base.dropped.length) continue;  // ha echado a otra
      if (sim.conflicts.length > base.conflicts.length) continue;
      return trial;
    }
    return null;
  }

  /**
   * Inserción voraz por ratio puntuación/tiempo extra, validando con la
   * simulación real de la agenda, más mejora 2-opt / Or-opt.
   */
  function optimizeSequence(ctx) {
    var s = ctx.settings;
    var budget = totalBudgetMin(s);
    var etapas = [], citas = [], mandatory = [], pool = [];

    for (var i = 1; i < ctx.nodes.length; i++) {
      var n = ctx.nodes[i];
      if (ctx.appt(i)) citas.push(i);
      else if (n.kind === 'etapa') {
        if (s.lockStopOrder !== false) etapas.push(i);
        else mandatory.push(i);
      } else if (n.client && n.client.pinned) mandatory.push(i);
      else pool.push(i);
    }

    // El esqueleto son las etapas en el orden escrito: Barcelona → Madrid →
    // Salamanca se recorre en ese orden, no en el que salga más corto.
    etapas.sort(function (a, b) { return ctx.nodes[a].orden - ctx.nodes[b].orden; });
    var seq = etapas.slice();

    // Las citas pactadas se encajan en ese esqueleto, en orden cronológico.
    citas.sort(function (a, b) {
      var aa = ctx.appt(a), ab = ctx.appt(b);
      var da = aa.dayIndex === null ? 0 : aa.dayIndex;
      var db = ab.dayIndex === null ? 0 : ab.dayIndex;
      return da !== db ? da - db : aa.start - ab.start;
    });
    citas.forEach(function (node) {
      var next = insertFeasible(seq, node, ctx, seq.length + 1);
      if (next) { seq = next; return; }
      seq.splice(bestPosition(seq, node, ctx).pos, 0, node);   // la cita entra igual
    });

    mandatory.forEach(function (node) {
      var next = insertFeasible(seq, node, ctx, 10);
      if (next) { seq = next; return; }
      seq.splice(bestPosition(seq, node, ctx).pos, 0, node);  // obligatoria: entra igual
    });

    function routeTime(sq) {
      var t = tourCost(sq, ctx);
      for (var q = 0; q < sq.length; q++) t += ctx.visitMin(sq[q]);
      return t;
    }

    var guard = 0;
    while (pool.length && guard++ < 500) {
      var used = routeTime(seq);
      var best = null;
      for (var p = 0; p < pool.length; p++) {
        var node = pool[p];
        var vis = ctx.visitMin(node);
        for (var pos = 0; pos <= seq.length; pos++) {
          var extra = insertionCost(seq, pos, node, ctx) + vis;
          if (used + extra > budget) continue;
          var ratio = ctx.score(node) / Math.max(extra, 5);
          if (!best || ratio > best.ratio) best = { poolIdx: p, node: node, ratio: ratio };
        }
      }
      if (!best) break;
      var next = insertFeasible(seq, best.node, ctx, 8);
      if (next) seq = next;
      pool.splice(best.poolIdx, 1);
    }

    var improved = orOpt(twoOpt(seq, ctx), ctx);
    var simImproved = simulate(improved, ctx);
    var simBase = simulate(seq, ctx);
    if (simImproved.dropped.length <= simBase.dropped.length &&
      simImproved.conflicts.length <= simBase.conflicts.length &&
      simImproved.totals.km <= simBase.totals.km + 0.5) {
      return improved;
    }
    return seq;
  }

  /* --- 5. Punto de entrada --------------------------------------------- */

  /**
   * Construye el plan completo. Devuelve una promesa con
   * {nodes, seq, days, dropped, totals, matrixSource, ctx}.
   */
  function buildPlan(opts) {
    var s = opts.settings;
    var nodes = buildNodes(opts.origin, opts.stops || [], opts.candidates, s);
    var points = nodes.map(function (n) { return { lat: n.lat, lng: n.lng }; });

    return BTP.routing.matrix(points, s).then(function (matrix) {
      var ctx = makeCtx(nodes, matrix, s);
      var seq = optimizeSequence(ctx);
      var sim = simulate(seq, ctx);
      return finish(ctx, seq, sim);
    });
  }

  /** Recalcula la agenda a partir de una secuencia editada a mano. */
  function rescheduleSequence(plan, newSeq) {
    var sim = simulate(newSeq, plan.ctx);
    return finish(plan.ctx, newSeq, sim);
  }

  function finish(ctx, seq, sim) {
    var plan = {
      ctx: ctx,
      nodes: ctx.nodes,
      seq: seq,
      days: sim.days,
      dropped: sim.dropped,
      conflicts: sim.conflicts,
      totals: sim.totals,
      matrixSource: ctx.matrix.source,
      settings: ctx.settings
    };
    plan.appointments = suggestAroundAppointments(plan);
    return attachGeometries(plan).then(function () { return plan; });
  }

  /* --- 6. Sugerencias alrededor de las citas pactadas ------------------- */

  /** Localiza en qué día y a qué hora ha quedado una parada. */
  function findVisit(sim, node) {
    for (var d = 0; d < sim.days.length; d++) {
      var items = sim.days[d].items;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type === 'visita' && items[i].node === node) {
          return { dayIndex: d, startMin: items[i].startMin, endMin: items[i].endMin };
        }
      }
    }
    return null;
  }

  /**
   * Para cada cita pactada propone clientes cercanos que no están en la
   * agenda, con la hora concreta a la que encajarían sin tocar la cita.
   */
  function suggestAroundAppointments(plan, opts) {
    opts = opts || {};
    var radiusKm = opts.radiusKm || Number(plan.settings.apptNearbyKm) || 35;
    var maxPerAppt = opts.max || 6;
    var ctx = plan.ctx;
    if (!ctx.anyAppt) return [];

    var inPlan = {};
    plan.seq.forEach(function (n) { inPlan[n] = true; });
    var base = simulate(plan.seq, ctx);

    var out = [];
    plan.days.forEach(function (day, di) {
      day.items.forEach(function (it) {
        if (it.type !== 'visita' || !it.fixed) return;
        var apptNode = it.node;
        var anchor = ctx.nodes[apptNode];

        var nearby = [];
        for (var i = 1; i < ctx.nodes.length; i++) {
          if (inPlan[i] || ctx.appt(i)) continue;
          var n = ctx.nodes[i];
          if (n.kind !== 'cliente') continue;
          var km = U.haversine(anchor, n);
          if (km <= radiusKm) nearby.push({ node: i, km: km });
        }
        nearby.sort(function (a, b) { return a.km - b.km; });
        nearby = nearby.slice(0, 25);

        var found = [];
        nearby.forEach(function (cand) {
          var placement = bestPlacementOnDay(plan.seq, cand.node, ctx, di, base);
          if (placement) {
            found.push({
              node: cand.node,
              client: ctx.nodes[cand.node].client,
              km: cand.km,
              startMin: placement.startMin,
              endMin: placement.endMin,
              extraMin: placement.extraMin,
              extraKm: placement.extraKm,
              score: ctx.score(cand.node)
            });
          }
        });

        found.sort(function (a, b) {
          return (b.score / Math.max(b.extraMin, 5)) - (a.score / Math.max(a.extraMin, 5));
        });

        out.push({
          node: apptNode,
          client: anchor.client,
          dayIndex: di,
          date: day.date,
          startMin: it.startMin,
          endMin: it.endMin,
          suggestions: found.slice(0, maxPerAppt),
          evaluados: nearby.length
        });
      });
    });
    return out;
  }

  /** Mejor hueco para un candidato dentro de un día concreto, si lo hay. */
  function bestPlacementOnDay(seq, node, ctx, dayIndex, base) {
    var best = null;
    for (var pos = 0; pos <= seq.length; pos++) {
      var trial = seq.slice();
      trial.splice(pos, 0, node);
      var sim = simulate(trial, ctx);
      if (sim.dropped.length > base.dropped.length || sim.conflicts.length > base.conflicts.length) continue;
      var where = findVisit(sim, node);
      if (!where || where.dayIndex !== dayIndex) continue;
      var extraMin = sim.totals.driveMin - base.totals.driveMin;
      if (!best || extraMin < best.extraMin) {
        best = {
          pos: pos,
          startMin: where.startMin,
          endMin: where.endMin,
          extraMin: Math.max(0, extraMin),
          extraKm: Math.max(0, sim.totals.km - base.totals.km)
        };
      }
    }
    return best;
  }

  /** Añade una parada al plan en el mejor hueco disponible. */
  function addVisit(plan, node) {
    var next = insertFeasible(plan.seq, node, plan.ctx, plan.seq.length + 1);
    if (!next) return null;
    return next;
  }

  /** Pide a OSRM el trazado real de cada jornada (si está disponible). */
  function attachGeometries(plan) {
    var s = plan.settings;
    var chain = Promise.resolve();
    plan.days.forEach(function (day) {
      var idxs = [day.fromNode];
      day.items.forEach(function (it) {
        if (it.type === 'visita') idxs.push(it.node);
        if (it.type === 'traslado') idxs.push(it.to);
        if (it.type === 'regreso') idxs.push(0);
      });
      if (idxs.length < 2) return;
      var pts = idxs.map(function (i) { return { lat: plan.nodes[i].lat, lng: plan.nodes[i].lng }; });
      day.points = pts;
      chain = chain.then(function () {
        return BTP.routing.routeGeometry(pts, s).then(function (geo) {
          day.geometry = geo;
        });
      });
    });
    return chain;
  }

  BTP.optimize = {
    selectCandidates: selectCandidates,
    buildPlan: buildPlan,
    rescheduleSequence: rescheduleSequence,
    simulate: simulate,
    scoreOf: scoreOf,
    totalBudgetMin: totalBudgetMin,
    apptOf: apptOf,
    suggestAroundAppointments: suggestAroundAppointments,
    addVisit: addVisit
  };
})(window.BTP);
