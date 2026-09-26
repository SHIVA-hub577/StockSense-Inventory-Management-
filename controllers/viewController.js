/**
 * Controller to handle EJS page rendering
 */

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

const getDashboardPage = (req, res) => {
  res.render('dashboard', {
    title: 'Dashboard - StockSense',
    user: req.user,
  });
};

module.exports = {
  getLandingPage,
  getLoginPage,
  getSignupPage,
  getForgotPasswordPage,
  getVerifyOtpPage,
  getResetPasswordPage,
  getDashboardPage,
};
