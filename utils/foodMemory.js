/**
 * SavoResQ - Food Memory (offline, no AI service)
 * Learns what each hotel usually posts and what each NGO usually rescues, from their own history.
 */
const { getFoodVisual } = require("./foodImage");

const key = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Hotel: [{ name, label, times, lastQty, avgQty, image }] most-posted first (image = last photo this hotel uploaded for that food) */
function hotelMemory(donations, limit = 8) {
    const map = new Map();
    donations.forEach((d) => {                       // donations arrive newest-first
        const k = key(d.foodName); if (!k) return;
        let m = map.get(k);
        if (!m) { m = { name: d.foodName, label: getFoodVisual(d.foodName).label, times: 0, lastQty: d.quantity, total: 0, image: null }; map.set(k, m); }
        m.times++; m.total += Number(d.quantity) || 0;
        if (!m.image && d.image) m.image = d.image;
    });
    return [...map.values()].map((m) => ({ ...m, avgQty: Math.round(m.total / m.times) }))
        .sort((a, b) => b.times - a.times).slice(0, limit);
}

/** NGO: [{ label, count, sample }] categories this NGO accepted most often */
function ngoTaste(myDonations, limit = 5) {
    const map = new Map();
    myDonations.forEach((d) => {
        if (!["Accepted", "Completed"].includes(d.status)) return;
        const label = getFoodVisual(d.foodName).label;
        const m = map.get(label) || { label, count: 0, sample: d.foodName };
        m.count++; map.set(label, m);
    });
    return [...map.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

module.exports = { hotelMemory, ngoTaste, key };
