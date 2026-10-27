const mongoose = require("mongoose");

const donationSchema = new mongoose.Schema(

    {

        hotelId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },


        foodName: {
            type: String,
            required: true,
            trim: true
        },


        quantity: {
            type: Number,
            required: true,
            min: 1
        },


        pincode: {
            type: String,
            required: true,
            trim: true
        },


        expiryTime: {
            type: Date,
            required: true
        },


        estimatedValue: {
            type: Number,
            default: 0,
            min: 0
        },


        image: {
            type: String,
            default: null
        },


        status: {
            type: String,
            enum: [
                "Available",
                "Accepted",
                "Completed",
                "Cancelled",
                "Expired"
            ],
            default: "Available"
        },


        acceptedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },


        // how many times an NGO gave the food back (changed their mind)
        acceptedAt: { type: Date, default: null },
        // anti-fraud handover: the NGO gets a 4-digit code and the hotel confirms it at pickup
        pickupCode: { type: String, default: null },
        onTheWayAt: { type: Date, default: null },
        pickedUpAt: { type: Date, default: null },
        releaseCount: { type: Number, default: 0 },
        releasedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
        lastReleaseReason: { type: String, default: null }

    },

    {
        timestamps: true
    }

);


module.exports =
    mongoose.model(
        "Donation",
        donationSchema
    ); 
