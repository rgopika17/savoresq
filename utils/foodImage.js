/**
 * SavoResQ - food name -> matching visual
 *
 * Every donation card asks this helper for a visual. It matches the typed food
 * name (including common spelling variants such as briyani / biriyani / idly)
 * against the list below, most specific entries first.
 *
 *  - `photo`  (optional) a real photo (bundled in /public/image/foods) shown on top of the tile.
 *  - emoji + gradient   a themed tile that always renders, even offline, and is
 *                       what the user sees if a photo fails to load.
 *
 * To add a new food: add one line to FOODS. To use your own picture, put the
 * file in /public/image/ and set  photo: "/image/my-dish.jpg".
 */

const { foodArt } = require("./foodArt");

const P = (name) => `/image/foods/${name}.jpg`;

// [label, illustration key (see foodArt.js), gradient-from, gradient-to, keywords[], photo?]
const FOODS = [
    // ---------- specific combos first ----------
    ["Chicken Curry", "chicken", "#f6b26b", "#c0562b", ["chicken curry", "butter chicken", "chicken masala", "chicken gravy"], P("curry")],

    // ---------- rice dishes (specific first) ----------
    ["Biryani", "biryani", "#f6c26b", "#e07a2f", ["biryani", "briyani", "biriyani", "biriani", "dum rice"], P("biryani")],
    ["Fried Rice", "friedrice", "#ffe08a", "#f4a259", ["fried rice", "egg rice", "schezwan rice", "szechuan rice"], P("friedrice")],
    ["Curd Rice", "currdrice", "#f5f7ef", "#cfe3d0", ["curd rice", "thayir sadam", "yogurt rice"]],
    ["Lemon Rice", "lemonrice", "#fff3a3", "#f2c94c", ["lemon rice", "puliyodarai", "tamarind rice", "tomato rice", "coconut rice"]],
    ["Pulao", "rice", "#ffe9b8", "#e9a64b", ["pulao", "pulav", "pilaf", "veg rice", "ghee rice", "jeera rice"]],
    ["Meals", "thali", "#bfe3c0", "#5fa86e", ["meals", "thali", "lunch", "full meal", "combo", "lunch box"]],
    ["Rice", "rice", "#f3efe2", "#d8d0b0", ["rice", "sadam", "sambar rice", "bisibele", "khichdi", "kichadi"]],

    // ---------- tiffin ----------
    ["Idli", "idli", "#fbf6ea", "#d9cdb0", ["idli", "idly"], P("idli")],
    ["Dosa", "dosa", "#f7d9a0", "#d9a14a", ["dosa", "dosai", "uttapam", "oothappam", "adai", "pesarattu"], P("dosa")],
    ["Vada", "vada", "#f1c27d", "#c98a3b", ["vada", "vadai", "medu vada", "bonda", "bajji", "pakoda", "pakora"]],
    ["Pongal", "curry", "#fde7a6", "#e5b94a", ["pongal", "upma", "kesari", "rava"]],
    ["Poori", "poori", "#f9d27a", "#e0a030", ["poori", "puri", "bhatura", "kachori"]],
    ["Parotta", "parotta", "#f5d9a6", "#cf9b55", ["parotta", "porotta", "paratha", "parantha", "kothu", "kothu parotta"]],
    ["Chapati", "chapati", "#f3dfb8", "#cfa66a", ["chapati", "chapathi", "roti", "phulka", "naan", "kulcha", "tortilla", "wrap"]],
    ["Bread", "bread", "#f2d6a2", "#c8955a", ["bread", "bun", "toast", "loaf", "pav", "croissant", "rusk"]],

    // ---------- western / fast food ----------
    ["Pizza", "pizza", "#ffd08a", "#e4572e", ["pizza"], P("pizza")],
    ["Burger", "burger", "#f6c177", "#b5651d", ["burger"], P("burger")],
    ["Sandwich", "sandwich", "#f4dba6", "#a8c686", ["sandwich", "sub", "club"]],
    ["Noodles", "noodles", "#ffe29a", "#e08e45", ["noodle", "noodles", "chowmein", "chow mein", "ramen", "hakka", "maggi"]],
    ["Pasta", "pasta", "#ffd7a1", "#d9534f", ["pasta", "spaghetti", "macaroni", "penne", "lasagna", "lasagne"], P("pasta")],
    ["Fries", "fries", "#ffe27a", "#e63946", ["fries", "french fries", "chips", "nuggets"]],
    ["Momos", "momos", "#f4ecd8", "#c9b99a", ["momo", "momos", "dumpling", "dimsum", "dim sum", "spring roll"]],
    ["Samosa", "samosa", "#f2c277", "#c27d38", ["samosa", "puff", "patties", "cutlet", "sundal", "snack", "murukku", "mixture"], P("samosa")],

    // ---------- curries & proteins ----------
    ["Chicken", "chicken", "#f6b26b", "#c0562b", ["chicken", "tandoori", "kebab", "kabab", "65", "wings", "fry piece"], P("chicken")],
    ["Mutton", "mutton", "#e59866", "#9c4a2a", ["mutton", "lamb", "beef", "pork", "keema", "nalli"]],
    ["Fish", "fish", "#a9d6e5", "#2a7ca3", ["fish", "prawn", "shrimp", "seafood", "crab", "meen"]],
    ["Egg", "egg", "#fff1c1", "#f5c542", ["egg", "omelette", "omelet", "muttai", "boiled egg"]],
    ["Paneer", "paneer", "#ffe8b0", "#e8a33d", ["paneer", "tofu", "cheese", "butter masala"], P("curry")],
    ["Dal", "dal", "#ffe08a", "#d9922b", ["dal", "dhal", "sambar", "rasam", "lentil", "chana", "rajma", "channa"]],
    ["Curry", "curry", "#f7b267", "#d1495b", ["curry", "gravy", "kurma", "korma", "masala", "kootu", "poriyal", "sabzi", "subzi", "stew"], P("curry")],
    ["Soup", "soup", "#ffd6a5", "#e07a5f", ["soup", "broth", "porridge", "kanji", "congee"]],

    // ---------- fresh ----------
    ["Salad", "salad", "#c7f0bd", "#4caf50", ["salad", "sprouts", "raita"]],
    ["Vegetables", "vegetables", "#c7f0bd", "#3f8f4f", ["vegetable", "veg ", "veggies", "carrot", "beans", "cabbage", "potato", "aloo", "gobi", "brinjal", "okra", "tomato"]],
    ["Mango", "mango", "#ffe29a", "#f59e0b", ["mango"]],
    ["Banana", "banana", "#fff3a3", "#f2c94c", ["banana", "plantain"]],
    ["Orange", "orange", "#ffd9a0", "#fb8c00", ["orange", "sweet lime", "mosambi", "lemon"]],
    ["Grapes", "grapes", "#e6d4ff", "#9b6dd6", ["grape"]],
    ["Watermelon", "watermelon", "#ffd1d1", "#e63946", ["watermelon", "melon"]],
    ["Pineapple", "pineapple", "#fff1a8", "#e0b43a", ["pineapple"]],
    ["Apple", "apple", "#ffd1d1", "#e5533d", ["apple"]],
    ["Fruits", "fruits", "#ffd1d1", "#ff8a65", ["fruit", "papaya", "pineapple", "guava", "pomegranate"]],

    // ---------- sweets & drinks ----------
    ["Cake", "cake", "#ffd6e7", "#f78fb3", ["cake", "pastry", "muffin", "brownie", "cupcake", "donut", "doughnut"], P("cake")],
    ["Sweets", "sweets", "#ffd9a0", "#e08a3a", ["sweet", "halwa", "laddu", "ladoo", "jalebi", "gulab jamun", "payasam", "kheer", "barfi", "burfi", "mysore pak", "pudding", "dessert"]],
    ["Ice Cream", "icecream", "#ffe0f0", "#b8c0ff", ["ice cream", "icecream", "kulfi"], P("icecream")],
    ["Cookies", "cookies", "#eacb9a", "#b07a3c", ["cookie", "biscuit", "cracker"], P("cookies")],
    ["Curd", "curd", "#f8fbff", "#cfe0ee", ["curd", "yogurt", "yoghurt", "buttermilk", "lassi", "milk"]],
    ["Beverage", "beverage", "#cdeffd", "#5aa9e6", ["juice", "tea", "coffee", "drink", "water", "soda", "beverage", "smoothie"]],
];

const DEFAULT_FOOD = ["Food", "food", "#cfe8d5", "#8ecb9f", [], null];

function normalise(text) {
    return " " + String(text || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim() + " ";
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Returns { label, emoji, from, to, photo } for a food name. */
function getFoodVisual(foodName) {
    const text = normalise(foodName);

    for (const [label, art, from, to, keywords, photo] of FOODS) {
        const hit = keywords.some((k) => {
            const key = k.toLowerCase();
            // short keywords (egg, dal, 65) must match whole words; longer ones match inside words
            return key.length <= 3 || key.endsWith(" ")
                ? text.includes(" " + key.trim() + " ")
                : text.includes(key);
        });
        if (hit) return { label, art, from, to, photo: photo || null };
    }

    const [label, art, from, to] = DEFAULT_FOOD;
    return { label, art, from, to, photo: null };
}

/**
 * Ready-to-print HTML that fills its (position:relative) parent.
 * Use in EJS with the unescaped tag:  <%- foodVisual(donation.foodName) %>
 */
function foodVisualHtml(foodName, size = 64, uploadedImage = null) {
    const v = getFoodVisual(foodName);
    const alt = escapeHtml(foodName || v.label);

    // a photo uploaded by the hotel always wins over the stock picture
    const photoUrl = uploadedImage
        ? "/uploads/donations/" + encodeURIComponent(String(uploadedImage).replace(/^.*[\\/]/, ""))
        : v.photo;

    const photo = photoUrl
        ? `<img src="${escapeHtml(photoUrl)}" alt="${alt}" ` +
          `style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" ` +
          `onerror="this.remove()">`
        : "";

    return (
        `<div role="img" aria-label="${alt}" ` +
        `style="position:absolute;inset:0;overflow:hidden;background:linear-gradient(135deg,${v.from},${v.to})">` +
        foodArt(v.art) +
        `</div>${photo}`
    );
}

module.exports = { getFoodVisual, foodVisualHtml };
