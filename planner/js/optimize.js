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
   * origin y dest son {lat,lng}.
   */
  function selectCandidates(clients, s, origin, dest) {
    var maxValue = 0;
    clients.forEach(function (c) { if (c.value > maxValue) maxValue = c.value; });

    var inArea = [];
    var stats = { total: clients.length, sinCoords: 0, filtrados: 0, fuera: 0 };

    clients.forEach(function (c) {
      if (c.lat == null || c.lng == null) { stats.sinCoords++; return; }
      if (!passesFilters(c, s)) { stats.filtrados++; return; }
      var dDest = dest ? U.haversine(c, dest) : 0;
      var dOrig = origin ? U.haversine(c, origin) : 0;
      var inside;
      if (s.mode === 'corredor' && origin && dest) {
        inside = U.pointToSegmentKm(c, origin, dest) <= Number(s.corridorKm);
      } else {
        inside = dDest <= Number(s.radiusKm);
      }
      if (!inside) { stats.fuera++; return; }
      inArea.push({
        client: c,
        score: scoreOf(c, s, maxValue),
        distDest: dDest,
        distOrigin: dOrig
      });
    });

    // Se prioriza puntuación alta y cercanía al destino para el recorte.
    inArea.sort(function (a, b) {
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
  function buildNodes(origin, dest, candidates, s) {
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
    if (s.destIsStop && dest && dest.lat != null) {
      nodes.push({
        kind: 'destino', name: dest.name || 'Destino',
        lat: dest.lat, lng: dest.lng, visitMin: 0, score: 0
      });
    }
    return nodes;
  }

  function makeCtx(nodes, matrix, s) {
    return {
      nodes: nodes,
      matrix: matrix,
      settings: s,
      visitMin: function (i) { return nodes[i].visitMin || 0; },
      score: function (i) { return nodes[i].score || 0; }
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

    var days = [], dropped = [];
    var d = 0, cur = 0, t = dayStart, lunchDone = false, outOfDays = false;
    var day = newDay(0, 0);

    function newDay(i, fromNode) {
      return {
        index: i, date: U.addDays(s.startDate, i), startMin: dayStart, endMin: dayStart,
        items: [], driveMin: 0, visitMin: 0, km: 0, visits: 0,
        fromNode: fromNode, toNode: fromNode, geometry: null, late: false
      };
    }

    function closeDay() {
      day.endMin = t;
      day.toNode = cur;
      days.push(day);
    }

    for (var k = 0; k < seq.length; k++) {
      var node = seq[k];
      if (outOfDays) { dropped.push(node); continue; }

      var placed = false;
      while (!placed) {
        var fresh = day.items.length === 0;
        var drive = dur[cur][node];
        var km = dist[cur][node];
        var arrive = t + drive;
        var lunchHere = (lunchMin > 0 && !lunchDone && arrive >= lunchAt) ? lunchMin : 0;
        var vis = ctx.visitMin(node);
        var finish = arrive + lunchHere + vis;

        if (finish <= dayEnd) {
          if (drive > 0.01) {
            day.items.push({
              type: 'trayecto', from: cur, to: node,
              startMin: t, endMin: arrive, min: drive, km: km
            });
            day.driveMin += drive;
            day.km += km;
          }
          if (lunchHere) {
            day.items.push({ type: 'comida', startMin: arrive, endMin: arrive + lunchHere, min: lunchHere });
            lunchDone = true;
          }
          day.items.push({
            type: 'visita', node: node,
            startMin: arrive + lunchHere, endMin: finish, min: vis
          });
          day.visitMin += vis;
          if (ctx.nodes[node].kind === 'cliente') day.visits++;
          t = finish;
          cur = node;
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
      day.items.push({
        type: 'regreso', from: cur, to: 0,
        startMin: t, endMin: t + back, min: back, km: backKm
      });
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

    return { days: days, dropped: dropped, totals: totals };
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

  function twoOpt(seq, ctx) {
    if (seq.length < 3) return seq;
    var best = seq.slice(), bestCost = tourCost(best, ctx), improved = true, guard = 0;
    while (improved && guard++ < 40) {
      improved = false;
      for (var i = 0; i < best.length - 1; i++) {
        for (var j = i + 1; j < best.length; j++) {
          var cand = best.slice(0, i)
            .concat(best.slice(i, j + 1).reverse())
            .concat(best.slice(j + 1));
          var c = tourCost(cand, ctx);
          if (c < bestCost - 0.01) { best = cand; bestCost = c; improved = true; }
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
      for (var len = 1; len <= 3 && len < best.length; len++) {
        for (var i = 0; i + len <= best.length; i++) {
          var seg = best.slice(i, i + len);
          var rest = best.slice(0, i).concat(best.slice(i + len));
          for (var p = 0; p <= rest.length; p++) {
            if (p === i) continue;
            var cand = rest.slice(0, p).concat(seg, rest.slice(p));
            var c = tourCost(cand, ctx);
            if (c < bestCost - 0.01) { best = cand; bestCost = c; improved = true; i = 0; }
          }
        }
      }
    }
    return best;
  }

  /**
   * Inserción voraz por ratio puntuación/tiempo extra, validando con la
   * simulación real de la agenda, más mejora 2-opt / Or-opt.
   */
  function optimizeSequence(ctx) {
    var s = ctx.settings;
    var budget = totalBudgetMin(s);
    var seq = [];
    var pool = [];

    for (var i = 1; i < ctx.nodes.length; i++) {
      var n = ctx.nodes[i];
      if (n.kind === 'destino' || (n.client && n.client.pinned)) {
        var bp = bestPosition(seq, i, ctx);
        seq.splice(bp.pos, 0, i);
      } else {
        pool.push(i);
      }
    }

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
          if (!best || ratio > best.ratio) {
            best = { poolIdx: p, node: node, pos: pos, ratio: ratio };
          }
        }
      }
      if (!best) break;

      var trial = seq.slice();
      trial.splice(best.pos, 0, best.node);
      var sim = simulate(trial, ctx);
      if (!sim.dropped.length) seq = trial;
      pool.splice(best.poolIdx, 1);
    }

    var improved = orOpt(twoOpt(seq, ctx), ctx);
    var simImproved = simulate(improved, ctx);
    var simBase = simulate(seq, ctx);
    if (simImproved.dropped.length <= simBase.dropped.length &&
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
    var nodes = buildNodes(opts.origin, opts.dest, opts.candidates, s);
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
      totals: sim.totals,
      matrixSource: ctx.matrix.source,
      settings: ctx.settings
    };
    return attachGeometries(plan).then(function () { return plan; });
  }

  /** Pide a OSRM el trazado real de cada jornada (si está disponible). */
  function attachGeometries(plan) {
    var s = plan.settings;
    var chain = Promise.resolve();
    plan.days.forEach(function (day) {
      var idxs = [day.fromNode];
      day.items.forEach(function (it) {
        if (it.type === 'visita') idxs.push(it.node);
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
    totalBudgetMin: totalBudgetMin
  };
})(window.BTP);
