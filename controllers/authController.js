const User = require('../models/User');
const SignupOtp = require('../models/SignupOtp');
const sendEmail = require('../utils/sendEmail');
const { sendTokenResponse } = require('../utils/generateToken');

/**
 * @desc    Send 6-digit OTP to email address for Signup Verification
 * @route   POST /auth/send-signup-otp
 * @access  Public
 */
const sendSignupOtp = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an email address',
      });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Check if user already exists
    const existingUser = await User.findOne({ email: cleanEmail });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email address already exists. Please log in.',
      });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Remove any previous pending OTP for this email
    await SignupOtp.deleteMany({ email: cleanEmail });

    // Save new OTP in MongoDB
    await SignupOtp.create({
      email: cleanEmail,
      otp,
    });

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: #1e293b; margin: 0;">StockSense Registration</h2>
          <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Email Verification OTP</p>
        </div>
        <p style="color: #334155; font-size: 15px;">Hello,</p>
        <p style="color: #334155; font-size: 15px;">Use the following 6-digit One-Time Password (OTP) to complete your account registration on <strong>StockSense</strong>:</p>
        
        <div style="text-align: center; margin: 25px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #2563eb; background-color: #eff6ff; padding: 12px 24px; border-radius: 8px; display: inline-block; border: 1px dashed #3b82f6;">
            ${otp}
          </span>
        </div>
        
        <p style="color: #ef4444; font-size: 13px; text-align: center;">⏱️ This OTP is valid for <strong>10 minutes</strong>.</p>
        <p style="color: #64748b; font-size: 13px; margin-top: 20px; border-top: 1px solid #f1f5f9; padding-top: 15px; text-align: center;">If you did not request this OTP, please ignore this email.</p>
      </div>
    `;

    try {
      await sendEmail({
        to: cleanEmail,
        subject: 'StockSense - Signup Verification OTP',
        html: emailHtml,
      });

      return res.status(200).json({
        success: true,
        message: 'A 6-digit verification OTP has been sent to your email address.',
        email: cleanEmail,
      });
    } catch (emailErr) {
      console.error('[Send Signup OTP Email Error]', emailErr);
      return res.status(500).json({
        success: false,
        message: `Failed to send OTP email: ${emailErr.message}`,
      });
    }
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Register a new User with OTP verification
 * @route   POST /auth/signup
 * @access  Public
 */
const signup = async (req, res, next) => {
  try {
    const { name, email, password, role, phone, otp } = req.body;

    // Validate required fields
    if (!name || !email || !password || !role || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Please fill all required fields and enter the 6-digit OTP',
      });
    }

    const cleanEmail = email.toLowerCase().trim();
    const cleanOtp = otp.toString().trim();

    // Verify OTP record in MongoDB
    const validOtpRecord = await SignupOtp.findOne({
      email: cleanEmail,
      otp: cleanOtp,
    });

    if (!validOtpRecord) {
      return res.status(400).json({
        success: false,
        message: 'OTP is invalid or expired. Cannot create account.',
      });
    }

    // Validate role enum
    if (!['manager', 'staff'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Role must be either "manager" (Inventory Manager) or "staff" (Warehouse Staff)',
      });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long',
      });
    }

    // Check existing user
    const existingUser = await User.findOne({ email: cleanEmail });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email address already exists',
      });
    }

    // OTP is verified — Create user!
    const user = await User.create({
      name: name.trim(),
      email: cleanEmail,
      password,
      role,
      phone: phone ? phone.trim() : '',
    });

    // Delete used OTP
    await SignupOtp.deleteMany({ email: cleanEmail });

    // Send Welcome Email
    const roleTitle = user.role === 'manager' ? 'Inventory Manager' : 'Warehouse Staff';
    const welcomeHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: #1e293b; margin: 0;">Welcome to StockSense 🎉</h2>
          <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Account Registration Successful</p>
        </div>
        <p style="color: #334155; font-size: 15px;">Hello <strong>${user.name}</strong>,</p>
        <p style="color: #334155; font-size: 15px; line-height: 1.5;">
          Your StockSense account has been successfully created with the following details:
        </p>
        
        <div style="background-color: #f8fafc; border-left: 4px solid #2563eb; padding: 14px 18px; margin: 20px 0; border-radius: 6px;">
          <p style="margin: 4px 0; color: #334155; font-size: 14px;"><strong>Email:</strong> ${user.email}</p>
          <p style="margin: 4px 0; color: #334155; font-size: 14px;"><strong>Assigned Role:</strong> ${roleTitle}</p>
          ${user.phone ? `<p style="margin: 4px 0; color: #334155; font-size: 14px;"><strong>Phone:</strong> ${user.phone}</p>` : ''}
        </div>
        
        <p style="color: #334155; font-size: 14px; line-height: 1.5;">
          You can now log in to access your role-customized dashboard and inventory management tools.
        </p>
        
        <p style="color: #64748b; font-size: 13px; margin-top: 24px; border-top: 1px solid #f1f5f9; padding-top: 15px; text-align: center;">
          StockSense System &copy; ${new Date().getFullYear()}
        </p>
      </div>
    `;

    try {
      await sendEmail({
        to: user.email,
        subject: 'Welcome to StockSense - Account Created',
        html: welcomeHtml,
      });
    } catch (emailErr) {
      console.error('[Signup Email Warning]', emailErr.message);
    }

    return sendTokenResponse(user, 201, res, 'User registered successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Login User & Get Token
 * @route   POST /auth/login
 * @access  Public
 */
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both email and password',
      });
    }

    // Find user & include password field
    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // Match password
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    return sendTokenResponse(user, 200, res, 'Logged in successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Logout user & clear cookie
 * @route   GET /auth/logout or POST /auth/logout
 * @access  Public
 */
const logout = async (req, res) => {
  // Delete the session cookie (same options it was set with in utils/generateToken.js)
  res.clearCookie('token', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });

  if (req.accepts('html') && !req.xhr && !req.headers['x-requested-with']) {
    return res.redirect('/auth/login?success=Logged out successfully');
  }

  return res.status(200).json({
    success: true,
    message: 'Logged out successfully',
  });
};

/**
 * @desc    Forgot Password - Send 6-digit OTP via Email
 * @route   POST /auth/forgot-password
 * @access  Public
 */
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide your registered email address',
      });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No user account found with this email address',
      });
    }

    // Generate 6-digit OTP
    const otp = user.generateOTP();
    await user.save({ validateBeforeSave: false });

    // Send email with styled HTML
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: #1e293b; margin: 0;">StockSense Security</h2>
          <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Password Reset Verification OTP</p>
        </div>
        <p style="color: #334155; font-size: 15px;">Hello <strong>${user.name}</strong>,</p>
        <p style="color: #334155; font-size: 15px;">We received a request to reset your password. Use the following 6-digit One-Time Password (OTP) to proceed:</p>
        
        <div style="text-align: center; margin: 25px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #2563eb; background-color: #eff6ff; padding: 12px 24px; border-radius: 8px; display: inline-block; border: 1px dashed #3b82f6;">
            ${otp}
          </span>
        </div>
        
        <p style="color: #ef4444; font-size: 13px; text-align: center;">⏱️ This OTP is valid for <strong>10 minutes</strong> only.</p>
        <p style="color: #64748b; font-size: 13px; margin-top: 20px; border-top: 1px solid #f1f5f9; padding-top: 15px;">If you did not request a password reset, please ignore this email.</p>
      </div>
    `;

    try {
      await sendEmail({
        to: user.email,
        subject: 'StockSense - Password Reset Verification OTP',
        html: emailHtml,
      });

      return res.status(200).json({
        success: true,
        message: 'A 6-digit OTP has been sent to your email address.',
        email: user.email,
      });
    } catch (emailError) {
      user.resetPasswordOtp = undefined;
      user.resetPasswordExpires = undefined;
      await user.save({ validateBeforeSave: false });

      console.error('[Forgot Password Error]', emailError);
      return res.status(500).json({
        success: false,
        message: `Failed to send OTP email: ${emailError.message}`,
      });
    }
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Verify 6-digit OTP
 * @route   POST /auth/verify-otp
 * @access  Public
 */
const verifyOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both email and OTP',
      });
    }

    const user = await User.findOne({
      email: email.toLowerCase().trim(),
      resetPasswordOtp: otp.trim(),
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP code',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'OTP verified successfully. You can now reset your password.',
      email: user.email,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Reset Password with verified OTP
 * @route   POST /auth/reset-password
 * @access  Public
 */
const resetPassword = async (req, res, next) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email, OTP and new password',
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long',
      });
    }

    // The OTP must be re-checked here, otherwise anyone who triggers a reset
    // for an email could set that account's password without the code.
    const user = await User.findOne({
      email: email.toLowerCase().trim(),
      resetPasswordOtp: otp.toString().trim(),
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'OTP session expired or invalid. Please request a new OTP.',
      });
    }

    // Set new password
    user.password = newPassword;
    user.resetPasswordOtp = null;
    user.resetPasswordExpires = null;
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Password reset successfully! You can now log in with your new password.',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get Current Logged in User Profile
 * @route   GET /auth/me
 * @access  Private
 */
const getMe = async (req, res) => {
  return res.status(200).json({
    success: true,
    user: req.user,
  });
};

module.exports = {
  sendSignupOtp,
  signup,
  login,
  logout,
  forgotPassword,
  verifyOtp,
  resetPassword,
  getMe,
};
