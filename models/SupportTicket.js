const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
    {
        from: { type: String, enum: ["user", "admin"], required: true },
        by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },   // who wrote it (user messages)
        text: { type: String, required: true, trim: true, maxlength: 2000 },
        at: { type: Date, default: Date.now }
    },
    { _id: false }
);

/**
 * One conversation.
 *  kind "admin"   : hotel/NGO <-> admin
 *  kind "partner" : hotel <-> NGO about one donation (admin can step in when escalated)
 */
const supportTicketSchema = new mongoose.Schema(
    {
        kind: { type: String, enum: ["admin", "partner"], default: "admin", index: true },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },   // who started it
        partnerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },  // the other organization
        role: { type: String, enum: ["hotel", "ngo"], required: true },
        category: { type: String, required: true, trim: true },
        subject: { type: String, required: true, trim: true, maxlength: 120 },
        donationId: { type: mongoose.Schema.Types.ObjectId, ref: "Donation", default: null },
        status: { type: String, enum: ["Open", "In Progress", "Resolved"], default: "Open", index: true },
        escalated: { type: Boolean, default: false },
        messages: [messageSchema],
        unreadForUser: { type: Boolean, default: false },    // admin tickets: starter has a new reply
        unreadForAdmin: { type: Boolean, default: true },
        unreadBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }]   // partner threads: who has not read yet
    },
    { timestamps: true }
);

module.exports = mongoose.model("SupportTicket", supportTicketSchema);
