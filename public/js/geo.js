/*! SavoResQ Geo helpers - address/pincode -> coordinates (offline), distance, directions */
(function () {
    // OFFLINE: no internet lookups. A pincode's first two digits give a rough region centre (India Post zones);
    // the full pincode then shifts the point a few km so different pincodes land at different spots.
    var REGION = {
        11:[28.6,77.2],12:[28.4,76.9],13:[29.9,76.6],14:[31.0,75.5],15:[30.7,75.0],16:[30.7,76.7],17:[31.1,77.2],18:[32.7,74.9],19:[34.0,74.8],
        20:[28.9,79.4],21:[26.5,80.3],22:[26.8,80.9],23:[25.3,83.0],24:[29.9,78.1],25:[28.4,79.4],26:[27.2,78.0],27:[26.8,82.2],28:[26.4,80.5],
        30:[26.9,75.8],31:[26.9,75.0],32:[27.5,73.5],33:[26.3,73.0],34:[26.3,73.0],36:[22.3,70.8],37:[23.0,72.6],38:[23.0,72.6],39:[21.2,72.8],
        40:[19.1,72.9],41:[18.5,73.9],42:[20.0,73.8],43:[21.1,79.1],44:[21.1,79.1],45:[22.7,75.9],46:[23.3,77.4],47:[23.2,79.9],48:[22.0,79.5],49:[21.3,81.6],
        50:[17.4,78.5],51:[15.9,78.0],52:[16.5,80.6],53:[17.7,83.3],56:[12.97,77.6],57:[12.3,76.6],58:[15.4,75.1],59:[15.8,74.5],
        60:[13.08,80.27],61:[10.8,78.7],62:[9.92,78.12],63:[9.2,78.8],64:[11.0,76.96],67:[11.25,75.78],68:[9.97,76.28],69:[8.5,76.95],
        70:[22.57,88.36],71:[22.6,88.3],72:[23.5,87.5],73:[26.7,88.4],74:[24.0,88.2],75:[20.3,85.8],76:[20.5,84.5],77:[21.5,83.9],78:[26.15,91.75],79:[27.1,93.6],
        80:[25.6,85.1],81:[24.8,85.0],82:[23.4,85.3],83:[23.4,86.4],84:[26.1,85.4],85:[25.5,87.5]
    };
    function locate(p) {
        var pin = String(p.pincode || "").replace(/\D/g, "");
        var base = REGION[pin.slice(0, 2)] || [22.5, 79];
        var h = 0, str = pin || String(p.city || "") + String(p.address || "");
        for (var i = 0; i < str.length; i++) h = (h * 131 + str.charCodeAt(i)) | 0;
        var a = (Math.abs(h) % 360) * Math.PI / 180, d = 0.02 + (Math.abs(h >> 9) % 100) / 100 * 0.35;   // ~2 - 40 km
        return Promise.resolve({ lat: base[0] + Math.sin(a) * d, lng: base[1] + Math.cos(a) * d, precise: false });
    }

    function bearing(a, b) { var r = Math.PI / 180, y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r), x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r); return (Math.atan2(y, x) / r + 360) % 360; }
    function km(a, b) {
        var R = 6371, rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
        var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 2 * R * Math.asin(Math.sqrt(h));
    }
    function fmtKm(d) { return d < 1 ? Math.round(d * 1000) + " m" : d.toFixed(1) + " km"; }
    // Offline replacement for map directions: compass direction + straight-line distance
    function directions(from, to) {
        if (!from || !to) return "";
        var rad = Math.PI / 180, y = Math.sin((to.lng - from.lng) * rad) * Math.cos(to.lat * rad);
        var x = Math.cos(from.lat * rad) * Math.sin(to.lat * rad) - Math.sin(from.lat * rad) * Math.cos(to.lat * rad) * Math.cos((to.lng - from.lng) * rad);
        var br = (Math.atan2(y, x) / rad + 360) % 360, names = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
        return fmtKm(km(from, to)) + " to the " + names[Math.round(br / 45) % 8];
    }
    // Places that only resolved to the pincode centre would stack on one point; spread them a little (about 0.3 - 1.7 km)
    function spread(pos, seed) {
        if (!pos || pos.precise !== false) return pos;
        var h = 2166136261, str = String(seed || "");
        for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
        h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13; h = Math.imul(h, 3266489909); h ^= h >>> 16;   // mix well so similar names land far apart
        var u = (h >>> 0), a = (u % 3600) / 3600 * 2 * Math.PI, d = 0.004 + ((u >>> 12) % 1000) / 1000 * 0.014;   // about 0.4 - 2 km
        return { lat: pos.lat + Math.sin(a) * d, lng: pos.lng + Math.cos(a) * d, precise: false };
    }
    // exact GPS of the person using the page (asks the browser for permission)
    function here() {
        return new Promise(function (resolve) {
            if (!navigator.geolocation) return resolve(null);
            navigator.geolocation.getCurrentPosition(
                function (p) { resolve({ lat: p.coords.latitude, lng: p.coords.longitude, precise: true }); },
                function () { resolve(null); }, { enableHighAccuracy: true, timeout: 10000 });
        });
    }
    function saveMine(loc) {
        return fetch("/account/location", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(loc) }).catch(function () {});
    }

    window.Geo = { bearing: bearing, locate: locate, spread: spread, here: here, km: km, fmtKm: fmtKm, directions: directions, saveMine: saveMine };
})();
