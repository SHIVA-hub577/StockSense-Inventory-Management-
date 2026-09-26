const mongoose = require('mongoose');
const { successResponse } = require('../utils/apiResponse');

/**
 * Controller to handle server health check
 */
const getHealthStatus = (req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStatusMap = {
    0: 'Disconnected',
    1: 'Connected',
    2: 'Connecting',
    3: 'Disconnecting',
  };

  const healthInfo = {
    status: 'UP',
    timestamp: new Date().toISOString(),
    uptime: `${Math.floor(process.uptime())}s`,
    database: {
      status: dbStatusMap[dbState] || 'Unknown',
      readyState: dbState,
    },
  };

  return successResponse(res, 'Server is running smoothly', healthInfo);
};

module.exports = {
  getHealthStatus,
};
