/**
 * SavoResQ - demo data (run right before your demo):   npm run seed
 * Creates approved hotels / NGOs in 3 different pincodes plus a few donations,
 * so you can show that only same-pincode hotels, NGOs and food see each other.
 * All demo passwords: Demo@1234      Safe to run again (it replaces the old demo data).
 */
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const connectDB = require("./config/db");
const User = require("./models/User");
const Donation = require("./models/Donation");

const PASSWORD = "Demo@1234";
const mins = (m) => new Date(Date.now() + m * 60000);

const ORGS = [
    // role, short email name, organisation, pincode, city, address, [lat, lng]
    // Sivakasi accounts use EXACT positions so the radar shows real distances from Hope Foundation:
    //   Green Leaf 200 m north | Annapoorna 300 m east | Seva Trust 350 m west | Spice Garden 400 m south
    ["hotel", "green",    "Green Leaf Hotel",   "626001", "Sivakasi", "12 Main Road", [9.451799, 77.8]],
    ["hotel", "annapoorna", "Annapoorna Mess",  "626001", "Sivakasi", "5 Temple Street", [9.45, 77.802735]],
    ["hotel", "spice",    "Spice Garden",       "626001", "Sivakasi", "48 Bazaar Road", [9.446403, 77.8]],
    ["ngo",   "hope",     "Hope Foundation",    "626001", "Sivakasi", "9 Gandhi Nagar", [9.45, 77.8]],
    ["ngo",   "seva",     "Seva Trust",         "626001", "Sivakasi", "21 Anna Colony", [9.45, 77.796809]],
    ["hotel", "marina",   "Marina Meals",       "600001", "Chennai",  "3 Beach Road", [13.0827, 80.2707]],
    ["ngo",   "chennaicares", "Chennai Cares",  "600001", "Chennai",  "7 Mount Road", [13.085, 80.273]],
    ["ngo",   "madurai",  "Madurai Seva",       "625001", "Madurai",  "15 West Masi Street", [9.9252, 78.1198]]
];

const FOOD = [
    // hotel key, food, portions, minutes until unsafe
    ["green", "Pasta", 25, 40],
    ["annapoorna", "Veg Biryani", 50, 90],
    ["spice", "Idli", 35, 200],
    ["marina", "Dosa", 40, 120]
];

(async () => {
    await connectDB();
    const old = await User.find({ email: /@demo\.savoresq$/ }).select("_id");
    await Donation.deleteMany({ hotelId: { $in: old.map((u) => u._id) } });
    await User.deleteMany({ email: /@demo\.savoresq$/ });

    const hash = await bcrypt.hash(PASSWORD, 10);
    const byKey = {};
    for (const [role, key, org, pincode, city, address, ll] of ORGS) {
        byKey[key] = await User.create({
            name: org, email: `${key}@demo.savoresq`, password: hash, phone: "9876500000",
            organizationName: org, registrationNumber: "DEMO-" + key.toUpperCase(),
            address, city, state: "Tamil Nadu", country: "India", pincode,
            location: { lat: ll[0], lng: ll[1] },
            role, approvalStatus: "Approved", accountStatus: "Active"
        });
    }
    for (const [key, food, qty, m] of FOOD) {
        const h = byKey[key];
        await Donation.create({ hotelId: h._id, foodName: food, quantity: qty, pincode: h.pincode, expiryTime: mins(m), status: "Available" });
    }
    console.log("\nDemo data ready. Password for every account: " + PASSWORD + "\n");
    ORGS.forEach(([role, key, org, pin]) => console.log(`  ${role.padEnd(5)} ${key}@demo.savoresq   ${pin}   ${org}`));
    console.log("\nNote: food expires in 40 min - 3 h, so run this again if you demo later.\n");
    await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
