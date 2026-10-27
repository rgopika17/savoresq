/*!
 * SavoResQ Rescue Radar - offline "distance + direction" view and smart pickup route planner.
 * No internet, no map tiles. Items sit around the centre by real bearing and distance.
 *
 *   var r = RescueRadar.draw(svgHost, { you:{lat,lng}, items:[{id,label,sub,qty,mins,pos:{lat,lng}}], route:true });
 *   -> { route:[...], skipped:[...], totalKm, totalMin, portions }
 */
(function () {
    var SPEED = 25, DETOUR = 1.3, STOP_MIN = 3, W = 600, H = 520, CX = 300, CY = 260, R = 225;
    var RANGES = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 3000];

    function km(a, b) { return Geo.km(a, b); }
    function bearing(a, b) {
        var r = Math.PI / 180, y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
        var x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
        return (Math.atan2(y, x) / r + 360) % 360;
    }
    function compass(b) { return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(b / 45) % 8]; }
    function esc(t) { return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
    function fmtMins(m) { m = Math.max(0, Math.round(m)); return m < 60 ? m + " min" : Math.floor(m / 60) + " h" + (m % 60 ? " " + (m % 60) + " min" : ""); }
    function color(mins) { return mins < 60 ? "#dc2626" : mins < 180 ? "#d97706" : "#16a34a"; }

    /** Greedy planner: reachable-in-time only, urgent + near first. */
    function plan(you, items) {
        var pool = items.filter(function (i) { return i.pos; }), route = [], cur = you, t = 0, total = 0;
        for (;;) {
            var best = null;
            pool.forEach(function (i) {
                if (i._used) return;
                var leg = km(cur, i.pos), arrive = t + leg * DETOUR / SPEED * 60;
                if (arrive > i.mins - 2) return;                         // would expire before we get there
                var score = leg + 0.03 * (i.mins - arrive);              // near + urgent wins
                if (!best || score < best.score) best = { i: i, leg: leg, arrive: arrive, score: score };
            });
            if (!best) break;
            best.i._used = true;
            route.push({ item: best.i, leg: best.leg, legMin: best.leg * DETOUR / SPEED * 60, fromYou: km(you, best.i.pos), dirYou: compass(bearing(you, best.i.pos)), arrive: best.arrive, dir: compass(bearing(cur, best.i.pos)), from: cur });
            total += best.leg; t = best.arrive + STOP_MIN; cur = best.i.pos;
        }
        var skipped = pool.filter(function (i) { return !i._used; });
        pool.forEach(function (i) { delete i._used; });
        var travel = route.reduce(function (s, r) { return s + r.legMin; }, 0);
        return { route: route, skipped: skipped, totalKm: total, totalMin: travel + STOP_MIN * route.length, portions: route.reduce(function (s, r) { return s + (Number(r.item.qty) || 0); }, 0) };
    }

    function draw(host, o) {
        var you = o.you, items = (o.items || []).filter(function (i) { return i.pos; });
        var maxD = 0.3; items.forEach(function (i) { i.km = km(you, i.pos); if (i.km > maxD) maxD = i.km; });
        var range = RANGES[RANGES.length - 1]; for (var k = 0; k < RANGES.length; k++) if (RANGES[k] >= maxD * 1.15) { range = RANGES[k]; break; }
        var p = o.route === false ? { route: [], skipped: items, totalKm: 0, totalMin: 0, portions: 0 } : plan(you, items);
        var num = {}; p.route.forEach(function (r, idx) { num[r.item.id] = idx + 1; });

        function xy(pos, i) {
            var d = Math.max(km(you, pos), 0.02), b = bearing(you, pos);
            if (d < 0.02) b = (i * 47) % 360;
            var rr = Math.min(d / range, 1) * R, a = b * Math.PI / 180;
            return { x: CX + Math.sin(a) * rr, y: CY - Math.cos(a) * rr };
        }
        var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Rescue radar">';
        s += '<defs><radialGradient id="rrSweep" cx="0" cy="0" r="1"><stop offset="0" stop-color="#4ade80" stop-opacity=".5"/><stop offset="1" stop-color="#4ade80" stop-opacity="0"/></radialGradient></defs>';
        s += '<g fill="none" stroke="#4ade80" stroke-opacity=".28">';
        [0.2, 0.4, 0.6, 0.8, 1].forEach(function (f, i) { s += '<circle cx="' + CX + '" cy="' + CY + '" r="' + R * f + '"' + (f === 1 ? ' stroke-dasharray="3 5"' : '') + '/>'; });
        s += '<path d="M' + (CX - R - 14) + ' ' + CY + 'H' + (CX + R + 14) + 'M' + CX + ' ' + (CY - R - 14) + 'V' + (CY + R + 14) + '" stroke-opacity=".15"/></g>';
        s += '<g transform="translate(' + CX + ',' + CY + ')"><path d="M0 0L' + R + ' 0A' + R + ' ' + R + ' 0 0 0 ' + (R * Math.cos(-0.45)).toFixed(1) + ' ' + (R * Math.sin(-0.45)).toFixed(1) + 'Z" fill="url(#rrSweep)"><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="7s" repeatCount="indefinite"/></path></g>';
        s += '<g fill="#86efac" font-size="11" opacity=".85">';
        [0.2, 0.4, 0.6, 0.8, 1].forEach(function (f) { var v = range * f; s += '<text x="' + (CX + R * f + 3) + '" y="' + (CY - 4) + '">' + (v < 1 ? Math.round(v * 1000) + " m" : (v % 1 ? v.toFixed(1) : v) + " km") + '</text>'; });
        s += '<text x="' + (CX - 4) + '" y="' + (CY - R - 18) + '">N</text><text x="' + (CX + R + 16) + '" y="' + (CY + 4) + '">E</text><text x="' + (CX - 4) + '" y="' + (CY + R + 28) + '">S</text><text x="' + (CX - R - 28) + '" y="' + (CY + 4) + '">W</text></g>';
        // route line
        if (p.route.length) {
            var pts = [CX + "," + CY]; p.route.forEach(function (r) { var q = xy(r.item.pos, items.indexOf(r.item)); pts.push(q.x.toFixed(1) + "," + q.y.toFixed(1)); });
            s += '<polyline points="' + pts.join(" ") + '" fill="none" stroke="#fde68a" stroke-width="2.5" stroke-dasharray="7 6"/>';
        }
        // blips (far ones first so near ones stay on top)
        items.slice().sort(function (a, b) { return b.km - a.km; }).forEach(function (i) {
            var q = xy(i.pos, items.indexOf(i)), n = num[i.id], skipped = !n && o.route !== false, c = o.route === false ? "#60a5fa" : skipped ? "#64748b" : color(i.mins);
            var r = o.route === false ? 12 : 11 + Math.min(11, (Number(i.qty) || 0) / 8), left = q.x > CX + 110, lx = left ? q.x - r - 6 : q.x + r + 6, anchor = left ? "end" : "start";
            s += '<g class="rr-blip" data-id="' + esc(i.id) + '" style="cursor:pointer">';
            if (!skipped && i.mins < 60) s += '<circle cx="' + q.x.toFixed(1) + '" cy="' + q.y.toFixed(1) + '" r="' + (r + 4) + '" fill="' + c + '" fill-opacity=".3"><animate attributeName="r" values="' + r + ';' + (r + 12) + ';' + r + '" dur="1.6s" repeatCount="indefinite"/><animate attributeName="fill-opacity" values=".4;0;.4" dur="1.6s" repeatCount="indefinite"/></circle>';
            s += '<circle cx="' + q.x.toFixed(1) + '" cy="' + q.y.toFixed(1) + '" r="' + r + '" fill="' + c + '" stroke="#fff" stroke-width="2" ' + (skipped ? 'stroke-opacity=".6"' : "") + '/>';
            if (n) s += '<text x="' + q.x.toFixed(1) + '" y="' + (q.y + 5).toFixed(1) + '" text-anchor="middle" fill="#fff" font-weight="800" font-size="14">' + n + '</text>';
            s += '<text x="' + lx.toFixed(1) + '" y="' + (q.y - 2).toFixed(1) + '" text-anchor="' + anchor + '" fill="' + (skipped ? "#cbd5e1" : "#fff") + '" font-size="12" font-weight="700">' + esc(i.label) + (i.qty === '' || i.qty == null ? '' : ' · ' + esc(i.qty)) + '</text>';
            s += '<text x="' + lx.toFixed(1) + '" y="' + (q.y + 12).toFixed(1) + '" text-anchor="' + anchor + '" fill="' + (skipped ? "#94a3b8" : "#d1fae5") + '" font-size="11">' + (o.route === false ? esc(i.sub || "") : skipped ? "too far for this trip" : fmtMins(i.mins) + " left") + '</text></g>';
        });
        s += '<g><circle cx="' + CX + '" cy="' + CY + '" r="9" fill="#38bdf8" stroke="#fff" stroke-width="2"/><circle cx="' + CX + '" cy="' + CY + '" r="20" fill="none" stroke="#38bdf8" stroke-opacity=".5"><animate attributeName="r" values="14;26;14" dur="2.4s" repeatCount="indefinite"/></circle><text x="' + (CX - 16) + '" y="' + (CY - 14) + '" text-anchor="end" fill="#e0f2fe" font-size="12" font-weight="700">' + esc(o.youLabel || "You") + '</text></g></svg>';
        host.innerHTML = s;
        if (o.onSelect) host.querySelectorAll(".rr-blip").forEach(function (g) { g.addEventListener("click", function () { o.onSelect(g.getAttribute("data-id")); }); });
        p.range = range; p.items = items;
        return p;
    }

    window.RescueRadar = { draw: draw, plan: plan, fmtMins: fmtMins, color: color, compass: compass };
})();
