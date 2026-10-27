const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        type: {
            type: String,
            enum: ["accepted", "completed", "feedback", "expiring", "expired", "milestone", "account", "profile", "new_donation", "registration", "released", "appreciation", "support", "message", "pickup"],
            required: true
        },
        icon: { type: String, default: "🔔" },
        title: { type: String, required: true },
        message: { type: String, default: "" },
        link: { type: String, default: null },
        read: { type: Boolean, default: false },

        // Prevents duplicates (e.g. the same "expiring soon" alert twice)
        dedupeKey: { type: String, default: undefined }
    },
    { timestamps: true }
);

notificationSchema.index(
    { userId: 1, dedupeKey: 1 },
    { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } }
);

module.exports = mongoose.model("Notification", notificationSchema);
