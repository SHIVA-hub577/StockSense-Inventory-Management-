const nodemailer = require('nodemailer');

/**
 * Send email using Nodemailer and Gmail App Password
 * @param {Object} options - { to, subject, html, text }
 */
const sendEmail = async (options) => {
  const googleUser = process.env.GOOGLEUSER;
  const rawPass = process.env.GMAIL_APP_PASSWORD || '';
  // Clean up any spaces from 16-letter App Password if pasted with spaces
  const appPassword = rawPass.replace(/\s+/g, '');

  if (!googleUser || !appPassword) {
    // Local development without Gmail credentials: print the email (incl. OTP) to the console instead
    if (process.env.NODE_ENV !== 'production') {
      const text = options.text || (options.html ? options.html.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim() : '');
      console.log(`\n[Email Dev Fallback] Gmail credentials not configured - email NOT sent.`);
      console.log(`  To      : ${options.to}`);
      console.log(`  Subject : ${options.subject}`);
      console.log(`  Body    : ${text}\n`);
      return { messageId: 'dev-console-fallback' };
    }
    throw new Error('Gmail credentials (GOOGLEUSER / GMAIL_APP_PASSWORD) are not set in environment variables');
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: googleUser,
      pass: appPassword,
    },
  });

  const mailOptions = {
    from: `"StockSense Support" <${googleUser}>`,
    to: options.to,
    subject: options.subject,
    text: options.text || (options.html ? options.html.replace(/<[^>]*>?/gm, '') : ''),
    html: options.html,
  };

  const info = await transporter.sendMail(mailOptions);
  console.log(`[Email Sent] Message ID: ${info.messageId} to ${options.to}`);
  return info;
};

module.exports = sendEmail;
