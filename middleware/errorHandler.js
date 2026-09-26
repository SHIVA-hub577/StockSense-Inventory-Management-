/**
 * Global error-handling middleware
 */
const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || (res.statusCode && res.statusCode !== 200 ? res.statusCode : 500);
  let message = err.message || 'Internal Server Error';

  // Mongoose schema validation failed
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(err.errors).map((e) => e.message).join(', ');
  }

  // Invalid ObjectId (e.g. /products/not-an-id)
  if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid value for ${err.path}`;
  }

  // Document changed by someone else since it was loaded (optimistic concurrency)
  if (err.name === 'VersionError') {
    statusCode = 409;
    message = 'This record was changed by someone else. Reload the page and try again.';
  }

  // Unique index violation (e.g. duplicate SKU)
  if (err.code === 11000) {
    statusCode = 409;
    const fields = Object.keys(err.keyValue || {}).join(', ');
    message = `A record with this ${fields || 'value'} already exists`;
  }

  if (statusCode >= 500) {
    console.error(`[Error] ${req.method} ${req.originalUrl}:`, err);
    if (process.env.NODE_ENV === 'production') {
      message = 'Something went wrong. Please try again.';
    }
  }

  // Browser page navigation (not API / fetch calls): show the HTML error page
  const isPageRequest =
    req.method === 'GET' &&
    !req.originalUrl.startsWith('/api/') &&
    !req.originalUrl.startsWith('/health') &&
    req.accepts('html') &&
    !req.xhr &&
    !req.headers['x-requested-with'];

  if (isPageRequest) {
    const titles = { 400: 'Bad Request', 403: 'Access Denied', 404: 'Page Not Found' };
    return res.status(statusCode).render('error', {
      title: titles[statusCode] || 'Something Went Wrong',
      statusCode,
      message: statusCode === 404 && !err.statusCode ? 'The page you are looking for does not exist.' : message,
      user: req.user || null,
    });
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(err.details && { details: err.details }),
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
  });
};

module.exports = errorHandler;
