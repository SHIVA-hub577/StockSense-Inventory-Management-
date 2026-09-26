const express = require('express');
const router = express.Router();
const {
  getLandingPage,
  getLoginPage,
  getSignupPage,
  getForgotPasswordPage,
  getVerifyOtpPage,
  getResetPasswordPage,
  getDashboardPage,
} = require('../controllers/viewController');
const { protect, authorize } = require('../middleware/authMiddleware');

// Public Web View Routes
router.get('/', getLandingPage);
router.get('/auth/login', getLoginPage);
router.get('/auth/signup', getSignupPage);
router.get('/auth/forgot-password', getForgotPasswordPage);
router.get('/auth/verify-otp', getVerifyOtpPage);
router.get('/auth/reset-password', getResetPasswordPage);

// Dashboard Route (Protected - Shared by Manager & Staff)
router.get('/dashboard', protect, getDashboardPage);

// Sample Role-Gated Routes to demonstrate permission checks
router.get('/manager/catalog', protect, authorize('manager'), (req, res) => {
  res.render('dashboard', {
    title: 'Catalog Management (Manager Only)',
    user: req.user,
    activeSection: 'catalog',
  });
});

router.get('/staff/receiving', protect, authorize('staff', 'manager'), (req, res) => {
  res.render('dashboard', {
    title: 'Goods Receiving (Staff & Manager)',
    user: req.user,
    activeSection: 'receiving',
  });
});

module.exports = router;
