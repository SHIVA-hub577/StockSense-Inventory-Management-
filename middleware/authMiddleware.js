const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Browser page requests get redirects / HTML error pages; API and fetch() calls get JSON
const wantsHtml = (req) =>
  !req.originalUrl.startsWith('/api/') && req.accepts('html') && !req.xhr && !req.headers['x-requested-with'];

/**
 * Protect routes: Requires valid JWT token in cookies or Authorization header
 */
const protect = async (req, res, next) => {
  let token;

  if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    // If request accepts HTML, redirect to login page
    if (wantsHtml(req)) {
      return res.redirect('/auth/login?error=Please log in to access this page');
    }
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route. Token missing.',
    });
  }

  try {
    const secret = process.env.JWT_SECRET || 'fallback_secret_stocksense_key';
    const decoded = jwt.verify(token, secret);

    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      if (wantsHtml(req)) {
        return res.redirect('/auth/login?error=User account no longer exists');
      }
      return res.status(401).json({
        success: false,
        message: 'User belonging to this token no longer exists.',
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (wantsHtml(req)) {
      return res.redirect('/auth/login?error=Session expired. Please log in again');
    }
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token. Please log in again.',
    });
  }
};

/**
 * Role-Based Access Control Middleware
 * @param  {...String} roles Allowed roles ('manager', 'staff')
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'User authentication required.',
      });
    }

    if (!roles.includes(req.user.role)) {
      if (wantsHtml(req)) {
        return res.status(403).render('error', {
          title: 'Access Denied',
          statusCode: 403,
          message: `Access denied. Role "${req.user.role}" does not have permission to view this page. Required: ${roles.join(' or ')}.`,
          user: req.user,
        });
      }
      return res.status(403).json({
        success: false,
        message: `Role "${req.user.role}" is not authorized to access this resource. Required role: ${roles.join(' or ')}.`,
      });
    }

    next();
  };
};

module.exports = {
  protect,
  authorize,
};
