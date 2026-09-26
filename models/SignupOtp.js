const mongoose = require('mongoose');

const signupOtpSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
  otp: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 600, // Auto-delete from MongoDB after 10 minutes (600 seconds)
  },
});

module.exports = mongoose.model('SignupOtp', signupOtpSchema);
