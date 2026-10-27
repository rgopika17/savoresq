/*!
 * SavoResQ MiniMap - a tiny dependency-free OFFLINE map (drawn on a canvas grid - no internet, no tiles, no Google).
 *   const map = new MiniMap(element, { center: [9.92, 78.12], zoom: 13 });
 *   const m = map.addMarker({ lat, lng, kind: "hotel", label: "Green Leaf", popup: "<b>html</b>" });
 *   map.fit([[lat, lng], ...]);
 * Marker kinds: hotel | ngo | food | you
 */
(function () {
    var TILE = 256;
    var ICON = { hotel: "", ngo: "", food: "", you: "" };

    function project(lat, lng, z) {
        var s = TILE * Math.pow(2, z), sin = Math.sin(lat * Math.PI / 180);
        sin = Math.min(Math.max(sin, -0.9999), 0.9999);
        return { x: (lng + 180) / 360 * s, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s };
    }
    function unproject(x, y, z) {
        var s = TILE * Math.pow(2, z), n = Math.PI - 2 * Math.PI * y / s;
        return { lat: 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng: x / s * 360 - 180 };
    }

    function MiniMap(el, opts) {
        opts = opts || {};
        this.el = el;
        this.center = opts.center || [22.5, 79];
        this.zoom = opts.zoom || 5;
        this.minZoom = 3; this.maxZoom = 18;
        this.markers = [];
        el.classList.add("mm");
        el.innerHTML = '<canvas class="mm-canvas"></canvas><div class="mm-markers"></div><div class="mm-popup" hidden></div>' +
            '<div class="mm-zoom"><button type="button" data-z="1" aria-label="Zoom in">+</button><button type="button" data-z="-1" aria-label="Zoom out">−</button></div>' + '<div class="mm-attr">Offline map · grid view</div>';
        this.canvas = el.querySelector(".mm-canvas");
        this.markerLayer = el.querySelector(".mm-markers");
        this.popup = el.querySelector(".mm-popup");
        this._bind();
        this.render();
    }

    MiniMap.prototype._bind = function () {
        var self = this, drag = null, moved = false;
        this.el.addEventListener("pointerdown", function (e) {
            if (e.target.closest(".mm-zoom, .mm-popup, .mm-pin")) return;
            drag = { x: e.clientX, y: e.clientY, c: project(self.center[0], self.center[1], self.zoom) };
            moved = false; self.el.setPointerCapture(e.pointerId); self.el.classList.add("mm-drag");
        });
        this.el.addEventListener("pointermove", function (e) {
            if (!drag) return;
            var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
            if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
            var ll = unproject(drag.c.x - dx, drag.c.y - dy, self.zoom);
            self.center = [ll.lat, ll.lng]; self.render();
        });
        function end(e) {
            if (!drag) return; drag = null; self.el.classList.remove("mm-drag");
            if (!moved && !e.target.closest(".mm-pin")) self.closePopup();
        }
        this.el.addEventListener("pointerup", end);
        this.el.addEventListener("pointercancel", end);
        this.el.addEventListener("wheel", function (e) {
            e.preventDefault();
            // zoom towards the cursor so the spot you point at stays under it
            var r = self.el.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
            var nz = Math.max(self.minZoom, Math.min(self.maxZoom, self.zoom + (e.deltaY < 0 ? 1 : -1)));
            if (nz === self.zoom) return;
            var c = project(self.center[0], self.center[1], self.zoom);
            var under = unproject(c.x - r.width / 2 + px, c.y - r.height / 2 + py, self.zoom);
            var u2 = project(under.lat, under.lng, nz), ll = unproject(u2.x - px + r.width / 2, u2.y - py + r.height / 2, nz);
            self.center = [ll.lat, ll.lng]; self.zoom = nz; self.render();
        }, { passive: false });
        this.el.querySelector(".mm-zoom").addEventListener("click", function (e) {
            var b = e.target.closest("button"); if (b) self.setZoom(self.zoom + Number(b.dataset.z));
        });
        if (window.ResizeObserver) new ResizeObserver(function () { self.render(); }).observe(this.el);
    };

    MiniMap.prototype.setZoom = function (z) {
        this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, z)); this.render();
    };
    MiniMap.prototype.setView = function (lat, lng, z) { this.center = [lat, lng]; if (z) this.zoom = z; this.render(); };

    MiniMap.prototype.fit = function (points) {
        points = (points || []).filter(function (p) { return p && isFinite(p[0]) && isFinite(p[1]); });
        if (!points.length) return;
        var w = this.el.clientWidth - 80, h = this.el.clientHeight - 80, z;
        for (z = this.maxZoom - 3; z > this.minZoom; z--) {
            var xs = points.map(function (p) { return project(p[0], p[1], z).x; }), ys = points.map(function (p) { return project(p[0], p[1], z).y; });
            if (Math.max.apply(0, xs) - Math.min.apply(0, xs) <= w && Math.max.apply(0, ys) - Math.min.apply(0, ys) <= h) break;
        }
        var lat = (Math.max.apply(0, points.map(function (p) { return p[0]; })) + Math.min.apply(0, points.map(function (p) { return p[0]; }))) / 2;
        var lng = (Math.max.apply(0, points.map(function (p) { return p[1]; })) + Math.min.apply(0, points.map(function (p) { return p[1]; }))) / 2;
        this.setView(lat, lng, z);
    };

    MiniMap.prototype.addMarker = function (o) {
        var self = this, el = document.createElement("div");
        el.className = "mm-pin mm-" + (o.kind || "food") + (o.urgent ? " mm-urgent" : "");
        el.title = o.label || "";
        el.innerHTML = '<span class="mm-pin-body"><i>' + (o.text || ICON[o.kind] || "") + '</i></span>' +
            (o.label ? '<span class="mm-pin-label">' + o.label.replace(/</g, "&lt;") + '</span>' : "");
        var m = { lat: o.lat, lng: o.lng, el: el, popup: o.popup, opts: o };
        el.addEventListener("click", function (e) { e.stopPropagation(); self.openPopup(m); if (o.onClick) o.onClick(m); });
        this.markerLayer.appendChild(el); this.markers.push(m); this.render();
        return m;
    };
    MiniMap.prototype.removeMarkers = function () {
        this.markers.forEach(function (m) { m.el.remove(); }); this.markers = []; this.closePopup();
    };

    MiniMap.prototype.openPopup = function (m) {
        if (!m.popup) return;
        this.active = m; this.popup.innerHTML = '<button type="button" class="mm-x" aria-label="Close">×</button>' + m.popup;
        this.popup.hidden = false; this.popup.querySelector(".mm-x").onclick = this.closePopup.bind(this);
        this.render();
    };
    MiniMap.prototype.closePopup = function () { this.active = null; this.popup.hidden = true; };

    MiniMap.prototype.render = function () {
        var w = this.el.clientWidth, h = this.el.clientHeight, z = this.zoom;
        if (!w || !h) return;
        var c = project(this.center[0], this.center[1], z), x0 = c.x - w / 2, y0 = c.y - h / 2;
        this._drawGrid(w, h, x0, y0, z);
        this.markers.forEach(function (m) {
            var p = project(m.lat, m.lng, z);
            m.el.style.transform = "translate(" + Math.round(p.x - x0) + "px," + Math.round(p.y - y0) + "px)";
        });
        if (this.active && !this.popup.hidden) {
            var a = project(this.active.lat, this.active.lng, z);
            var py = a.y - y0, below = py < 190;   // not enough room above the pin -> show the card underneath
            this.popup.classList.toggle("mm-below", below);
            this.popup.style.left = Math.round(Math.min(Math.max(a.x - x0, 150), w - 150)) + "px";
            this.popup.style.top = Math.round(below ? py + 8 : py - 46) + "px";
        }
    };


    // Offline background: land-coloured canvas with a latitude/longitude grid, labels and a scale bar
    MiniMap.prototype._drawGrid = function (w, h, x0, y0, z) {
        var cv = this.canvas, dpr = window.devicePixelRatio || 1;
        if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + "px"; cv.style.height = h + "px"; }
        var g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.fillStyle = "#eaf1ec"; g.fillRect(0, 0, w, h);
        var tl = unproject(x0, y0, z), br = unproject(x0 + w, y0 + h, z);
        var span = Math.max(Math.abs(br.lng - tl.lng), 1e-6);
        var steps = [20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001], step = steps[steps.length - 1];
        for (var i = 0; i < steps.length; i++) if (span / steps[i] >= 4) { step = steps[i]; break; }
        g.font = "11px sans-serif"; g.textBaseline = "top";
        function line(x1, y1, x2, y2, major) { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.strokeStyle = major ? "rgba(22,101,52,.28)" : "rgba(22,101,52,.14)"; g.lineWidth = 1; g.stroke(); }
        for (var lng = Math.ceil(tl.lng / step) * step; lng <= br.lng; lng += step) {
            var px = Math.round(project(0, lng, z).x - x0) + .5; line(px, 0, px, h, Math.abs(lng % (step * 5)) < 1e-9);
            g.fillStyle = "rgba(20,70,40,.6)"; g.fillText(lng.toFixed(step < 0.01 ? 3 : step < 1 ? 2 : 0) + "°E", px + 3, h - 15);
        }
        for (var lat = Math.ceil(br.lat / step) * step; lat <= tl.lat; lat += step) {
            var py = Math.round(project(lat, 0, z).y - y0) + .5; line(0, py, w, py, Math.abs(lat % (step * 5)) < 1e-9);
            g.fillStyle = "rgba(20,70,40,.6)"; g.fillText(lat.toFixed(step < 0.01 ? 3 : step < 1 ? 2 : 0) + "°N", 4, py + 2);
        }
        // scale bar
        var mid = (tl.lat + br.lat) / 2, mpp = 156543.03392 * Math.cos(mid * Math.PI / 180) / Math.pow(2, z) * (256 / 256);
        var nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000], m = nice[0];
        for (var k = 0; k < nice.length; k++) if (nice[k] / mpp <= 110) m = nice[k];
        var bw = m / mpp; g.fillStyle = "rgba(255,255,255,.85)"; g.fillRect(8, h - 34, bw + 56, 18);
        g.fillStyle = "#14532d"; g.fillRect(12, h - 22, bw, 3); g.fillRect(12, h - 27, 2, 8); g.fillRect(12 + bw - 2, h - 27, 2, 8);
        g.fillText(m >= 1000 ? (m / 1000) + " km" : m + " m", 18 + bw, h - 31);
    };

    MiniMap.project = project;
    window.MiniMap = MiniMap;
})();
