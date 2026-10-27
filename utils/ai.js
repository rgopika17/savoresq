/**
 * SavoResQ "smart" helpers - small, explainable algorithms that run offline
 * (no external AI service or API key needed).
 *   1. suggestSafety()   - food-safety hold time by food type
 *   2. matchScore()      - how well a donation fits a given NGO (0-100)
 *   3. predictSurplus()  - when a hotel usually has surplus food
 *   4. impactOf()        - meals / kg / CO2 estimates
 */

// ---------- 1. Food safety ----------
// Conservative hold times (hours at room temperature after cooking), based on the
// common "2-4 hour danger zone" food-safety guidance. They are guidelines, not law.
const SAFETY_RULES = [
    { id: "dairy",   label: "Dairy & milk sweets",   hours: 3,  words: ["curd", "yogurt", "yoghurt", "paneer", "milk", "kheer", "payasam", "rasmalai", "ice cream", "icecream", "cheese", "lassi", "buttermilk", "rasgulla"], tip: "Keep chilled below 5°C until pickup." },
    { id: "nonveg",  label: "Meat, fish & egg",      hours: 3,  words: ["chicken", "mutton", "fish", "egg", "prawn", "beef", "kebab", "tikka", "keema", "sausage"], tip: "Keep hot above 60°C or chilled below 5°C." },
    { id: "rice",    label: "Cooked rice & biryani", hours: 4,  words: ["rice", "biryani", "pulao", "pulav", "khichdi", "pongal", "fried rice"], tip: "Cool quickly and cover. Rice left warm is a common cause of food poisoning." },
    { id: "curry",   label: "Curries, dal & soups",  hours: 4,  words: ["curry", "dal", "sambar", "sambhar", "rasam", "soup", "gravy", "masala", "kurma", "korma", "stew", "kootu"], tip: "Pack in closed containers while still hot (above 60°C)." },
    { id: "cooked",  label: "Cooked meals & snacks", hours: 6,  words: ["chapati", "roti", "poori", "puri", "parotta", "paratha", "dosa", "idli", "vada", "noodles", "pasta", "pizza", "burger", "sandwich", "samosa", "momos", "fries", "thali", "meal"], tip: "Keep covered and away from moisture." },
    { id: "sweets",  label: "Dry sweets & bakery",   hours: 24, words: ["cake", "cookie", "biscuit", "bread", "bun", "laddu", "ladoo", "jalebi", "halwa", "gulab jamun", "sweet", "pastry", "muffin", "rusk"], tip: "Store in a dry, sealed container." },
    { id: "fruit",   label: "Fruits & raw produce",  hours: 24, words: ["fruit", "apple", "banana", "mango", "orange", "grapes", "watermelon", "pineapple", "salad", "vegetable", "papaya", "guava"], tip: "Wash and keep cool; discard if bruised." }
];

function suggestSafety(foodName) {
    const t = String(foodName || "").toLowerCase();
    for (const r of SAFETY_RULES) {
        if (r.words.some(w => t.includes(w))) return { id: r.id, label: r.label, hours: r.hours, tip: r.tip, matched: true };
    }
    return { id: "other", label: "Prepared food", hours: 4, tip: "When unsure, choose the shorter time.", matched: false };
}

// ---------- 2. Smart match ----------
function haversineKm(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}
const hasLoc = (l) => l && l.lat != null && l.lng != null;
const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));

/**
 * donation: { quantity, expiryTime, hotelLoc }
 * ngo: { loc, avgPortions, completed, accepted, released }
 * Returns { pct, km, reasons[] }
 */
function matchScore(donation, ngo) {
    const reasons = [];
    // distance (40 pts): full marks within 1 km, none beyond 10 km; same pincode but unknown = 0.6
    let km = null, dist = 0.6;
    // Both sides share a pincode, so they cannot really be more than ~25 km apart; a bigger number means a
    // wrong/old saved location (e.g. a GPS fix from another city) and is ignored instead of ruining the score.
    if (hasLoc(donation.hotelLoc) && hasLoc(ngo.loc) && haversineKm(donation.hotelLoc, ngo.loc) <= 25) {
        km = haversineKm(donation.hotelLoc, ngo.loc);
        dist = clamp(1 - (km - 1) / 9);
        reasons.push(km < 1 ? "Very close to you" : `${km.toFixed(1)} km away`);
    } else reasons.push("Same pincode");

    // time (25 pts): enough time for pickup, but reward food that needs rescuing soon
    const minsLeft = Math.max(0, (new Date(donation.expiryTime) - Date.now()) / 60000);
    const travel = km != null ? km * 4 + 20 : 40;   // rough pickup minutes
    let time = 0;
    if (minsLeft >= travel) { time = minsLeft <= 180 ? 1 : minsLeft <= 480 ? 0.8 : 0.6; reasons.push(minsLeft <= 180 ? "Needs rescuing soon" : "Enough time to collect"); }
    else reasons.push("Tight on time");

    // size (20 pts): close to what this NGO usually handles
    let size = 0.6;
    if (ngo.avgPortions > 0) {
        const ratio = donation.quantity / ngo.avgPortions;
        size = ratio >= 0.5 && ratio <= 1.6 ? 1 : ratio < 0.5 ? 0.6 : clamp(1.6 / ratio);
        reasons.push(size >= 0.9 ? "Fits your usual size" : ratio > 1.6 ? "Larger than usual" : "Smaller than usual");
    }

    // reliability (15 pts): how often accepted food was actually collected
    let rel = 0.7;
    const taken = (ngo.completed || 0) + (ngo.released || 0);
    if (taken >= 2) { rel = (ngo.completed || 0) / taken; if (rel >= 0.8) reasons.push("Reliable pickups"); }

    const score = dist * 40 + time * 25 + size * 20 + rel * 15;
    return { pct: Math.round(clamp(score / 100) * 100), km, reasons: reasons.slice(0, 3) };
}

// ---------- 3. Surplus prediction ----------
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function slotOf(h) { return h < 12 ? "morning" : h < 16 ? "afternoon" : h < 20 ? "evening" : "night"; }

/** donations: [{ createdAt, quantity }] -> forecast for the next occurrence of the busiest weekday */
function predictSurplus(donations, now = new Date()) {
    const list = (donations || []).filter(d => d.createdAt);
    const byDay = Array.from({ length: 7 }, (_, i) => ({ day: DAYS[i], count: 0, portions: 0 }));
    list.forEach(d => { const x = byDay[new Date(d.createdAt).getDay()]; x.count++; x.portions += Number(d.quantity) || 0; });
    if (list.length < 3) return { ready: false, samples: list.length, byDay };

    const top = byDay.reduce((a, b) => (b.count > a.count ? b : a));
    const topIdx = DAYS.indexOf(top.day);
    const hours = list.filter(d => new Date(d.createdAt).getDay() === topIdx).map(d => new Date(d.createdAt).getHours());
    const avgHour = Math.round(hours.reduce((a, b) => a + b, 0) / hours.length);
    const next = new Date(now); next.setHours(0, 0, 0, 0);
    let add = (topIdx - next.getDay() + 7) % 7;
    if (add === 0 && now.getHours() > avgHour + 2) add = 7;
    next.setDate(next.getDate() + add);
    const share = top.count / list.length;
    const confidence = Math.round(clamp(0.35 + Math.min(list.length, 20) / 40 + share * 0.4) * 100);
    return {
        ready: true, samples: list.length, byDay, day: top.day, slot: slotOf(avgHour), hour: avgHour,
        avgPortions: Math.round(top.portions / top.count), nextDate: next, daysAway: add, confidence
    };
}

// ---------- 4. Impact ----------
const KG_PER_PORTION = 0.4;       // assumption: one portion is about 400 g of food
const CO2_PER_KG = 2.5;           // kg CO2e avoided per kg of food kept out of waste (commonly used estimate)
const KM_PER_KG_CO2 = 1 / 0.12;   // an average petrol car emits roughly 0.12 kg CO2 per km
function impactOf(portions) {
    const p = Number(portions) || 0;
    const kg = p * KG_PER_PORTION, co2 = kg * CO2_PER_KG;
    return { meals: p, kg: Math.round(kg), co2: Math.round(co2), carKm: Math.round(co2 * KM_PER_KG_CO2) };
}

module.exports = { SAFETY_RULES, suggestSafety, matchScore, predictSurplus, impactOf, haversineKm };
