/**
 * Controller to handle EJS page rendering
 */
const Operation = require('../models/Operation');

const getLandingPage = (req, res) => {
  res.render('landing', {
    title: 'StockSense - Modern Inventory & Warehouse Control Platform',
    user: req.user || null,
  });
};

const getLoginPage = (req, res) => {
  res.render('auth/login', {
    title: 'Login - StockSense',
    error: req.query.error || null,
    success: req.query.success || null,
  });
};

const getSignupPage = (req, res) => {
  res.render('auth/signup', {
    title: 'Sign Up - StockSense',
    error: req.query.error || null,
  });
};

const getForgotPasswordPage = (req, res) => {
  res.render('auth/forgot-password', {
    title: 'Forgot Password - StockSense',
    error: req.query.error || null,
  });
};

const getVerifyOtpPage = (req, res) => {
  res.render('auth/verify-otp', {
    title: 'Verify OTP - StockSense',
    email: req.query.email || '',
    error: req.query.error || null,
  });
};

const getResetPasswordPage = (req, res) => {
  res.render('auth/reset-password', {
    title: 'Reset Password - StockSense',
    email: req.query.email || '',
    error: req.query.error || null,
  });
};

const getProfilePage = async (req, res) => {
  const mine = { $or: [{ createdBy: req.user._id }, { validatedBy: req.user._id }] };
  const [created, validated, recent] = await Promise.all([
    Operation.countDocuments({ createdBy: req.user._id }),
    Operation.countDocuments({ validatedBy: req.user._id }),
    Operation.find(mine).sort({ updatedAt: -1 }).limit(8).select('reference type status partner updatedAt').lean(),
  ]);
  res.render('profile', {
    title: 'My Profile - StockSense',
    activeNav: 'profile',
    stats: { created, validated },
    recent,
  });
};

module.exports = {
  getLandingPage,
  getLoginPage,
  getSignupPage,
  getForgotPasswordPage,
  getVerifyOtpPage,
  getResetPasswordPage,
  getProfilePage,
};
