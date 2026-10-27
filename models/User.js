const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },
        email: { type: String, required: true, unique: true, lowercase: true, trim: true },
        password: { type: String, required: true },

        phone: { type: String, required: function () { return this.role !== "admin"; }, trim: true },
        organizationName: { type: String, required: function () { return this.role !== "admin"; }, trim: true },
        registrationNumber: { type: String, required: function () { return this.role !== "admin"; }, trim: true },
        address: { type: String, required: function () { return this.role !== "admin"; }, trim: true },
        city: { type: String, required: function () { return this.role !== "admin"; }, trim: true },
        state: { type: String, required: function () { return this.role !== "admin"; }, trim: true },
        country: { type: String, default: "India", trim: true },
        pincode: { type: String, required: true, trim: true },
        location: {
            lat: { type: Number, default: null },
            lng: { type: Number, default: null }
        },

        verificationDocument: {
            filename: { type: String, default: null },
            path: { type: String, default: null },
            mimetype: { type: String, default: null },
            uploadedAt: { type: Date, default: null }
        },

        role: { type: String, enum: ["hotel", "ngo", "admin"], required: true },

        approvalStatus: {
            type: String,
            enum: ["Pending", "Approved", "Rejected"],
            default: "Pending"
        },

        accountStatus: {
            type: String,
            enum: ["Active", "Suspended", "Deletion Requested", "Deleted"],
            default: "Active"
        },

        rejectionReason: { type: String, default: null, trim: true },
        rejectedAt: { type: Date, default: null },
        rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

        suspensionReason: { type: String, default: null, trim: true },
        suspendedAt: { type: Date, default: null },
        suspendedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

        reactivatedAt: { type: Date, default: null },
        reactivatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

        deletionReason: { type: String, default: null },
        deletionRequestedAt: { type: Date, default: null },
        verifiedAt: { type: Date, default: null },
        verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
    },
    { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
