const express = require('express');
const router = express.Router();
const {
  getLandingPage,
  getLoginPage,
  getSignupPage,
  getForgotPasswordPage,
  getVerifyOtpPage,
  getResetPasswordPage,
  getProfilePage,
} = require('../controllers/viewController');
const { protect } = require('../middleware/authMiddleware');
const appLocals = require('../middleware/appLocals');

// Public Web View Routes
router.get('/', getLandingPage);
router.get('/auth/login', getLoginPage);
router.get('/auth/signup', getSignupPage);
router.get('/auth/forgot-password', getForgotPasswordPage);
router.get('/auth/verify-otp', getVerifyOtpPage);
router.get('/auth/reset-password', getResetPasswordPage);

// Profile (the dashboard lives in inventoryRoutes)
router.get('/profile', protect, appLocals, getProfilePage);

module.exports = router;
