/**
 * Express application (no DB connection / listen here, so tests can import it).
 */
const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const viewHelpers = require('./utils/viewHelpers');

// Route Imports
const healthRoutes = require('./routes/healthRoutes');
const authRoutes = require('./routes/authRoutes');
const viewRoutes = require('./routes/viewRoutes');
const inventoryRoutes = require('./routes/inventoryRoutes');
const apiRoutes = require('./routes/apiRoutes');

// Middleware Imports
const notFoundHandler = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Live feed + low-stock alerts listen to the stock engine
require('./services/activityService').start();
require('./services/alertService').start();

// View Engine Setup (EJS) + helpers available in every template
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
Object.assign(app.locals, viewHelpers);

// Core Middlewares
app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Mount Web UI Routes
app.use('/', viewRoutes);
app.use('/', inventoryRoutes);

// Mount API Routes
app.use('/health', healthRoutes);
app.use('/auth', authRoutes);
app.use('/api', apiRoutes);

// Fallback & Error Handling Middlewares
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
