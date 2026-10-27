const express = require("express");
const path = require("path");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const fs = require("fs");
const multer = require("multer");
require("dotenv").config();

const connectDB = require("./config/db");
const User = require("./models/User");
const Donation = require("./models/Donation");
const Feedback = require("./models/Feedback");
const ProfileUpdate = require("./models/ProfileUpdate");
const Notification = require("./models/Notification");
const SupportTicket = require("./models/SupportTicket");
const DonationChat = require("./models/DonationChat");

const app = express();
const PORT = process.env.PORT || 3000;

// ======================================================
// MIDDLEWARE
// ======================================================

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const isProd = process.env.NODE_ENV === "production";
if (isProd && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.startsWith("change_this"))) {
    console.error("SESSION_SECRET must be set to a long random value in production.");
    process.exit(1);
}
if (isProd) app.set("trust proxy", 1); // hosts terminate HTTPS at a proxy

// Health check for the hosting platform
app.get("/healthz", (req, res) => res.status(200).send("ok"));

const sessionOptions = {
    secret: process.env.SESSION_SECRET || "savorresq_session_secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: isProd,
        maxAge: 1000 * 60 * 60 * 4
    }
};
// In production keep sessions in MongoDB (the default in-memory store leaks and resets on restart)
if (isProd) {
    const MongoStore = require("connect-mongo");
    sessionOptions.store = MongoStore.create({
        mongoUrl: process.env.MONGO_URI,
        ttl: 60 * 60 * 4
    });
}
app.use(session(sessionOptions));

// Session handling: never let the browser cache a page (so Back after logout cannot show an old page)
app.use((req, res, next) => {
    res.set({
        "Cache-Control": "no-store, no-cache, must-revalidate, private",
        Pragma: "no-cache",
        Expires: "0"
    });
    next();
});

// ======================================================
// EJS + STATIC FILES
// ======================================================

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

// ======================================================
// PER-REQUEST PAGE DATA (sidebar, flash messages, live account check)
// ======================================================

function flash(req, type, text) {
    req.session.flash = { type, text };
}

app.use(async (req, res, next) => {
    res.locals.currentUser = null;
    res.locals.navCounts = {};
    res.locals.flash = null;

    const isPageRequest =
        req.method === "GET" &&
        !req.path.includes(".") &&
        !req.path.startsWith("/notifications") &&
        req.accepts(["html", "json"]) === "html";

    if (isPageRequest && req.session.flash) {
        res.locals.flash = req.session.flash;
        delete req.session.flash;
    }

    const sessionUser = req.session.user;
    if (!sessionUser || req.path.startsWith("/notifications")) return next();

    try {
        const account = await User.findById(sessionUser.id)
            .select("name organizationName role accountStatus pincode");

        // Suspended / deleted while logged in -> end the session immediately
        if (!account || ["Suspended", "Deleted"].includes(account.accountStatus)) {
            return req.session.destroy(() => res.redirect("/login"));
        }

        // Keep the session in sync (e.g. after an admin approves a pincode change)
        sessionUser.pincode = account.pincode;

        res.locals.currentUser = {
            id: sessionUser.id,
            role: account.role,
            name: account.name,
            orgName: account.organizationName || ""
        };

        if (!isPageRequest) return next();

        const counts = {};

        if (account.role === "admin") {
            counts.support = await SupportTicket.countDocuments({ unreadForAdmin: true, status: { $ne: "Resolved" }, kind: "admin" });
            const [pendingApprovals, profileUpdates, deletions] = await Promise.all([
                User.countDocuments({
                    role: { $in: ["hotel", "ngo"] },
                    approvalStatus: "Pending",
                    accountStatus: { $ne: "Deleted" }
                }),
                ProfileUpdate.countDocuments({ status: "Pending" }),
                User.countDocuments({ accountStatus: "Deletion Requested" })
            ]);
            Object.assign(counts, { pendingApprovals, profileUpdates, deletions });
        } else {
            if (account.role === "ngo") counts.feedbackPending = await pendingFeedbackCountFor(sessionUser.id);
            counts.supportReplies = await SupportTicket.countDocuments({ userId: sessionUser.id, unreadForUser: true });
            counts.chats = await DonationChat.countDocuments(account.role === "hotel" ? { hotelId: sessionUser.id, unreadForHotel: true } : { ngoId: sessionUser.id, unreadForNgo: true });
        }

        res.locals.navCounts = counts;
        next();
    } catch (error) {
        console.error("Page data error:", error);
        next();
    }
});

// completed rescues the NGO has not reviewed yet
async function pendingFeedbackCountFor(ngoId) {
    const [completed, reviewed] = await Promise.all([
        Donation.find({ acceptedBy: ngoId, status: "Completed" }).select("_id"),
        Feedback.find({ ngoId }).select("donationId")
    ]);
    const done = new Set(reviewed.map(f => String(f.donationId)));
    return completed.filter(d => !done.has(String(d._id))).length;
}

// Food name -> matching picture (used by hotel, NGO and feedback pages)
const { foodVisualHtml, getFoodVisual } = require("./utils/foodImage");
const FoodMemory = require("./utils/foodMemory");
app.locals.foodVisual = foodVisualHtml;

// ======================================================
// VERIFICATION DOCUMENT UPLOADS
// ======================================================

const UPLOAD_ROOT = process.env.UPLOAD_DIR || path.join(__dirname, "uploads");
const VERIFICATION_DIR = path.join(UPLOAD_ROOT, "verification");
fs.mkdirSync(VERIFICATION_DIR, { recursive: true });

const ALLOWED_DOC_TYPES = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png"
};

const verificationUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, VERIFICATION_DIR),
        filename: (req, file, cb) => {
            const ext = ALLOWED_DOC_TYPES[file.mimetype] || ".bin";
            const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
            cb(null, unique + ext);
        }
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        if (ALLOWED_DOC_TYPES[file.mimetype]) return cb(null, true);
        cb(new Error("INVALID_DOC_TYPE"));
    }
});

// Live picture preview while typing a food name (stock photo / illustration)
app.get("/food-visual", requireLogin, (req, res) => {
    const v = getFoodVisual(String(req.query.name || "").slice(0, 80));
    res.json({ label: v.label, hasPhoto: !!v.photo, html: foodVisualHtml(req.query.name, 64, null) });
});

// ---- food photos uploaded by hotels ----
const DONATION_DIR = path.join(UPLOAD_ROOT, "donations");
fs.mkdirSync(DONATION_DIR, { recursive: true });
app.use("/uploads/donations", express.static(DONATION_DIR, { maxAge: "7d" }));

const IMAGE_TYPES = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };

const donationUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, DONATION_DIR),
        filename: (req, file, cb) => {
            const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
            cb(null, unique + (IMAGE_TYPES[file.mimetype] || ".jpg"));
        }
    }),
    limits: { fileSize: 4 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) =>
        IMAGE_TYPES[file.mimetype] ? cb(null, true) : cb(new Error("INVALID_IMAGE_TYPE"))
});

// Runs the upload and turns upload problems into a friendly message on the form
function foodPhotoUpload(backTo) {
    return (req, res, next) => {
        donationUpload.single("foodImage")(req, res, err => {
            if (!err) return next();
            flash(req, "error", err.code === "LIMIT_FILE_SIZE"
                ? "The photo must be 4 MB or smaller."
                : "Please choose a JPG, PNG or WEBP photo.");
            res.redirect(typeof backTo === "function" ? backTo(req) : backTo);
        });
    };
}

function removeUploadedFile(file) {
    if (file && file.path) {
        fs.unlink(file.path, () => {});
    }
}

// ======================================================
// HELPERS
// ======================================================

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// Simple message page used for errors / notices
function messagePage(title, body, linkHref, linkText, color) {
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SavoResQ</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;font-family:"Segoe UI",system-ui,Arial,sans-serif;
background:radial-gradient(600px 300px at 20% 0%,#d9f3e5,transparent),#f3f6f4;color:#15231c}
.box{max-width:480px;width:100%;background:#fff;border:1px solid #e3eae6;border-radius:20px;padding:36px 30px;text-align:center;
box-shadow:0 10px 40px rgba(16,40,30,.1)}
h2{margin:0 0 10px;font-size:22px;color:${color || "#15231c"}}
p{margin:0 0 22px;color:#64756c;line-height:1.55}
a{display:inline-block;padding:11px 22px;border-radius:11px;background:#198754;color:#fff;font-weight:700;text-decoration:none}
a:hover{background:#156a4c}
</style></head><body><div class="box"><h2>${title}</h2>${body ? `<p>${body}</p>` : ""}<a href="${linkHref}">${linkText}</a></div></body></html>`;
}

// optional "approximate value in rupees" typed by the hotel (0 when empty/invalid)
function parseValue(input) {
    const n = Math.round(Number(String(input || "").replace(/,/g, "")));
    return Number.isFinite(n) && n > 0 ? Math.min(n, 10000000) : 0;
}

const sumValue = list => list.reduce((s, d) => s + (Number(d.estimatedValue) || 0), 0);

function countByStatus(list, status) {
    return list.filter(d => d.status === status).length;
}

// ======================================================
// CREATE ADMIN ACCOUNT
// ======================================================

async function createAdminAccount() {
    try {
        const adminEmail = (
            process.env.ADMIN_EMAIL || "admin@savorresq.com"
        ).trim().toLowerCase();

        const adminPassword = process.env.ADMIN_PASSWORD || "Admin@12345";

        let admin = await User.findOne({ email: adminEmail });

        if (admin) {
            console.log("Admin account already exists.");
            return;
        }

        const hashedPassword = await bcrypt.hash(adminPassword, 12);

        admin = new User({
            name: "SavoResQ Administrator",
            email: adminEmail,
            password: hashedPassword,
            role: "admin",
            country: "India",
            pincode: "000000",
            approvalStatus: "Approved",
            accountStatus: "Active"
        });

        await admin.save();

        console.log("=================================");
        console.log("ADMIN ACCOUNT CREATED");
        console.log("Email:", adminEmail);
        console.log("=================================");
    } catch (error) {
        console.error("Admin creation error:", error);
    }
}

// ======================================================
// EXPIRE OLD DONATIONS
// ======================================================

async function expireOldDonations() {
    try {
        const toExpire = await Donation.find({
            status: "Available",
            expiryTime: { $lte: new Date() }
        }).select("_id hotelId foodName quantity");

        if (!toExpire.length) return;

        await Donation.updateMany(
            { _id: { $in: toExpire.map(d => d._id) } },
            { $set: { status: "Expired" } }
        );

        for (const d of toExpire) {
            await notify(d.hotelId, {
                type: "expired",
                icon: "🥀",
                title: `${d.foodName} expired`,
                message: `${d.quantity} portions went unclaimed this time. Posting a little earlier or with a longer window can help next time.`,
                link: "/hotel#history",
                dedupeKey: `expired-${d._id}`
            });
        }
    } catch (error) {
        console.error("Expiry update error:", error);
    }
}

// ======================================================
// NOTIFICATIONS
// ======================================================

async function notify(userId, { type, icon, title, message, link, dedupeKey }) {
    try {
        await Notification.create({
            userId, type, icon, title, message, link,
            dedupeKey: dedupeKey || undefined
        });
    } catch (error) {
        // 11000 = duplicate dedupeKey, which is expected and harmless
        if (error.code !== 11000) {
            console.error("Notification error:", error.message);
        }
    }
}

const MILESTONES = [
    { portions: 50,   icon: "🌿", name: "Sprout" },
    { portions: 100,  icon: "🍱", name: "100 Portions Club" },
    { portions: 250,  icon: "🌳", name: "Sapling" },
    { portions: 500,  icon: "🏅", name: "Food Hero" },
    { portions: 1000, icon: "🌲", name: "Forest Keeper" }
];


const NGO_MILESTONES = [
    { portions: 50,   icon: "🌿", name: "Meal Maker" },
    { portions: 200,  icon: "🍲", name: "Community Feeder" },
    { portions: 500,  icon: "🏅", name: "Hunger Fighter" },
    { portions: 1000, icon: "🏆", name: "Feast Champion" }
];

// consecutive calendar weeks (ending this week or last) with at least one completed rescue
function weekStreak(dates) {
    const WEEK = 7 * 24 * 3600e3;
    const weeks = new Set(dates.map(d => Math.floor(new Date(d).getTime() / WEEK)));
    let w = Math.floor(Date.now() / WEEK);
    if (!weeks.has(w)) w -= 1;
    let streak = 0;
    while (weeks.has(w)) { streak++; w--; }
    return streak;
}

// Top hotels and NGOs of the current month ("Community Heroes")
async function communityHeroes() {
    const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
    const rank = async (field) => {
        const rows = await Donation.aggregate([
            { $match: { status: "Completed", updatedAt: { $gte: start }, [field]: { $ne: null } } },
            { $group: { _id: "$" + field, portions: { $sum: "$quantity" }, rescues: { $sum: 1 } } },
            { $sort: { portions: -1 } },
            { $limit: 3 }
        ]);
        const users = await User.find({ _id: { $in: rows.map(r => r._id) } }).select("name organizationName city");
        return rows.map(r => {
            const u = users.find(x => String(x._id) === String(r._id)) || {};
            return { id: String(r._id), name: u.organizationName || u.name || "Partner", city: u.city || "", portions: r.portions, rescues: r.rescues };
        });
    };
    return {
        month: start.toLocaleString("en-IN", { month: "long", year: "numeric" }),
        hotels: await rank("hotelId"),
        ngos: await rank("acceptedBy")
    };
}

const AI = require("./utils/ai");

// per-NGO history used by the Smart Match score
async function ngoStats(ids) {
    const rows = await Donation.aggregate([
        { $match: { acceptedBy: { $in: ids }, status: "Completed" } },
        { $group: { _id: "$acceptedBy", completed: { $sum: 1 }, avgPortions: { $avg: "$quantity" } } }
    ]);
    const rel = await Donation.aggregate([
        { $match: { releasedBy: { $in: ids } } },
        { $unwind: "$releasedBy" }, { $match: { releasedBy: { $in: ids } } },
        { $group: { _id: "$releasedBy", released: { $sum: 1 } } }
    ]);
    const map = {};
    ids.forEach(i => { map[String(i)] = { completed: 0, avgPortions: 0, released: 0 }; });
    rows.forEach(r => { map[String(r._id)].completed = r.completed; map[String(r._id)].avgPortions = r.avgPortions; });
    rel.forEach(r => { map[String(r._id)].released = r.released; });
    return map;
}

const certRef = (id) => "SRQ-" + String(id).slice(-8).toUpperCase();

async function totalRescuedPortions(hotelId) {
    const done = await Donation.find({ hotelId, status: "Completed" }).select("quantity");
    return done.reduce((sum, d) => sum + (Number(d.quantity) || 0), 0);
}

// "Expiring soon" nudges for donations nobody has claimed yet
async function createExpiringAlerts(hotelId) {
    const soon = new Date(Date.now() + 60 * 60 * 1000);
    const list = await Donation.find({
        hotelId,
        status: "Available",
        expiryTime: { $gt: new Date(), $lte: soon }
    }).select("foodName quantity expiryTime");

    for (const d of list) {
        const mins = Math.max(1, Math.round((d.expiryTime - Date.now()) / 60000));
        await notify(hotelId, {
            type: "expiring",
            icon: "⏳",
            title: `${d.foodName} is running out of time`,
            message: `${d.quantity} portions expire in about ${mins} min and no NGO has claimed them yet.`,
            link: "/hotel#history",
            dedupeKey: `expiring-${d._id}`
        });
    }
}

app.get("/notifications", requireLogin, async (req, res) => {
    try {
        if (req.session.user.role === "hotel") {
            await expireOldDonations();
            await createExpiringAlerts(req.session.user.id);
        }

        const [items, unread] = await Promise.all([
            Notification.find({ userId: req.session.user.id })
                .sort({ createdAt: -1 })
                .limit(20),
            Notification.countDocuments({ userId: req.session.user.id, read: false })
        ]);

        res.json({ unread, items });
    } catch (error) {
        console.error("Load notifications error:", error);
        res.status(500).json({ unread: 0, items: [] });
    }
});

app.post("/notifications/read-all", requireLogin, async (req, res) => {
    try {
        await Notification.updateMany(
            { userId: req.session.user.id, read: false },
            { read: true }
        );
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ ok: false });
    }
});

app.post("/notifications/:id/read", requireLogin, async (req, res) => {
    try {
        await Notification.updateOne(
            { _id: req.params.id, userId: req.session.user.id },
            { read: true }
        );
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ ok: false });
    }
});

// ======================================================
// AUTHENTICATION
// ======================================================

function requireLogin(req, res, next) {
    if (!req.session.user) {
        return res.redirect("/login");
    }
    next();
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.session.user) {
            return res.redirect("/login");
        }

        if (!roles.includes(req.session.user.role)) {
            return res.status(403).send(
                messagePage(
                    "❌ Access Denied",
                    "You are not authorized to access this page.",
                    "/",
                    "Go Home",
                    "#dc3545"
                )
            );
        }

        next();
    };
}

// ======================================================
// HOME
// ======================================================

function homeFor(user) {
    return user.role === "admin" ? "/admin" : user.role === "hotel" ? "/hotel" : "/ngo";
}

app.get("/", (req, res) => {
    res.render("index");
});

// ======================================================
// REGISTER
// ======================================================

app.get("/register", (req, res) => {
    if (req.session.user) return res.redirect(homeFor(req.session.user));
    res.render("register");
});

app.post(
    "/register",
    (req, res, next) => {
        verificationUpload.single("verificationDocument")(req, res, err => {
            if (!err) return next();

            let message = "The verification document could not be uploaded.";
            if (err.message === "INVALID_DOC_TYPE") {
                message = "Verification document must be a PDF, JPG, JPEG or PNG file.";
            } else if (err.code === "LIMIT_FILE_SIZE") {
                message = "Verification document must be 5 MB or smaller.";
            }

            return res.status(400).send(
                messagePage(
                    "❌ Invalid Verification Document",
                    message,
                    "/register",
                    "Go Back",
                    "#dc3545"
                )
            );
        });
    },
    async (req, res) => {
    try {
        const {
            name,
            email,
            password,
            role,
            phone,
            organizationName,
            registrationNumber,
            address,
            city,
            state,
            country,
            pincode
        } = req.body;

        // Basic validation
        if (!name || !email || !password || !role || !pincode) {
            removeUploadedFile(req.file);
        return res.status(400).send(
                messagePage(
                    "❌ Required Information Missing",
                    "Please complete all required fields.",
                    "/register",
                    "Go Back",
                    "#dc3545"
                )
            );
        }

        // Only hotel / NGO can register publicly
        if (role !== "hotel" && role !== "ngo") {
            removeUploadedFile(req.file);
        return res.status(403).send(
                messagePage(
                    "❌ Invalid Account Type",
                    "Admin accounts are created by the system.",
                    "/register",
                    "Go Back"
                )
            );
        }

        const cleanEmail = email.trim().toLowerCase();
        const cleanPincode = pincode.trim();

        if (!/^\d{6}$/.test(cleanPincode)) {
            removeUploadedFile(req.file);
        return res.status(400).send(
                messagePage(
                    "❌ Invalid Pincode",
                    "Please enter a valid 6-digit pincode.",
                    "/register",
                    "Go Back"
                )
            );
        }

        if (password.length < 8) {
            removeUploadedFile(req.file);
        return res.status(400).send(
                messagePage(
                    "❌ Password Too Short",
                    "Password must contain at least 8 characters.",
                    "/register",
                    "Go Back"
                )
            );
        }

        const existingUser = await User.findOne({ email: cleanEmail });

        if (existingUser) {
            removeUploadedFile(req.file);
        return res.status(409).send(
                messagePage(
                    "❌ Email Already Registered",
                    "Please use another email address.",
                    "/register",
                    "Go Back",
                    "#dc3545"
                )
            );
        }

        if (
            !phone ||
            !organizationName ||
            !registrationNumber ||
            !address ||
            !city ||
            !state
        ) {
            removeUploadedFile(req.file);
        return res.status(400).send(
                messagePage(
                    "❌ Organization Details Required",
                    "Hotel and NGO registration requires complete organization information. Please complete the registration form.",
                    "/register",
                    "Back to Registration",
                    "#dc3545"
                )
            );
        }

        if (!req.file) {
            return res.status(400).send(
                messagePage(
                    "❌ Verification Document Required",
                    "Please upload your registration/license document (PDF, JPG, JPEG or PNG, max 5 MB).",
                    "/register",
                    "Go Back",
                    "#dc3545"
                )
            );
        }

        const hashedPassword = await bcrypt.hash(password, 12);

        const user = new User({
            name: name.trim(),
            email: cleanEmail,
            password: hashedPassword,
            phone: phone.trim(),
            organizationName: organizationName.trim(),
            registrationNumber: registrationNumber.trim(),
            address: address.trim(),
            city: city.trim(),
            state: state.trim(),
            country: country ? country.trim() : "India",
            pincode: cleanPincode,
            role,

            verificationDocument: {
                filename: req.file.originalname,
                path: req.file.filename,
                mimetype: req.file.mimetype,
                uploadedAt: new Date()
            },

            // Both roles require admin approval
            approvalStatus: "Pending",
            accountStatus: "Active"
        });

        await user.save();

        const admins = await User.find({ role: "admin" }).select("_id");
        for (const admin of admins) {
            await notify(admin._id, {
                type: "registration",
                icon: "🛡️",
                title: `New ${role} registration`,
                message: `${user.organizationName} is waiting for verification.`,
                link: "/admin/verifications",
                dedupeKey: `registration-${user._id}`
            });
        }

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>SavoResQ Registration</title>
                <style>
                    body {
                        font-family: Arial;
                        background: #f4f7f6;
                        text-align: center;
                        padding: 60px 20px;
                    }
                    .box {
                        max-width: 600px;
                        margin: auto;
                        background: white;
                        padding: 40px;
                        border-radius: 15px;
                        box-shadow: 0 8px 30px rgba(0,0,0,0.08);
                    }
                    h1 { color: #198754; }
                    .pending {
                        background: #fff3cd;
                        padding: 20px;
                        border-radius: 10px;
                        margin: 25px 0;
                    }
                    a {
                        color: #198754;
                        font-weight: bold;
                        text-decoration: none;
                    }
                </style>
            </head>
            <body>
                <div class="box">
                    <h1>✅ Registration Submitted</h1>
                    <p>Welcome to SavoResQ.</p>
                    <div class="pending">
                        <h3>⏳ Pending Admin Verification</h3>
                        <p>Your organization details have been submitted successfully.</p>
                        <p>
                            An Admin / Authorized Verifier must approve your
                            organization before you can use SavoResQ.
                        </p>
                    </div>
                    <a href="/login">Go to Login</a>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error("Registration error:", error);
        removeUploadedFile(req.file);

        res.status(500).send(
            messagePage(
                "❌ Registration Failed",
                "Please try again.",
                "/register",
                "Go Back"
            )
        );
    }
}
);

// ======================================================
// LOGIN
// ======================================================

app.get("/login", (req, res) => {
    // already signed in -> go to own dashboard instead of showing the login form
    if (req.session.user) return res.redirect(homeFor(req.session.user));
    res.render("login");
});

app.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).send(
                messagePage(
                    "❌ Email and Password Required",
                    "",
                    "/login",
                    "Try Again"
                )
            );
        }

        const cleanEmail = email.trim().toLowerCase();
        const user = await User.findOne({ email: cleanEmail });

        const invalidLogin = () =>
            res.status(401).send(
                messagePage(
                    "❌ Invalid Email or Password",
                    "",
                    "/login",
                    "Try Again"
                )
            );

        if (!user) {
            return invalidLogin();
        }

        const passwordMatch = await bcrypt.compare(password, user.password);

        if (!passwordMatch) {
            return invalidLogin();
        }

        // Account status checks
        if (user.accountStatus === "Deleted") {
            return res.send(
                messagePage(
                    "❌ Account Deleted",
                    "This account is no longer active.",
                    "/login",
                    "Back to Login"
                )
            );
        }

        if (user.accountStatus === "Suspended") {
            return res.send(
                messagePage(
                    "🚫 Account Suspended",
                    "Your account has been suspended by the Admin.",
                    "/login",
                    "Back to Login",
                    "#dc3545"
                )
            );
        }

        if (user.accountStatus === "Deletion Requested") {
            return res.send(
                messagePage(
                    "⏳ Account Deletion Under Review",
                    "Your account deletion request is being reviewed by Admin.",
                    "/login",
                    "Back to Login"
                )
            );
        }

        // Admin login
        if (user.role === "admin") {
            req.session.user = {
                id: user._id.toString(),
                name: user.name,
                email: user.email,
                role: "admin",
                pincode: user.pincode
            };

            return res.redirect("/admin");
        }

        // Approval check
        if (user.approvalStatus !== "Approved") {
            if (user.approvalStatus === "Rejected") {
                const reason = user.rejectionReason
                    ? `<br><br><strong>Reason:</strong> ${escapeHtml(user.rejectionReason)}`
                    : "";

                return res.send(
                    messagePage(
                        "❌ Registration Rejected",
                        `Your organization registration was rejected by the Admin / Authorized Verifier.${reason}`,
                        "/login",
                        "Back to Login",
                        "#dc3545"
                    )
                );
            }

            return res.send(
                messagePage(
                    "⏳ Approval Pending",
                    "Your organization is waiting for Admin verification. You cannot access operational features until approval.",
                    "/login",
                    "Back to Login",
                    "#d97706"
                )
            );
        }

        // Session
        req.session.user = {
            id: user._id.toString(),
            name: user.name,
            email: user.email,
            role: user.role,
            pincode: user.pincode
        };

        if (user.role === "hotel") {
            return res.redirect("/hotel");
        }

        if (user.role === "ngo") {
            return res.redirect("/ngo");
        }

        res.status(403).send("Invalid account role.");
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).send("Login failed.");
    }
});

// ======================================================
// HOTEL DASHBOARD
// ======================================================

app.get("/hotel", requireRole("hotel"), async (req, res) => {
    try {
        await expireOldDonations();

        const donations = await Donation.find({
            hotelId: req.session.user.id
        })
            .populate(
                "acceptedBy",
                "name email phone pincode organizationName"
            )
            .sort({ createdAt: -1 });

        const rescuedQuantity = donations
            .filter(d => d.status === "Completed")
            .reduce((sum, d) => sum + (Number(d.quantity) || 0), 0);

        const valueRescued = sumValue(donations.filter(d => d.status === "Completed"));

        const hotel = await User.findById(req.session.user.id).select("pincode address city state location organizationName");
        const hotelPincode =
            (hotel && hotel.pincode) || req.session.user.pincode || "";

        const nearbyNgos = await User.find({
            role: "ngo", approvalStatus: "Approved", accountStatus: "Active", pincode: hotelPincode
        }).select("name organizationName phone address city state pincode location").limit(30);

        // AI helpers: best NGO per open donation, surplus forecast, impact
        const stats = await ngoStats(nearbyNgos.map(n => n._id));
        const bestNgo = {};
        donations.filter(d => d.status === "Available").forEach(d => {
            let best = null;
            nearbyNgos.forEach(n => {
                const st = stats[String(n._id)];
                const m = AI.matchScore(
                    { quantity: d.quantity, expiryTime: d.expiryTime, hotelLoc: hotel.location },
                    { loc: n.location, avgPortions: st.avgPortions, completed: st.completed, released: st.released }
                );
                if (!best || m.pct > best.pct) best = { name: n.organizationName || n.name, pct: m.pct, reasons: m.reasons };
            });
            if (best) bestNgo[String(d._id)] = best;
        });
        const forecast = AI.predictSurplus(donations);
        if (forecast.ready) forecast.nextLabel = forecast.nextDate.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" });
        const impact = AI.impactOf(rescuedQuantity);

        res.render("hotel", {
            foodMemory: FoodMemory.hotelMemory(donations),
            bestNgo, forecast, impact, safetyRules: AI.SAFETY_RULES,
            me: hotel,
            nearbyNgos,
            heroes: await communityHeroes(),
            donations,
            rescuedQuantity,
            valueRescued,
            hotelPincode,
            totalDonations: donations.length,
            available: countByStatus(donations, "Available"),
            accepted: countByStatus(donations, "Accepted"),
            completed: countByStatus(donations, "Completed"),
            expired: countByStatus(donations, "Expired"),
            cancelled: countByStatus(donations, "Cancelled")
        });
    } catch (error) {
        console.error("Hotel dashboard error:", error);
        res.status(500).send("Unable to load Hotel dashboard.");
    }
});

// ======================================================
// POST DONATION
// ======================================================

app.post("/donation", requireRole("hotel"), foodPhotoUpload("/hotel#post"), async (req, res) => {
    try {
        const fail = message => {
            removeUploadedFile(req.file);
            flash(req, "error", message);
            return res.redirect("/hotel#post");
        };

        const { foodName, quantity, pincode, expiryTime } = req.body;

        if (!foodName || !quantity || !pincode || !expiryTime) {
            return fail("Please fill in all donation fields.");
        }

        const cleanPincode = pincode.trim();

        if (!/^\d{6}$/.test(cleanPincode)) {
            return fail("Please enter a valid 6-digit pincode.");
        }

        // Donation pincode must match hotel pincode
        if (cleanPincode !== req.session.user.pincode) {
            return fail("The donation pincode must match your registered pincode.");
        }

        const expiryDate = new Date(expiryTime);

        if (isNaN(expiryDate.getTime()) || expiryDate <= new Date()) {
            return fail("The expiry time must be in the future.");
        }

        if (!(Number(quantity) >= 1)) {
            return fail("Quantity must be at least 1 portion.");
        }

        // Food memory: no new photo chosen -> reuse the photo this hotel uploaded for the same food before (copied, so editing one never breaks the other)
        let imageName = req.file ? req.file.filename : null;
        const reuse = String(req.body.reuseImage || "").replace(/^.*[\\/]/, "");
        if (!imageName && reuse) {
            const earlier = await Donation.findOne({ hotelId: req.session.user.id, image: reuse }).select("_id");
            const src = path.join(DONATION_DIR, reuse);
            if (earlier && fs.existsSync(src)) {
                imageName = Date.now() + "-" + Math.round(Math.random() * 1e9) + path.extname(reuse);
                try { fs.copyFileSync(src, path.join(DONATION_DIR, imageName)); } catch (e) { imageName = null; }
            }
        }

        const donation = new Donation({
            hotelId: req.session.user.id,
            foodName: foodName.trim(),
            quantity: Number(quantity),
            pincode: cleanPincode,
            expiryTime: expiryDate,
            image: imageName,
            estimatedValue: parseValue(req.body.estimatedValue),
            status: "Available",
            acceptedBy: null
        });

        await donation.save();

        // Tell approved NGOs in the same pincode that new food is available
        const hotel = await User.findById(req.session.user.id).select("organizationName name");
        const hotelName = (hotel && (hotel.organizationName || hotel.name)) || "A hotel";
        const nearbyNgos = await User.find({
            role: "ngo",
            pincode: cleanPincode,
            approvalStatus: "Approved",
            accountStatus: "Active"
        }).select("_id");

        for (const ngo of nearbyNgos) {
            await notify(ngo._id, {
                type: "new_donation",
                icon: "🍱",
                title: `New food: ${donation.foodName}`,
                message: `${hotelName} posted ${donation.quantity} portions in your area.`,
                link: "/ngo#available",
                dedupeKey: `new-${donation._id}`
            });
        }

        flash(req, "success", `“${donation.foodName}” is now visible to NGOs near you.`);
        res.redirect("/hotel#history");
    } catch (error) {
        console.error("Donation error:", error);
        removeUploadedFile(req.file);
        res.status(500).send("Failed to post donation.");
    }
});

// ======================================================
// HOTEL DONATION DETAILS
// ======================================================

app.get("/hotel/donation/:id", requireRole("hotel"), async (req, res) => {
    try {
        await expireOldDonations();

        const donation = await Donation.findOne({
            _id: req.params.id,
            hotelId: req.session.user.id
        })
            .populate(
                "hotelId",
                "name email phone address city state country pincode organizationName registrationNumber"
            )
            .populate(
                "acceptedBy",
                "name email phone pincode organizationName"
            );

        if (!donation) {
            return res.status(404).send("Donation not found.");
        }

        res.render("donation_details", { donation });
    } catch (error) {
        console.error("Donation details error:", error);
        res.status(500).send("Unable to load donation details.");
    }
});

// ======================================================
// DONATION CERTIFICATE (printable, completed donations only)
// ======================================================

app.get("/hotel/donation/:id/certificate", requireRole("hotel"), async (req, res) => {
    try {
        const donation = await Donation.findOne({
            _id: req.params.id,
            hotelId: req.session.user.id,
            status: "Completed"
        })
            .populate("hotelId", "name organizationName city state")
            .populate("acceptedBy", "name organizationName city state");

        if (!donation) {
            flash(req, "error", "A certificate is available only for completed donations.");
            return res.redirect("/hotel#history");
        }

        res.render("donation-certificate", { donation, ref: certRef(donation._id), verifyUrl: `${req.protocol}://${req.get("host")}/verify/${certRef(donation._id)}` });
    } catch (error) {
        console.error("Certificate error:", error);
        res.status(500).send("Unable to load the certificate.");
    }
});

// ======================================================
// EDIT DONATION
// ======================================================

app.get("/hotel/donation/:id/edit", requireRole("hotel"), async (req, res) => {
    try {
        await expireOldDonations();

        const donation = await Donation.findOne({
            _id: req.params.id,
            hotelId: req.session.user.id,
            status: "Available"
        });

        if (!donation) {
            return res.status(404).send("Donation cannot be edited.");
        }

        res.render("edit-donation", { donation });
    } catch (error) {
        console.error("Edit page error:", error);
        res.status(500).send("Unable to edit donation.");
    }
});

app.post(
    "/hotel/donation/:id/edit",
    requireRole("hotel"),
    foodPhotoUpload(req => `/hotel/donation/${req.params.id}/edit`),
    async (req, res) => {
    try {
        const fail = message => {
            removeUploadedFile(req.file);
            flash(req, "error", message);
            return res.redirect(`/hotel/donation/${req.params.id}/edit`);
        };

        const { foodName, quantity, pincode, expiryTime, removeImage } = req.body;

        if (!foodName || !quantity || !pincode || !expiryTime) {
            return fail("Please fill in all fields.");
        }

        const cleanPincode = pincode.trim();

        if (!/^\d{6}$/.test(cleanPincode)) {
            return fail("Please enter a valid 6-digit pincode.");
        }

        if (cleanPincode !== req.session.user.pincode) {
            return fail("The pincode must match your registered pincode.");
        }

        const expiryDate = new Date(expiryTime);

        if (isNaN(expiryDate.getTime()) || expiryDate <= new Date()) {
            return fail("The expiry time must be in the future.");
        }

        const existing = await Donation.findOne({
            _id: req.params.id,
            hotelId: req.session.user.id,
            status: "Available"
        });

        if (!existing) {
            removeUploadedFile(req.file);
            return res.status(404).send("Donation not found.");
        }

        const update = {
            foodName: foodName.trim(),
            quantity: Number(quantity),
            pincode: cleanPincode,
            expiryTime: expiryDate,
            estimatedValue: parseValue(req.body.estimatedValue)
        };

        if (req.file) {
            update.image = req.file.filename;
        } else if (removeImage) {
            update.image = null;
        }

        const donation = await Donation.findOneAndUpdate(
            { _id: existing._id, status: "Available" },
            update,
            { new: true }
        );

        if (!donation) {
            removeUploadedFile(req.file);
            return res.status(404).send("Donation not found.");
        }

        // delete the replaced / removed photo from disk
        if (existing.image && existing.image !== donation.image) {
            fs.unlink(path.join(DONATION_DIR, path.basename(existing.image)), () => {});
        }

        flash(req, "success", "Donation updated.");
        res.redirect("/hotel#history");
    } catch (error) {
        console.error("Update donation error:", error);
        removeUploadedFile(req.file);
        res.status(500).send("Failed to update donation.");
    }
});
// ======================================================
// CANCEL DONATION
// ======================================================

app.post("/hotel/donation/:id/cancel", requireRole("hotel"), async (req, res) => {
    try {
        const donation = await Donation.findOneAndUpdate(
            {
                _id: req.params.id,
                hotelId: req.session.user.id,
                status: "Available"
            },
            { status: "Cancelled" },
            { new: true }
        );

        if (!donation) {
            return res.status(404).send("Donation cannot be cancelled.");
        }

        res.redirect("/hotel#history");
    } catch (error) {
        console.error("Cancel donation error:", error);
        res.status(500).send("Failed to cancel donation.");
    }
});

// ======================================================
// NGO DASHBOARD
// ======================================================

app.get("/ngo", requireRole("ngo"), async (req, res) => {
    try {
        await expireOldDonations();

        // Available donations matching the NGO pincode
        const donations = await Donation.find({
            pincode: req.session.user.pincode,
            status: "Available",
            expiryTime: { $gt: new Date() }
        })
            .populate("hotelId", "name email phone pincode organizationName address city state location")
            .sort({ expiryTime: 1 });   // food that expires soonest comes first

        const myDonations = await Donation.find({
            acceptedBy: req.session.user.id
        })
            .populate("hotelId", "name email phone pincode organizationName")
            .sort({ createdAt: -1 });

        const acceptedCount = countByStatus(myDonations, "Accepted");
        const completedCount = countByStatus(myDonations, "Completed");

        // Completed donations shown in the feedback section
        const completedWithoutFeedback = myDonations.filter(
            d => d.status === "Completed"
        );

        // Total quantity rescued by this NGO
        const ngoRescuedQuantity = completedWithoutFeedback.reduce(
            (sum, d) => sum + (Number(d.quantity) || 0),
            0
        );

        const pendingFeedbackCount = await pendingFeedbackCountFor(req.session.user.id);

        const me = await User.findById(req.session.user.id).select("address city state pincode location organizationName");

        // Smart Match: score every open donation for this NGO and show best first
        const myStats = (await ngoStats([me._id]))[String(me._id)];
        const matches = {};
        donations.forEach(d => {
            matches[String(d._id)] = AI.matchScore(
                { quantity: d.quantity, expiryTime: d.expiryTime, hotelLoc: d.hotelId && d.hotelId.location },
                { loc: me.location, avgPortions: myStats.avgPortions, completed: myStats.completed, released: myStats.released }
            );
        });
        donations.sort((a, b) => matches[String(b._id)].pct - matches[String(a._id)].pct);

        // Surplus forecast: hotels in this pincode that usually post around now
        const areaHotels = await User.find({ role: "hotel", approvalStatus: "Approved", accountStatus: "Active", pincode: me.pincode }).select("organizationName name");
        const past = await Donation.find({ hotelId: { $in: areaHotels.map(h => h._id) } }).select("hotelId createdAt quantity");
        const forecasts = areaHotels.map(h => {
            const f = AI.predictSurplus(past.filter(x => String(x.hotelId) === String(h._id)));
            return f.ready && f.daysAway <= 2 ? { hotel: h.organizationName || h.name, ...f, nextLabel: f.nextDate.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" }) } : null;
        }).filter(Boolean).sort((a, b) => a.daysAway - b.daysAway || b.confidence - a.confidence).slice(0, 4);

        const taste = FoodMemory.ngoTaste(myDonations);
        const usualLabels = taste.slice(0, 3).map(t => t.label);
        res.render("ngo", {
            taste, usualLabels, getFoodVisual, co2PerPortion: AI.impactOf(1000).co2 / 1000,
            matches, forecasts, impact: AI.impactOf(ngoRescuedQuantity),
            me,
            heroes: await communityHeroes(),
            pendingFeedbackCount,
            totalAccepted: myDonations.length,
            valueRescued: sumValue(completedWithoutFeedback),
            donations,
            myDonations,
            acceptedCount,
            completedCount,
            completedWithoutFeedback,
            ngoRescuedQuantity
        });
    } catch (error) {
        console.error("NGO dashboard error:", error);
        res.status(500).send("Unable to load NGO dashboard.");
    }
});

// ======================================================
// ACCEPT DONATION
// ======================================================

app.post("/donation/:id/accept", requireRole("ngo"), async (req, res) => {
    try {
        // Atomic operation: only ONE NGO can accept an Available donation
        const donation = await Donation.findOneAndUpdate(
            {
                _id: req.params.id,
                status: "Available",
                pincode: req.session.user.pincode,
                expiryTime: { $gt: new Date() }
            },
            {
                status: "Accepted",
                acceptedBy: req.session.user.id,
                acceptedAt: new Date(),
                pickupCode: String(Math.floor(1000 + Math.random() * 9000)),
                onTheWayAt: null,
                pickedUpAt: null
            },
            { new: true }
        );

        if (!donation) {
            return res.send(
                messagePage(
                    "❌ Donation Not Available",
                    "This donation may already have been accepted, cancelled, or expired.",
                    "/ngo",
                    "Back to NGO Dashboard",
                    "#dc3545"
                )
            );
        }

        const ngo = await User.findById(req.session.user.id).select("name organizationName");
        const ngoName = (ngo && (ngo.organizationName || ngo.name)) || "An NGO";

        await notify(donation.hotelId, {
            type: "accepted",
            icon: "🚚",
            title: `${ngoName} is on the way!`,
            message: `They claimed your ${donation.foodName} (${donation.quantity} portions). Keep it packed and ready for pickup.`,
            link: "/hotel#history",
            dedupeKey: `accepted-${donation._id}-${donation.releaseCount || 0}`
        });

        flash(req, "success", `You claimed ${donation.foodName}. Pressed it by mistake? You can undo it for the next 5 minutes from My Rescues.`);
        res.redirect("/ngo#history");
    } catch (error) {
        console.error("Accept donation error:", error);
        res.status(500).send("Failed to accept donation.");
    }
});

// ======================================================
// COMPLETE / RESCUE DONATION
// ======================================================

app.post("/ngo/donation/:id/complete", requireRole("ngo"), async (req, res) => {
    try {
        const donation = await Donation.findOneAndUpdate(
            { _id: req.params.id, acceptedBy: req.session.user.id, status: "Accepted" },
            { status: "Completed" },
            { new: true }
        );

        if (!donation) {
            flash(req, "error", "This donation could not be marked as rescued (already completed or released).");
            return res.redirect(req.body.next === "feedback" ? "/ngo/feedback" : "/ngo#history");
        }

        await notify(donation.hotelId, {
            type: "completed",
            icon: "🎉",
            title: `${donation.quantity} portions of ${donation.foodName} reached people`,
            message: "Your surplus became real meals today. Thank you for choosing rescue over waste. 💚",
            link: "/hotel/profile",
            dedupeKey: `completed-${donation._id}`
        });

        const total = await totalRescuedPortions(donation.hotelId);
        for (const m of MILESTONES) {
            if (total >= m.portions) {
                await notify(donation.hotelId, {
                    type: "milestone",
                    icon: m.icon,
                    title: `Badge unlocked: ${m.name}`,
                    message: `You have now rescued ${m.portions}+ portions in total. Check your Impact Profile!`,
                    link: "/hotel/profile",
                    dedupeKey: `milestone-${m.portions}`
                });
            }
        }

        // appreciation for the NGO
        const ngoDone = await Donation.find({ acceptedBy: req.session.user.id, status: "Completed" }).select("quantity");
        const ngoTotal = ngoDone.reduce((a, d) => a + (Number(d.quantity) || 0), 0);
        await notify(req.session.user.id, {
            type: "appreciation", icon: "💚",
            title: `You just helped serve ${donation.quantity} meals`,
            message: `Thank you for rescuing ${donation.foodName}. You have now rescued ${ngoTotal} portions in total.`,
            link: "/ngo#history", dedupeKey: `ngo-thanks-${donation._id}`
        });
        for (const m of NGO_MILESTONES) {
            if (ngoTotal >= m.portions) {
                await notify(req.session.user.id, {
                    type: "milestone", icon: m.icon, title: `Milestone: ${m.name}`,
                    message: `${m.portions}+ portions rescued. Your NGO is making a real difference.`,
                    link: "/ngo#heroes", dedupeKey: `ngo-milestone-${m.portions}`
                });
            }
        }

        // appreciation for the hotel: weekly streak
        const hotelDone = await Donation.find({ hotelId: donation.hotelId, status: "Completed" }).select("updatedAt");
        const streak = weekStreak(hotelDone.map(x => x.updatedAt));
        if (streak >= 2) {
            await notify(donation.hotelId, {
                type: "appreciation", icon: "🔥",
                title: `${streak}-week rescue streak!`,
                message: `You have shared surplus food ${streak} weeks in a row. Keep it going!`,
                link: "/hotel/profile", dedupeKey: `streak-${streak}-${new Date().getFullYear()}`
            });
        }

        flash(req, "success", "Marked as rescued. Thank you — please leave feedback for the hotel!");
        res.redirect(req.body.next === "feedback" ? "/ngo/feedback" : "/ngo#history");
    } catch (error) {
        console.error("Complete donation error:", error);
        res.status(500).send("Failed to complete donation.");
    }
});

// ======================================================
// UNDO (accepted by mistake - free, within a short grace period)
// ======================================================

const UNDO_MINUTES = 5;
app.locals.UNDO_MINUTES = UNDO_MINUTES;

app.post("/ngo/donation/:id/undo", requireRole("ngo"), async (req, res) => {
    try {
        const since = new Date(Date.now() - UNDO_MINUTES * 60000);
        const donation = await Donation.findOneAndUpdate(
            { _id: req.params.id, acceptedBy: req.session.user.id, status: "Accepted", acceptedAt: { $gte: since } },
            { status: "Available", acceptedBy: null, acceptedAt: null, pickupCode: null, onTheWayAt: null },
            { new: true }
        );
        if (!donation) {
            flash(req, "error", `The ${UNDO_MINUTES}-minute undo window has passed. Please use Release and tell the hotel why.`);
            return res.redirect("/ngo#history");
        }
        // the hotel never needs to know: remove the "on the way" alert, no penalty for the NGO
        await Notification.deleteOne({ userId: donation.hotelId, dedupeKey: `accepted-${donation._id}-${donation.releaseCount || 0}` });
        flash(req, "success", `Undone. ${donation.foodName} is available for everyone again.`);
        res.redirect("/ngo#available");
    } catch (error) {
        console.error("Undo error:", error);
        res.status(500).send("Failed to undo.");
    }
});

// ======================================================
// RELEASE (NGO changed their mind after accepting)
// ======================================================

app.post("/ngo/donation/:id/release", requireRole("ngo"), async (req, res) => {
    try {
        const reason = String(req.body.releaseReason || "").trim().slice(0, 300);
        if (reason.length < 3) {
            flash(req, "error", "Please tell the hotel why you can't collect the food.");
            return res.redirect("/ngo#history");
        }

        const donation = await Donation.findOneAndUpdate(
            { _id: req.params.id, acceptedBy: req.session.user.id, status: "Accepted" },
            { status: "Available", acceptedBy: null, pickupCode: null, onTheWayAt: null, pickedUpAt: null, lastReleaseReason: reason, $inc: { releaseCount: 1 }, $push: { releasedBy: req.session.user.id } },
            { new: true }
        );
        if (!donation) {
            flash(req, "error", "This donation can no longer be released.");
            return res.redirect("/ngo#history");
        }

        const ngo = await User.findById(req.session.user.id).select("name organizationName");
        const ngoName = (ngo && (ngo.organizationName || ngo.name)) || "The NGO";
        const stillValid = donation.expiryTime > new Date();

        await notify(donation.hotelId, {
            type: "released", icon: "↩️",
            title: `${ngoName} could not collect ${donation.foodName}`,
            message: stillValid
                ? `Reason: "${reason}". It is Available again so other NGOs nearby can claim it.`
                : `Reason: "${reason}". The food has already passed its safe time.`,
            link: "/hotel#history", dedupeKey: `released-${donation._id}-${donation.releaseCount}`
        });

        if (stillValid) {
            const others = await User.find({
                role: "ngo", approvalStatus: "Approved", accountStatus: "Active",
                pincode: donation.pincode, _id: { $ne: req.session.user.id }
            }).select("_id");
            for (const o of others) {
                await notify(o._id, {
                    type: "new_donation", icon: "🍱",
                    title: `${donation.foodName} is available again`,
                    message: `${donation.quantity} portions near you need a taker.`,
                    link: "/ngo#available", dedupeKey: `reavail-${donation._id}-${donation.releaseCount}-${o._id}`
                });
            }
        }

        flash(req, "success", "Donation released. The hotel and other NGOs have been informed.");
        res.redirect("/ngo#history");
    } catch (error) {
        console.error("Release donation error:", error);
        res.status(500).send("Failed to release donation.");
    }
});

// ======================================================
// NGO FEEDBACK
// ======================================================

app.get("/ngo/feedback", requireRole("ngo"), async (req, res) => {
    try {
        const completedDonations = await Donation.find({
            acceptedBy: req.session.user.id,
            status: "Completed"
        })
            .populate("hotelId", "name organizationName pincode")
            .sort({ updatedAt: -1 });

        const existingFeedbacks = await Feedback.find({
            ngoId: req.session.user.id
        }).select("donationId");

        const submittedIds = new Set(
            existingFeedbacks.map(item => String(item.donationId))
        );

        const pendingFeedbacks = completedDonations.filter(
            donation => !submittedIds.has(String(donation._id))
        );

        const myFeedbacks = await Feedback.find({
            ngoId: req.session.user.id
        })
            .populate("hotelId", "name organizationName pincode")
            .sort({ createdAt: -1 });

        const inProgress = await Donation.find({
            acceptedBy: req.session.user.id,
            status: "Accepted"
        })
            .populate("hotelId", "name organizationName pincode")
            .sort({ updatedAt: -1 });

        res.render("ngo-feedback", {
            pendingFeedbacks,
            myFeedbacks,
            inProgress
        });
    } catch (error) {
        console.error("NGO feedback page error:", error);
        res.status(500).send("Unable to load NGO feedback page.");
    }
});

app.post("/ngo/feedback/:donationId", requireRole("ngo"), async (req, res) => {
    try {
        const rating = Number(req.body.rating);
        const feedbackText = (req.body.feedback || "").trim();

        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
            return res.status(400).send("Rating must be between 1 and 5.");
        }

        if (feedbackText.length < 3 || feedbackText.length > 1000) {
            return res.status(400).send(
                "Feedback must contain 3 to 1000 characters."
            );
        }

        const donation = await Donation.findOne({
            _id: req.params.donationId,
            acceptedBy: req.session.user.id,
            status: "Completed"
        }).populate("hotelId", "name organizationName");

        if (!donation) {
            return res.status(404).send("Completed donation not found.");
        }

        const alreadySubmitted = await Feedback.findOne({
            donationId: donation._id
        });

        if (alreadySubmitted) {
            return res.status(400).send(
                "Feedback has already been submitted for this donation."
            );
        }

        await Feedback.create({
            donationId: donation._id,
            hotelId: donation.hotelId._id,
            ngoId: req.session.user.id,
            foodName: donation.foodName,
            rating,
            feedback: feedbackText
        });

        const stars = "⭐".repeat(Number(rating) || 0);
        await notify(donation.hotelId._id, {
            type: "feedback",
            icon: "💌",
            title: `New ${rating}/5 review ${stars}`,
            message: `An NGO shared feedback on your ${donation.foodName}.`,
            link: "/hotel/feedback",
            dedupeKey: `feedback-${donation._id}`
        });

        res.redirect("/ngo/feedback");
    } catch (error) {
        console.error("Submit NGO feedback error:", error);
        res.status(500).send("Failed to submit feedback.");
    }
});

// ======================================================
// HOTEL FEEDBACK
// ======================================================

app.get("/hotel/feedback", requireRole("hotel"), async (req, res) => {
    try {
        const feedbacks = await Feedback.find({
            hotelId: req.session.user.id
        })
            .populate("ngoId", "name organizationName pincode")
            .populate("donationId", "quantity")
            .sort({ createdAt: -1 });

        const averageRating = feedbacks.length
            ? (
                  feedbacks.reduce((sum, item) => sum + Number(item.rating), 0) /
                  feedbacks.length
              ).toFixed(1)
            : "0.0";

        res.render("hotel-feedback", {
            feedbacks,
            averageRating
        });
    } catch (error) {
        console.error("Hotel feedback page error:", error);
        res.status(500).send("Unable to load hotel feedback.");
    }
});

// ======================================================
// ADMIN FEEDBACK
// ======================================================

app.get("/admin/feedback", requireRole("admin"), async (req, res) => {
    try {
        const feedbacks = await Feedback.find({})
            .populate("hotelId", "name organizationName pincode")
            .populate("ngoId", "name organizationName pincode")
            .populate("donationId", "quantity")
            .sort({ createdAt: -1 });

        const averageRating = feedbacks.length
            ? (
                  feedbacks.reduce((sum, item) => sum + Number(item.rating), 0) /
                  feedbacks.length
              ).toFixed(1)
            : "0.0";

        res.render("admin-feedback", {
            feedbacks,
            averageRating
        });
    } catch (error) {
        console.error("Admin feedback page error:", error);
        res.status(500).send("Unable to load feedback monitoring.");
    }
});

// ======================================================
// ADMIN DASHBOARD
// ======================================================

app.get("/admin", requireRole("admin"), async (req, res) => {
    try {
        await expireOldDonations();

        const [users, donations, feedbacks, profileUpdates] = await Promise.all([
            User.find({ role: { $in: ["hotel", "ngo"] }, accountStatus: { $ne: "Deleted" } })
                .select("role approvalStatus accountStatus pincode"),
            Donation.find().select("status quantity estimatedValue pincode"),
            Feedback.find().select("rating"),
            ProfileUpdate.countDocuments({ status: "Pending" })
        ]);

        const ngos = users.filter(u => u.role === "ngo");
        const hotels = users.filter(u => u.role === "hotel");

        const sumQty = list => list.reduce((s, d) => s + (Number(d.quantity) || 0), 0);

        const averageRating = feedbacks.length
            ? (feedbacks.reduce((s, f) => s + Number(f.rating), 0) / feedbacks.length).toFixed(1)
            : "0.0";

        // Area insights: which pincodes waste food, and where NGOs are missing
        const areaMap = {};
        const area = pin => (areaMap[pin] = areaMap[pin] || { pin, posted: 0, rescued: 0, hotels: 0, ngos: 0 });
        users.filter(u => u.approvalStatus === "Approved" && u.accountStatus === "Active").forEach(u => { area(u.pincode)[u.role === "ngo" ? "ngos" : "hotels"]++; });
        donations.forEach(d => { const a = area(d.pincode); a.posted += Number(d.quantity) || 0; if (d.status === "Completed") a.rescued += Number(d.quantity) || 0; });
        const areas = Object.values(areaMap).filter(a => a.posted || a.hotels || a.ngos).sort((a, b) => b.posted - a.posted).slice(0, 6)
            .map(a => ({ ...a, rate: a.posted ? Math.round((a.rescued / a.posted) * 100) : 0, gap: a.hotels > 0 && a.ngos === 0 }));
        const impact = AI.impactOf(sumQty(donations.filter(d => d.status === "Completed")));

        res.render("admin", {
            areas, impact,
            users,
            ngos,
            hotels,

            pendingApprovals: users.filter(u => u.approvalStatus === "Pending").length,
            profileUpdates,
            deletionRequests: users.filter(u => u.accountStatus === "Deletion Requested"),

            totalDonations: donations.length,
            availableDonations: countByStatus(donations, "Available"),
            acceptedDonations: countByStatus(donations, "Accepted"),
            completedDonations: countByStatus(donations, "Completed"),
            expiredDonations: countByStatus(donations, "Expired"),
            cancelledDonations: countByStatus(donations, "Cancelled"),

            totalQuantity: sumQty(donations),
            rescuedQuantity: sumQty(donations.filter(d => d.status === "Completed")),
            valueRescued: sumValue(donations.filter(d => d.status === "Completed")),

            averageRating,
            feedbackCount: feedbacks.length
        });
    } catch (error) {
        console.error("Admin dashboard error:", error);
        res.status(500).send("Unable to load Admin dashboard.");
    }
});

// ======================================================
// ADMIN: VERIFICATIONS / USERS / DELETION REQUESTS
// ======================================================

async function loadOrganizations() {
    const users = await User.find({
        role: { $in: ["hotel", "ngo"] },
        accountStatus: { $ne: "Deleted" }
    }).sort({ createdAt: -1 });

    return {
        users,
        hotels: users.filter(u => u.role === "hotel"),
        ngos: users.filter(u => u.role === "ngo")
    };
}

app.get("/admin/verifications", requireRole("admin"), async (req, res) => {
    try {
        res.render("admin-verifications", await loadOrganizations());
    } catch (error) {
        console.error("Admin verifications error:", error);
        res.status(500).send("Unable to load verifications.");
    }
});

app.get("/admin/users", requireRole("admin"), async (req, res) => {
    try {
        res.render("admin-users", await loadOrganizations());
    } catch (error) {
        console.error("Admin users error:", error);
        res.status(500).send("Unable to load users.");
    }
});

app.get("/admin/requests", requireRole("admin"), async (req, res) => {
    try {
        const deletionRequests = await User.find({ accountStatus: "Deletion Requested" })
            .sort({ deletionRequestedAt: -1 });

        res.render("admin-requests", { deletionRequests });
    } catch (error) {
        console.error("Admin requests error:", error);
        res.status(500).send("Unable to load deletion requests.");
    }
});

// ======================================================
// ADMIN: VIEW / DOWNLOAD VERIFICATION DOCUMENT
// ======================================================

app.get("/admin/verification-document/:id/view", requireRole("admin"), async (req, res) => {
    try {
        const org = await User.findOne({
            _id: req.params.id,
            role: { $in: ["hotel", "ngo"] }
        }).select("name organizationName role verificationDocument");

        if (!org || !org.verificationDocument || !org.verificationDocument.path) {
            flash(req, "error", "No verification document found for this account.");
            return res.redirect("/admin/verifications");
        }

        const from = req.query.from === "users" ? "users" : "verifications";

        res.render("admin-document", {
            org,
            doc: org.verificationDocument,
            isPdf: org.verificationDocument.mimetype === "application/pdf",
            backUrl: `/admin/${from}#details-${org._id}`
        });
    } catch (error) {
        console.error("Document viewer error:", error);
        res.status(500).send("Unable to open the document.");
    }
});

app.get(
    "/admin/verification-document/:id",
    requireRole("admin"),
    async (req, res) => {
        try {
            const user = await User.findOne({
                _id: req.params.id,
                role: { $in: ["hotel", "ngo"] }
            }).select("verificationDocument");

            const doc = user && user.verificationDocument;

            if (!doc || !doc.path) {
                return res.status(404).send("No verification document found for this account.");
            }

            // basename() prevents path traversal; the file always lives in uploads/verification
            const filePath = path.join(VERIFICATION_DIR, path.basename(doc.path));

            if (!fs.existsSync(filePath)) {
                return res.status(404).send("The verification document file is missing on the server.");
            }

            const downloadName = doc.filename || path.basename(filePath);

            if (doc.mimetype) {
                res.type(doc.mimetype);
            }

            res.setHeader(
                "Content-Disposition",
                (req.query.download ? "attachment" : "inline") +
                    "; filename*=UTF-8''" + encodeURIComponent(downloadName)
            );
            res.setHeader("X-Content-Type-Options", "nosniff");

            res.sendFile(filePath);
        } catch (error) {
            console.error("Verification document error:", error);
            res.status(500).send("Unable to load verification document.");
        }
    }
);

// ======================================================
// ADMIN: APPROVE USER
// ======================================================

app.post("/admin/user/:id/approve", requireRole("admin"), async (req, res) => {
    try {
        const user = await User.findOneAndUpdate(
            {
                _id: req.params.id,
                role: { $in: ["hotel", "ngo"] }
            },
            {
                approvalStatus: "Approved",
                accountStatus: "Active",
                verifiedAt: new Date(),
                verifiedBy: req.session.user.id,
                rejectionReason: null,
                rejectedAt: null,
                rejectedBy: null,
                reactivatedAt: new Date(),
                reactivatedBy: req.session.user.id
            },
            { new: true }
        );

        if (!user) {
            return res.status(404).send("User not found.");
        }

        await notify(user._id, {
            type: "account",
            icon: "✅",
            title: "Your account is verified",
            message: "Welcome aboard! You can now use the full SavoResQ dashboard.",
            link: "/account/settings"
        });

        flash(req, "success", `${user.organizationName || user.name} approved.`);
        res.redirect(req.get("referer") && req.get("referer").includes("/admin/users") ? "/admin/users" : "/admin/verifications");
    } catch (error) {
        console.error("Approve user error:", error);
        res.status(500).send("Failed to approve user.");
    }
});

// ======================================================
// ADMIN: REJECT USER
// ======================================================

app.post("/admin/user/:id/reject", requireRole("admin"), async (req, res) => {
    try {
        const reason = (req.body.rejectionReason || "").trim();
        if (reason.length < 3) {
            flash(req, "error", "Please give a reason (at least 3 characters) before rejecting.");
            return res.redirect("/admin/verifications");
        }

        const user = await User.findOneAndUpdate(
            {
                _id: req.params.id,
                role: { $in: ["hotel", "ngo"] }
            },
            {
                approvalStatus: "Rejected",
                verifiedAt: new Date(),
                verifiedBy: req.session.user.id,
                rejectionReason: reason,
                rejectedAt: new Date(),
                rejectedBy: req.session.user.id
            },
            { new: true }
        );

        if (!user) {
            return res.status(404).send("User not found.");
        }

        await notify(user._id, {
            type: "account",
            icon: "⚠️",
            title: "Account verification needs attention",
            message: user.rejectionReason || "Please review your details and contact the admin.",
            link: "/account/settings"
        });

        flash(req, "success", `${user.organizationName || user.name} rejected.`);
        res.redirect("/admin/verifications");
    } catch (error) {
        console.error("Reject user error:", error);
        res.status(500).send("Failed to reject user.");
    }
});

// ======================================================
// ADMIN: SUSPEND USER
// ======================================================

app.post("/admin/user/:id/suspend", requireRole("admin"), async (req, res) => {
    try {
        const reason = (req.body.suspensionReason || "").trim();
        if (reason.length < 3) {
            flash(req, "error", "Please give a reason (at least 3 characters) before suspending.");
            return res.redirect("/admin/users");
        }

        const user = await User.findOneAndUpdate(
            {
                _id: req.params.id,
                role: { $in: ["hotel", "ngo"] }
            },
            {
                accountStatus: "Suspended",
                suspensionReason: reason,
                suspendedAt: new Date(),
                suspendedBy: req.session.user.id
            },
            { new: true }
        );

        if (!user) {
            return res.status(404).send("User not found.");
        }

        flash(req, "success", `${user.organizationName || user.name} suspended.`);
        res.redirect("/admin/users");
    } catch (error) {
        console.error("Suspend user error:", error);
        res.status(500).send("Failed to suspend user.");
    }
});

// ======================================================
// ADMIN: ACTIVATE USER
// ======================================================

app.post("/admin/user/:id/activate", requireRole("admin"), async (req, res) => {
    try {
        const user = await User.findOneAndUpdate(
            {
                _id: req.params.id,
                role: { $in: ["hotel", "ngo"] }
            },
            { accountStatus: "Active" },
            { new: true }
        );

        if (!user) {
            return res.status(404).send("User not found.");
        }

        flash(req, "success", `${user.organizationName || user.name} reactivated.`);
        res.redirect("/admin/users");
    } catch (error) {
        console.error("Activate user error:", error);
        res.status(500).send("Failed to activate user.");
    }
});

// ======================================================
// HOTEL IMPACT PROFILE
// ======================================================

const LEVELS = [
    { name: "Seedling",      icon: "🌱", min: 0 },
    { name: "Sprout",        icon: "🌿", min: 50 },
    { name: "Sapling",       icon: "🌳", min: 250 },
    { name: "Food Hero",     icon: "🏅", min: 500 },
    { name: "Forest Keeper", icon: "🌲", min: 1000 }
];

app.get("/hotel/profile", requireRole("hotel"), async (req, res) => {
    try {
        await expireOldDonations();

        const user = await User.findById(req.session.user.id);
        const donations = await Donation.find({ hotelId: user._id })
            .sort({ createdAt: -1 });
        const feedbacks = await Feedback.find({ hotelId: user._id })
            .populate("ngoId", "name organizationName")
            .sort({ createdAt: -1 });

        const completed = donations.filter(d => d.status === "Completed");
        const rescuedPortions = completed.reduce(
            (sum, d) => sum + (Number(d.quantity) || 0), 0
        );
        const avgRating = feedbacks.length
            ? feedbacks.reduce((sum, f) => sum + Number(f.rating), 0) / feedbacks.length
            : 0;
        const successRate = donations.length
            ? Math.round((completed.length / donations.length) * 100)
            : 0;

        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const lastWeek = donations.filter(d => d.createdAt >= weekAgo);
        const zeroWasteWeek =
            lastWeek.length >= 3 && !lastWeek.some(d => d.status === "Expired");

        const badges = [
            { icon: "🛡️", name: "Verified Partner",   hint: "Get your account approved",              earned: user.approvalStatus === "Approved" },
            { icon: "🌱", name: "First Rescue",        hint: "Complete your first rescue",             earned: completed.length >= 1 },
            { icon: "🔟", name: "Ten Rescues",         hint: "Complete 10 rescues",                    earned: completed.length >= 10 },
            { icon: "🍱", name: "100 Portions Club",   hint: "Rescue 100 portions in total",           earned: rescuedPortions >= 100 },
            { icon: "⭐", name: "Crowd Favourite",     hint: "Average 4.5+ stars across 3+ reviews",   earned: feedbacks.length >= 3 && avgRating >= 4.5 },
            { icon: "🔥", name: "Zero-Waste Week",     hint: "Post 3+ donations in 7 days, none expired", earned: zeroWasteWeek }
        ];

        let levelIndex = 0;
        LEVELS.forEach((l, i) => { if (rescuedPortions >= l.min) levelIndex = i; });
        const level = LEVELS[levelIndex];
        const nextLevel = LEVELS[levelIndex + 1] || null;
        const levelProgress = nextLevel
            ? Math.round(((rescuedPortions - level.min) / (nextLevel.min - level.min)) * 100)
            : 100;

        res.render("hotel-profile", {
            user,
            totalDonations: donations.length,
            completedCount: completed.length,
            rescuedPortions,
            avgRating: avgRating.toFixed(1),
            reviewCount: feedbacks.length,
            successRate,
            badges,
            level,
            nextLevel,
            levelProgress,
            recentReviews: feedbacks.slice(0, 3)
        });
    } catch (error) {
        console.error("Hotel profile error:", error);
        res.status(500).send("Unable to load profile.");
    }
});


// ======================================================
// MAP: save own coordinates (found in the browser from address / pincode)
// ======================================================

app.post("/account/location", requireLogin, async (req, res) => {
    const lat = Number(req.body.lat), lng = Number(req.body.lng);
    // rough bounding box of India
    if (!isFinite(lat) || !isFinite(lng) || lat < 6 || lat > 38 || lng < 67 || lng > 98) {
        return res.status(400).json({ ok: false });
    }
    await User.findByIdAndUpdate(req.session.user.id, { location: { lat, lng } });
    res.json({ ok: true });
});

// ======================================================
// PUBLIC CERTIFICATE VERIFICATION (no login needed)
// ======================================================

app.get("/verify/:ref", async (req, res) => {
    try {
        const m = /^SRQ-([0-9A-F]{8})$/i.exec(req.params.ref);
        let donation = null;
        if (m) {
            donation = await Donation.findOne({
                status: "Completed",
                $expr: { $regexMatch: { input: { $toString: "$_id" }, regex: m[1] + "$", options: "i" } }
            })
                .populate("hotelId", "organizationName name city state")
                .populate("acceptedBy", "organizationName name city state");
        }
        res.render("verify", { ref: req.params.ref.toUpperCase(), donation });
    } catch (error) {
        console.error("Verify error:", error);
        res.status(500).send("Unable to verify right now.");
    }
});

// ======================================================
// PICKUP STAGES + CODE HANDOVER (anti-fraud)
// ======================================================

app.post("/ngo/donation/:id/ontheway", requireRole("ngo"), async (req, res) => {
    try {
        const donation = await Donation.findOneAndUpdate(
            { _id: req.params.id, acceptedBy: req.session.user.id, status: "Accepted", onTheWayAt: null },
            { onTheWayAt: new Date() }, { new: true }
        );
        if (donation) {
            await notify(donation.hotelId, {
                type: "pickup", icon: "🚚", title: `Pickup team is on the way for ${donation.foodName}`,
                message: "Ask them for the 4-digit pickup code and confirm it on your dashboard when they arrive.",
                link: "/hotel#history", dedupeKey: `ontheway-${donation._id}-${donation.releaseCount || 0}`
            });
            flash(req, "success", "The hotel knows you are on the way. Show them your pickup code at handover.");
        }
        res.redirect("/ngo#history");
    } catch (error) {
        console.error("On the way error:", error);
        res.status(500).send("Failed to update.");
    }
});

app.post("/hotel/donation/:id/handover", requireRole("hotel"), async (req, res) => {
    try {
        const code = String(req.body.code || "").trim();
        const donation = await Donation.findOne({ _id: req.params.id, hotelId: req.session.user.id, status: "Accepted" });
        if (!donation) { flash(req, "error", "This donation is not waiting for pickup."); return res.redirect("/hotel#history"); }
        if (!code || code !== donation.pickupCode) {
            flash(req, "error", "That code does not match. Please check it with the NGO team before handing over the food.");
            return res.redirect("/hotel#history");
        }
        donation.pickedUpAt = new Date();
        await donation.save();
        await notify(donation.acceptedBy, {
            type: "pickup", icon: "✅", title: `Handover confirmed for ${donation.foodName}`,
            message: "The hotel verified your code. Mark the donation as rescued once the food reaches people.",
            link: "/ngo#history", dedupeKey: `pickedup-${donation._id}-${donation.releaseCount || 0}`
        });
        flash(req, "success", "Pickup verified. Thank you!");
        res.redirect("/hotel#history");
    } catch (error) {
        console.error("Handover error:", error);
        res.status(500).send("Failed to verify the code.");
    }
});

// ======================================================
// HOTEL <-> NGO MESSAGES (one private chat per donation)
// ======================================================

app.get("/chat", requireRole("hotel", "ngo"), async (req, res) => {
    try {
        const isHotel = req.session.user.role === "hotel";
        const chats = await DonationChat.find(isHotel ? { hotelId: req.session.user.id } : { ngoId: req.session.user.id })
            .populate("donationId", "foodName quantity status")
            .populate(isHotel ? "ngoId" : "hotelId", "organizationName name")
            .sort({ updatedAt: -1 });
        res.render("chat-list", { chats, isHotel });
    } catch (error) {
        console.error("Chat list error:", error);
        res.status(500).send("Unable to load messages.");
    }
});

// open (or start) the chat for a donation
app.get("/chat/donation/:id", requireRole("hotel", "ngo"), async (req, res) => {
    try {
        if (!/^[0-9a-f]{24}$/i.test(req.params.id)) return res.redirect("/chat");
        const donation = await Donation.findById(req.params.id);
        const me = String(req.session.user.id), isHotel = req.session.user.role === "hotel";
        if (!donation) return res.redirect("/chat");
        let ngoId = null;
        if (isHotel && String(donation.hotelId) === me) ngoId = donation.acceptedBy;
        if (!isHotel && String(donation.acceptedBy) === me) ngoId = me;
        if (!ngoId) {
            // maybe an earlier conversation exists (e.g. food was released)
            const old = await DonationChat.findOne(isHotel ? { donationId: donation._id, hotelId: me } : { donationId: donation._id, ngoId: me });
            if (old) return res.redirect(`/chat/${old._id}`);
            flash(req, "error", isHotel ? "You can message an NGO once it has accepted this donation." : "You can message the hotel after you accept its donation.");
            return res.redirect(isHotel ? "/hotel#history" : "/ngo#history");
        }
        const chat = await DonationChat.findOneAndUpdate(
            { donationId: donation._id, ngoId },
            { $setOnInsert: { hotelId: donation.hotelId, messages: [] } },
            { new: true, upsert: true }
        );
        res.redirect(`/chat/${chat._id}`);
    } catch (error) {
        console.error("Chat open error:", error);
        res.status(500).send("Unable to open the chat.");
    }
});

async function loadChatFor(req) {
    if (!/^[0-9a-f]{24}$/i.test(req.params.id)) return null;
    const isHotel = req.session.user.role === "hotel";
    return DonationChat.findOne({ _id: req.params.id, [isHotel ? "hotelId" : "ngoId"]: req.session.user.id })
        .populate("donationId", "foodName quantity status pincode")
        .populate("hotelId", "organizationName name phone")
        .populate("ngoId", "organizationName name phone");
}

app.get("/chat/:id", requireRole("hotel", "ngo"), async (req, res) => {
    try {
        const chat = await loadChatFor(req);
        if (!chat) return res.redirect("/chat");
        const isHotel = req.session.user.role === "hotel";
        const flag = isHotel ? "unreadForHotel" : "unreadForNgo";
        if (chat[flag]) { await DonationChat.updateOne({ _id: chat._id }, { [flag]: false }); }
        res.render("chat", { chat, isHotel });
    } catch (error) {
        console.error("Chat view error:", error);
        res.status(500).send("Unable to load the chat.");
    }
});

app.post("/chat/:id/send", requireRole("hotel", "ngo"), async (req, res) => {
    try {
        const text = String(req.body.message || "").trim().slice(0, 1000);
        const chat = await loadChatFor(req);
        if (!chat || text.length < 1) return res.redirect("/chat");
        const isHotel = req.session.user.role === "hotel";
        await DonationChat.updateOne({ _id: chat._id }, {
            $push: { messages: { from: isHotel ? "hotel" : "ngo", text, at: new Date() } },
            [isHotel ? "unreadForNgo" : "unreadForHotel"]: true
        });
        const other = isHotel ? chat.ngoId : chat.hotelId, mine = isHotel ? chat.hotelId : chat.ngoId;
        await notify(other._id, {
            type: "message", icon: "💬", title: `${mine.organizationName || mine.name} sent a message`,
            message: `${chat.donationId.foodName}: ${text.slice(0, 90)}`,
            link: `/chat/${chat._id}`, dedupeKey: `chat-${chat._id}-${Date.now()}`
        });
        res.redirect(`/chat/${chat._id}`);
    } catch (error) {
        console.error("Chat send error:", error);
        res.status(500).send("Unable to send the message.");
    }
});

// ======================================================
// CONTACT ADMIN (hotel / NGO -> admin).  Hotel <-> NGO talk happens in /chat.
// ======================================================

const ADMIN_TOPICS = ["Fraud or misconduct", "Report an organization", "Food quality complaint (unresolved)", "Pickup dispute", "Problem with the app", "Account or verification", "Suggestion", "Other"];
const isId = (v) => /^[0-9a-f]{24}$/i.test(String(v || ""));
const ticketLink = (t) => `/support/${t._id}`;

app.get("/support", requireRole("hotel", "ngo"), async (req, res) => {
    try {
        const me = req.session.user.id, role = req.session.user.role;
        const tickets = await SupportTicket.find({ userId: me, kind: "admin" }).sort({ updatedAt: -1 });
        const dq = role === "hotel" ? { hotelId: me, acceptedBy: { $ne: null } } : { acceptedBy: me };
        const dons = await Donation.find(dq).populate("acceptedBy", "organizationName name").populate("hotelId", "organizationName name")
            .sort({ updatedAt: -1 }).limit(30);
        const contacts = dons.map(d => {
            const other = role === "hotel" ? d.acceptedBy : d.hotelId;
            return { id: String(d._id), label: `${d.foodName} · ${other ? (other.organizationName || other.name) : "—"}` };
        });
        res.render("support", {
            tickets, contacts, role, meId: String(me), adminTopics: ADMIN_TOPICS,
            prefillDonation: isId(req.query.donation) ? String(req.query.donation) : "", topic: req.query.category || ""
        });
    } catch (error) {
        console.error("Support list error:", error);
        res.status(500).send("Unable to load your requests.");
    }
});

app.post("/support", requireRole("hotel", "ngo"), async (req, res) => {
    try {
        const me = req.session.user.id, role = req.session.user.role;
        const category = ADMIN_TOPICS.includes(req.body.category) ? req.body.category : null;
        const text = String(req.body.message || "").trim().slice(0, 2000);
        if (!category || text.length < 5) {
            flash(req, "error", "Please choose a topic and write your message (at least 5 characters).");
            return res.redirect("/support");
        }
        let donation = null;
        if (isId(req.body.donationId)) {
            donation = await Donation.findById(req.body.donationId).select("hotelId acceptedBy foodName");
            const mine = donation && (String(donation.hotelId) === String(me) || String(donation.acceptedBy) === String(me));
            if (!mine) donation = null;
        }
        const subject = String(req.body.subject || "").trim().slice(0, 120) || (donation ? `${category} — ${donation.foodName}` : category);
        const ticket = await SupportTicket.create({
            kind: "admin", userId: me, role, category, subject, donationId: donation ? donation._id : null,
            messages: [{ from: "user", by: me, text }], unreadForAdmin: true
        });
        const sender = await User.findById(me).select("organizationName name");
        const senderName = (sender && (sender.organizationName || sender.name)) || "A partner";
        const admins = await User.find({ role: "admin" }).select("_id");
        for (const a of admins) {
            await notify(a._id, { type: "support", icon: "💬", title: `New request: ${subject}`, message: `${senderName} · ${category}`,
                link: `/admin/support/${ticket._id}`, dedupeKey: `ticket-${ticket._id}-${a._id}` });
        }
        flash(req, "success", "Sent to the admin. You will be notified when they reply.");
        res.redirect(ticketLink(ticket));
    } catch (error) {
        console.error("Support create error:", error);
        res.status(500).send("Unable to send your message.");
    }
});

async function loadMyTicket(req) {
    if (!isId(req.params.id)) return null;
    return SupportTicket.findOne({ _id: req.params.id, userId: req.session.user.id, kind: "admin" });
}

app.get("/support/:id", requireRole("hotel", "ngo"), async (req, res) => {
    try {
        const found = await loadMyTicket(req);
        if (!found) return res.redirect("/support");
        if (found.unreadForUser) { found.unreadForUser = false; await found.save(); }
        const ticket = await SupportTicket.findById(found._id).populate("userId", "organizationName name role").populate("donationId", "foodName quantity");
        res.render("support-ticket", { ticket, mode: "user", meId: String(req.session.user.id) });
    } catch (error) {
        console.error("Support view error:", error);
        res.status(500).send("Unable to load the conversation.");
    }
});

app.post("/support/:id/reply", requireRole("hotel", "ngo"), async (req, res) => {
    try {
        const ticket = await loadMyTicket(req);
        if (!ticket) return res.redirect("/support");
        const text = String(req.body.message || "").trim().slice(0, 2000);
        if (text.length >= 2) {
            ticket.messages.push({ from: "user", by: req.session.user.id, text });
            if (ticket.status === "Resolved") ticket.status = "Open";
        }
        if (req.body.status === "Resolved") ticket.status = "Resolved";
        ticket.unreadForAdmin = true;
        await ticket.save();
        res.redirect(ticketLink(ticket));
    } catch (error) {
        console.error("Support reply error:", error);
        res.status(500).send("Unable to send reply.");
    }
});

const adminInbox = { kind: "admin" };

app.get("/admin/support", requireRole("admin"), async (req, res) => {
    try {
        const filter = { ...adminInbox };
        if (["Open", "In Progress", "Resolved"].includes(req.query.status)) filter.status = req.query.status;
        const [tickets, all] = await Promise.all([
            SupportTicket.find(filter).populate("userId", "name organizationName role").populate("partnerId", "name organizationName role")
                .sort({ unreadForAdmin: -1, updatedAt: -1 }).limit(100),
            SupportTicket.find(adminInbox).select("status")
        ]);
        const count = (s) => all.filter(t => t.status === s).length;
        res.render("admin-support", { tickets, status: filter.status || "All", counts: { all: all.length, open: count("Open"), progress: count("In Progress"), resolved: count("Resolved") } });
    } catch (error) {
        console.error("Admin support error:", error);
        res.status(500).send("Unable to load support requests.");
    }
});

app.get("/admin/support/:id", requireRole("admin"), async (req, res) => {
    try {
        if (!isId(req.params.id)) return res.redirect("/admin/support");
        const ticket = await SupportTicket.findOne({ _id: req.params.id, ...adminInbox })
            .populate("userId", "name organizationName role email phone pincode").populate("partnerId", "name organizationName role email phone")
            .populate("donationId", "foodName quantity status");
        if (!ticket) return res.redirect("/admin/support");
        if (ticket.unreadForAdmin) { ticket.unreadForAdmin = false; await ticket.save(); }
        res.render("support-ticket", { ticket, mode: "admin", meId: "" });
    } catch (error) {
        console.error("Admin ticket error:", error);
        res.status(500).send("Unable to load the request.");
    }
});

app.post("/admin/support/:id/reply", requireRole("admin"), async (req, res) => {
    try {
        const text = String(req.body.message || "").trim().slice(0, 2000);
        const status = ["Open", "In Progress", "Resolved"].includes(req.body.status) ? req.body.status : null;
        const ticket = await SupportTicket.findOne({ _id: req.params.id, ...adminInbox });
        if (!ticket) return res.redirect("/admin/support");
        if (text.length >= 2) ticket.messages.push({ from: "admin", text });
        if (status) ticket.status = status;
        ticket.unreadForAdmin = false;
        const parties = [ticket.userId].concat(ticket.partnerId && ticket.escalated ? [ticket.partnerId] : []);
        if (ticket.kind === "admin") ticket.unreadForUser = true; else ticket.unreadBy = parties;
        await ticket.save();

        if (text.length >= 2 || status === "Resolved") {
            for (const u of parties) {
                await notify(u, { type: "support", icon: "💬",
                    title: ticket.status === "Resolved" ? `Resolved: ${ticket.subject}` : `Admin replied: ${ticket.subject}`,
                    message: text.slice(0, 120) || "The admin marked this request as resolved.", link: ticketLink(ticket),
                    dedupeKey: `reply-${ticket._id}-${ticket.messages.length}-${ticket.status}-${u}` });
            }
        }
        flash(req, "success", "Saved.");
        res.redirect(`/admin/support/${ticket._id}`);
    } catch (error) {
        console.error("Admin reply error:", error);
        res.status(500).send("Unable to save.");
    }
});

// ======================================================
// ACCOUNT SETTINGS
// ======================================================

app.get("/account/settings", requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.user.id);

        if (!user) {
            return res.redirect("/login");
        }

        const pendingProfileUpdate = await ProfileUpdate.findOne({
            userId: user._id,
            status: "Pending"
        });

        res.render("account-settings", { user, pendingProfileUpdate });
    } catch (error) {
        console.error("Account settings error:", error);
        res.status(500).send("Unable to load account settings.");
    }
});

// ======================================================
// PROFILE EDIT (hotel / ngo)
// ======================================================

const PROFILE_FIELDS = [
    "name", "phone", "organizationName", "registrationNumber",
    "address", "city", "state", "country", "pincode"
];

app.get("/account/profile/edit", requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.user.id);

        if (!user) {
            return res.redirect("/login");
        }

        if (user.role === "admin") {
            return res.redirect("/account/settings");
        }

        const pendingProfileUpdate = await ProfileUpdate.findOne({
            userId: user._id,
            status: "Pending"
        });

        res.render("profile-edit", { user, pendingProfileUpdate });
    } catch (error) {
        console.error("Profile edit page error:", error);
        res.status(500).send("Unable to load profile edit page.");
    }
});

app.post("/account/profile/update-request", requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.user.id);

        if (!user || user.role === "admin") {
            return res.redirect("/account/settings");
        }

        if (user.accountStatus !== "Active") {
            return res.redirect("/account/profile/edit");
        }

        const existing = await ProfileUpdate.findOne({
            userId: user._id,
            status: "Pending"
        });

        if (existing) {
            return res.redirect("/account/profile/edit");
        }

        const currentData = {};
        const requestedData = {};
        const changedFields = [];

        PROFILE_FIELDS.forEach(field => {
            const oldValue = (user[field] || "").toString().trim();
            const newValue = (req.body[field] !== undefined
                ? String(req.body[field]) : oldValue).trim();

            currentData[field] = oldValue;
            requestedData[field] = newValue;

            if (oldValue !== newValue) {
                changedFields.push(field);
            }
        });

        if (changedFields.length === 0) {
            return res.redirect("/account/profile/edit");
        }

        await ProfileUpdate.create({
            userId: user._id,
            role: user.role,
            currentData,
            requestedData,
            changedFields
        });

        flash(req, "success", "Changes submitted. The admin will review them shortly.");
        res.redirect("/account/profile/edit");
    } catch (error) {
        console.error("Profile update request error:", error);
        res.status(500).send("Failed to submit profile update request.");
    }
});

// ======================================================
// ADMIN: PROFILE UPDATE REVIEW
// ======================================================

app.get("/admin/profile-updates", requireRole("admin"), async (req, res) => {
    try {
        const profileUpdates = await ProfileUpdate.find({ status: "Pending" })
            .populate("userId", "name email organizationName")
            .sort({ createdAt: -1 });

        const recentProfileUpdates = await ProfileUpdate.find({
            status: { $in: ["Approved", "Rejected"] }
        })
            .populate("userId", "name email organizationName")
            .populate("reviewedBy", "name")
            .sort({ reviewedAt: -1 })
            .limit(10);

        res.render("admin-profile-updates", {
            profileUpdates,
            recentProfileUpdates
        });
    } catch (error) {
        console.error("Admin profile updates error:", error);
        res.status(500).send("Unable to load profile updates.");
    }
});

app.post("/admin/profile-update/:id/approve", requireRole("admin"), async (req, res) => {
    try {
        const update = await ProfileUpdate.findOne({
            _id: req.params.id,
            status: "Pending"
        });

        if (!update) {
            return res.status(404).send("Pending update not found.");
        }

        const changes = {};
        update.changedFields
            .filter(f => PROFILE_FIELDS.includes(f))
            .forEach(f => { changes[f] = update.requestedData[f]; });

        await User.findByIdAndUpdate(update.userId, changes, {
            runValidators: true
        });

        update.status = "Approved";
        update.reviewedAt = new Date();
        update.reviewedBy = req.session.user.id;
        await update.save();

        await notify(update.userId, {
            type: "profile",
            icon: "✨",
            title: "Profile changes approved",
            message: "Your updated organization details are now live.",
            link: "/account/settings"
        });

        flash(req, "success", "Profile changes approved.");
        res.redirect("/admin/profile-updates");
    } catch (error) {
        console.error("Approve profile update error:", error);
        res.status(500).send("Failed to approve profile update.");
    }
});

app.post("/admin/profile-update/:id/reject", requireRole("admin"), async (req, res) => {
    try {
        const update = await ProfileUpdate.findOne({
            _id: req.params.id,
            status: "Pending"
        });

        if (!update) {
            return res.status(404).send("Pending update not found.");
        }

        update.status = "Rejected";
        update.reviewedAt = new Date();
        update.reviewedBy = req.session.user.id;
        update.rejectionReason = (req.body.rejectionReason || "").trim() || null;
        await update.save();

        await notify(update.userId, {
            type: "profile",
            icon: "📝",
            title: "Profile changes not approved",
            message: update.rejectionReason || "The admin could not approve your requested changes.",
            link: "/account/profile/edit"
        });

        flash(req, "success", "Profile changes rejected.");
        res.redirect("/admin/profile-updates");
    } catch (error) {
        console.error("Reject profile update error:", error);
        res.status(500).send("Failed to reject profile update.");
    }
});

// ======================================================
// CHANGE PASSWORD
// ======================================================

app.post("/account/password", requireLogin, async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body;
        const user = await User.findById(req.session.user.id);

        if (!user) return res.redirect("/login");

        if (!currentPassword || !(await bcrypt.compare(currentPassword, user.password))) {
            flash(req, "error", "Your current password is incorrect.");
            return res.redirect("/account/settings");
        }

        if (!newPassword || newPassword.length < 8) {
            flash(req, "error", "The new password must have at least 8 characters.");
            return res.redirect("/account/settings");
        }

        if (newPassword !== confirmPassword) {
            flash(req, "error", "The new passwords do not match.");
            return res.redirect("/account/settings");
        }

        if (await bcrypt.compare(newPassword, user.password)) {
            flash(req, "error", "Choose a password different from your current one.");
            return res.redirect("/account/settings");
        }

        user.password = await bcrypt.hash(newPassword, 12);
        await user.save();

        flash(req, "success", "Password updated successfully.");
        res.redirect("/account/settings");
    } catch (error) {
        console.error("Change password error:", error);
        res.status(500).send("Failed to change password.");
    }
});

// ======================================================
// ACCOUNT DELETION REQUEST
// ======================================================

app.post("/account/delete-request", requireLogin, async (req, res) => {
    try {
        if (req.session.user.role === "admin") {
            flash(req, "error", "The administrator account cannot be deleted.");
            return res.redirect("/account/settings");
        }

        const { deletionReason, confirmation } = req.body;

        if (confirmation !== "DELETE") {
            return res.status(400).send(
                messagePage(
                    "❌ Confirmation Required",
                    "Please type DELETE to confirm.",
                    "/account/settings",
                    "Back"
                )
            );
        }

        if (!deletionReason) {
            return res.status(400).send(
                messagePage(
                    "❌ Reason Required",
                    "",
                    "/account/settings",
                    "Back"
                )
            );
        }

        await User.findByIdAndUpdate(req.session.user.id, {
            accountStatus: "Deletion Requested",
            deletionReason: deletionReason.trim(),
            deletionRequestedAt: new Date()
        });

        req.session.destroy(() => {
            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>SavoResQ</title>
                    <style>
                        body {
                            font-family: Arial;
                            text-align: center;
                            padding: 70px 20px;
                            background: #f4f7f6;
                        }
                        .box {
                            max-width: 600px;
                            margin: auto;
                            background: white;
                            padding: 40px;
                            border-radius: 15px;
                        }
                        h1 { color: #198754; }
                        a {
                            color: #198754;
                            font-weight: bold;
                            text-decoration: none;
                        }
                    </style>
                </head>
                <body>
                    <div class="box">
                        <h1>✅ Request Submitted</h1>
                        <p>Your account deletion request has been sent to Admin.</p>
                        <p>You have been logged out.</p>
                        <a href="/">Return Home</a>
                    </div>
                </body>
                </html>
            `);
        });
    } catch (error) {
        console.error("Deletion request error:", error);
        res.status(500).send("Failed to submit deletion request.");
    }
});

// ======================================================
// ADMIN: APPROVE / REJECT DELETION
// ======================================================

app.post("/admin/deletion/:id/approve", requireRole("admin"), async (req, res) => {
    try {
        const user = await User.findOneAndUpdate(
            {
                _id: req.params.id,
                accountStatus: "Deletion Requested"
            },
            { accountStatus: "Deleted" },
            { new: true }
        );

        if (!user) {
            return res.status(404).send("Deletion request not found.");
        }

        flash(req, "success", "Account deletion approved.");
        res.redirect("/admin/requests");
    } catch (error) {
        console.error("Deletion approval error:", error);
        res.status(500).send("Failed to approve deletion.");
    }
});

app.post("/admin/deletion/:id/reject", requireRole("admin"), async (req, res) => {
    try {
        const user = await User.findOneAndUpdate(
            {
                _id: req.params.id,
                accountStatus: "Deletion Requested"
            },
            {
                accountStatus: "Active",
                reactivatedAt: new Date(),
                reactivatedBy: req.session.user.id,
                suspensionReason: null,
                suspendedAt: null,
                suspendedBy: null
            },
            { new: true }
        );

        if (!user) {
            return res.status(404).send("Deletion request not found.");
        }

        flash(req, "success", "Deletion request declined. The account stays active.");
        res.redirect("/admin/requests");
    } catch (error) {
        console.error("Deletion rejection error:", error);
        res.status(500).send("Failed to reject deletion.");
    }
});

// ======================================================
// LOGOUT
// ======================================================

app.get("/logout", (req, res) => {
    req.session.destroy(() => {
        res.clearCookie("connect.sid");
        res.redirect("/login");
    });
});

// ======================================================
// START SERVER
// ======================================================

async function startServer() {
    try {
        await connectDB();

        console.log("MongoDB connected successfully");

        await createAdminAccount();

        app.listen(PORT, () => {
            console.log(`SavoResQ server running at http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error("Server startup failed:", error);
        process.exit(1);
    }
}

startServer();
