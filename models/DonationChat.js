const mongoose = require("mongoose");

// A private conversation between the hotel that posted a donation and the NGO that claimed it.
const chatSchema = new mongoose.Schema(
    {
        donationId: { type: mongoose.Schema.Types.ObjectId, ref: "Donation", required: true },
        hotelId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        ngoId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        messages: [
            {
                _id: false,
                from: { type: String, enum: ["hotel", "ngo"], required: true },
                text: { type: String, required: true, trim: true, maxlength: 1000 },
                at: { type: Date, default: Date.now }
            }
        ],
        unreadForHotel: { type: Boolean, default: false },
        unreadForNgo: { type: Boolean, default: false }
    },
    { timestamps: true }
);

chatSchema.index({ donationId: 1, ngoId: 1 }, { unique: true });

module.exports = mongoose.model("DonationChat", chatSchema);
