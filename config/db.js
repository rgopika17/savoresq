const mongoose = require("mongoose");

// Local MongoDB (the same server you browse in MongoDB Compass).
// Compass connection string:  mongodb://127.0.0.1:27017
// This app's database name:   savoresq
const DEFAULT_URI = "mongodb://127.0.0.1:27017/savoresq";

const connectDB = async () => {
    const uri = process.env.MONGO_URI || DEFAULT_URI;

    try {
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });

        console.log(`MongoDB connected: ${mongoose.connection.host}:${mongoose.connection.port}/${mongoose.connection.name}`);
    } catch (error) {
        console.error("MongoDB connection failed:", error.message);
        console.error(
            "\nMake sure the MongoDB server is running (open MongoDB Compass and click Connect to " +
            "mongodb://127.0.0.1:27017 - if that fails, start the 'MongoDB' service)."
        );
        throw error;
    }
};

module.exports = connectDB;
