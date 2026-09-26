const express = require('express');
const router = express.Router();
const { getHealthStatus } = require('../controllers/healthController');

/**
 * @route   GET /health
 * @desc    Get server and database health status
 * @access  Public
 */
router.get('/', getHealthStatus);

module.exports = router;
