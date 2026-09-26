const express = require('express');
const router = express.Router();
const {
  sendSignupOtp,
  signup,
  login,
  logout,
  forgotPassword,
  verifyOtp,
  resetPassword,
  getMe,
} = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

router.post('/send-signup-otp', sendSignupOtp);
router.post('/signup', signup);
router.post('/login', login);
router.all('/logout', logout);
router.post('/forgot-password', forgotPassword);
router.post('/verify-otp', verifyOtp);
router.post('/reset-password', resetPassword);
router.get('/me', protect, getMe);

module.exports = router;
