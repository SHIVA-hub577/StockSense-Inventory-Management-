/**
 * Small helpers for reading user input safely in controllers.
 */

// Escape user text before using it inside a RegExp (search boxes)
const escapeRegex = (text = '') => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Case-insensitive "contains" regex for a search term, or null when empty
const searchRegex = (term) => {
  const trimmed = String(term || '').trim().slice(0, 100);
  return trimmed ? new RegExp(escapeRegex(trimmed), 'i') : null;
};

// Only copy whitelisted fields from a request body (prevents mass assignment)
const pick = (source = {}, fields = []) => {
  const out = {};
  for (const field of fields) {
    if (source[field] !== undefined) {
      out[field] = source[field];
    }
  }
  return out;
};

const MAX_PAGE = 10000;

// ?page=2 -> { page: 2, limit, skip } (capped so huge numbers cannot overflow $skip)
const parsePage = (query = {}, limit = 20) => {
  const page = Math.min(MAX_PAGE, Math.max(1, parseInt(query.page, 10) || 1));
  return { page, limit, skip: (page - 1) * limit };
};

// Object lookup for user input that ignores inherited keys (e.g. ?tab=constructor)
const ownKey = (object, key) => (typeof key === 'string' && Object.hasOwn(object, key) ? key : null);

/**
 * "2026-09-27" (from <input type="date">) -> Date at local midnight.
 * Returns undefined for empty input and throws a 400-style error for garbage.
 */
const parseDateInput = (value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    const AppError = require('./AppError');
    throw new AppError('Invalid date');
  }
  return date;
};

// Blank strings -> undefined so optional numeric/ref fields can be cleared or skipped
const blankToNull = (value) => (value === '' ? null : value);

module.exports = {
  escapeRegex,
  searchRegex,
  pick,
  parsePage,
  ownKey,
  parseDateInput,
  blankToNull,
};
