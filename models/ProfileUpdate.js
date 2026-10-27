const mongoose = require("mongoose");

const profileUpdateSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        role: {
            type: String,
            enum: ["hotel", "ngo"],
            required: true
        },
        currentData: {
            type: mongoose.Schema.Types.Mixed,
            required: true
        },
        requestedData: {
            type: mongoose.Schema.Types.Mixed,
            required: true
        },
        changedFields: {
            type: [String],
            required: true
        },
        status: {
            type: String,
            enum: ["Pending", "Approved", "Rejected"],
            default: "Pending",
            index: true
        },
        reviewedAt: {
            type: Date,
            default: null
        },
        reviewedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },
        rejectionReason: {
            type: String,
            default: null
        }
    },
    { timestamps: true }
);

profileUpdateSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model("ProfileUpdate", profileUpdateSchema);
