const mongoose = require('mongoose');
const dns = require('dns');

// Configure DNS resolver to public DNS servers if local DNS fails SRV lookups (Windows DNS fix)
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (e) {
  // Fallback to default resolver if restricted
}

const connectDB = async () => {
  try {
    const connUrl = process.env.MONGO_DB_URL || process.env.MONGO_URI || process.env.MONGODB_URI;

    if (!connUrl) {
      throw new Error('MongoDB connection URL is missing in environment variables (MONGO_DB_URL)');
    }

    const conn = await mongoose.connect(connUrl);
    console.log(`[MongoDB] Connected to host: ${conn.connection.host}`);
  } catch (error) {
    console.error(`[MongoDB] Connection Error: ${error.message}`);
  }
};

module.exports = connectDB;
