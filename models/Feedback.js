const mongoose = require("mongoose");

const feedbackSchema = new mongoose.Schema(
    {
        donationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Donation",
            required: true,
            unique: true,
            index: true
        },
        hotelId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        ngoId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        foodName: {
            type: String,
            required: true,
            trim: true
        },
        rating: {
            type: Number,
            required: true,
            min: 1,
            max: 5
        },
        feedback: {
            type: String,
            required: true,
            trim: true,
            minlength: 3,
            maxlength: 1000
        }
    },
    { timestamps: true }
);

feedbackSchema.index({ hotelId: 1, createdAt: -1 });
feedbackSchema.index({ ngoId: 1, createdAt: -1 });

module.exports = mongoose.model("Feedback", feedbackSchema);
