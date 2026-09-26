const { Resend } = require('resend');

/**
 * Send email using Resend API
 * @param {Object} options - { to, subject, html, text }
 */
const sendEmail = async (options) => {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    if (process.env.NODE_ENV !== 'production') {
      const text = options.text || (options.html ? options.html.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim() : '');
      console.log(`\n[Email Dev Fallback] RESEND_API_KEY not configured - email NOT sent.`);
      console.log(`  To      : ${options.to}`);
      console.log(`  Subject : ${options.subject}`);
      console.log(`  Body    : ${text}\n`);
      return { id: 'dev-console-fallback' };
    }
    throw new Error('RESEND_API_KEY is not set in environment variables');
  }

  const resend = new Resend(apiKey);
  const fromEmail = process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL || 'StockSense <onboarding@resend.dev>';

  const payload = {
    from: fromEmail,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text || (options.html ? options.html.replace(/<[^>]*>?/gm, '') : ''),
  };

  try {
    const { data, error } = await resend.emails.send(payload);

    if (error) {
      // Resend free tier restriction: can only send testing emails to the registered account email
      if (process.env.NODE_ENV !== 'production' && (error.statusCode === 403 || error.name === 'validation_error')) {
        const text = options.text || (options.html ? options.html.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim() : '');
        console.warn(`\n⚠️ [Resend Free Tier Limitation] ${error.message}`);
        console.warn(`👉 [Dev Fallback] Displaying email content in console:`);
        console.log(`  To      : ${options.to}`);
        console.log(`  Subject : ${options.subject}`);
        console.log(`  Body    : ${text}\n`);
        return { id: 'dev-resend-restriction-fallback' };
      }
      console.error(`[Email Error] Failed to send email via Resend:`, error);
      throw new Error(error.message || 'Failed to send email via Resend');
    }

    console.log(`[Email Sent] Message ID: ${data?.id || 'sent'} to ${options.to}`);
    return data;
  } catch (err) {
    if (process.env.NODE_ENV !== 'production' && !err.message?.startsWith('Failed to send')) {
      const text = options.text || (options.html ? options.html.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim() : '');
      console.warn(`\n⚠️ [Resend Dev Warning] ${err.message}`);
      console.log(`  To      : ${options.to}`);
      console.log(`  Subject : ${options.subject}`);
      console.log(`  Body    : ${text}\n`);
      return { id: 'dev-resend-error-fallback' };
    }
    throw err;
  }
};

module.exports = sendEmail;
