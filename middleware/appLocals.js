const Operation = require('../models/Operation');
const productService = require('../services/productService');
const alertService = require('../services/alertService');

/**
 * For logged-in app pages (use after `protect`): exposes the user, the current
 * path and sidebar badge counts (operations to process, stock alerts) to views.
 */
const appLocals = async (req, res, next) => {
  res.locals.user = req.user;
  res.locals.currentPath = req.path;
  res.locals.navCounts = { receipt: 0, delivery: 0, internal: 0, adjustment: 0, stockAlerts: 0, unreadAlerts: 0 };

  try {
    const [byType, stockAlerts, unreadAlerts] = await Promise.all([
      Operation.aggregate([
        { $match: { status: { $in: ['waiting', 'ready'] } } },
        { $group: { _id: '$type', n: { $sum: 1 } } },
      ]),
      productService.countStockAlerts(),
      alertService.unreadCount(req.user._id),
    ]);
    byType.forEach((row) => {
      res.locals.navCounts[row._id] = row.n;
    });
    res.locals.navCounts.stockAlerts = stockAlerts;
    res.locals.navCounts.unreadAlerts = unreadAlerts;
  } catch (err) {
    // Badges are decoration: never block a page because of them
    console.error(`[Nav] Could not load sidebar counts: ${err.message}`);
  }

  next();
};

module.exports = appLocals;
