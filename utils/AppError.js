/**
 * Operational error with an HTTP status code.
 * Thrown by services (e.g. the stock engine) and turned into a JSON
 * response by middleware/errorHandler.js.
 */
class AppError extends Error {
  /**
   * @param {string} message Human readable message (safe to show to users)
   * @param {number} statusCode HTTP status code (default 400)
   * @param {Object} [details] Optional extra data (e.g. stock shortages)
   */
  constructor(message, statusCode = 400, details = null) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

module.exports = AppError;
