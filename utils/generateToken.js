const jwt = require('jsonwebtoken');

/**
 * Generate JWT token and set HTTP-only cookie
 */
const sendTokenResponse = (user, statusCode, res, message = 'Success') => {
  const payload = {
    id: user._id,
    role: user.role,
    name: user.name,
    email: user.email,
  };

  const secret = process.env.JWT_SECRET || 'fallback_secret_stocksense_key';
  const token = jwt.sign(payload, secret, {
    expiresIn: '7d',
  });

  const cookieOptions = {
    expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  };

  res.cookie('token', token, cookieOptions);

  return res.status(statusCode).json({
    success: true,
    message,
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone || '',
    },
  });
};

module.exports = {
  sendTokenResponse,
};
