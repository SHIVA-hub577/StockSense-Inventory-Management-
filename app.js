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

// Icon paths for scripts that draw icons in the browser (command palette)
const iconScript = `window.StockSenseIcons = ${JSON.stringify(viewHelpers.iconPaths)};`;
app.get('/js/icons.js', (req, res) => res.type('application/javascript').set('Cache-Control', 'public, max-age=3600').send(iconScript));

// Front-end libraries and fonts served from node_modules, so the app works
// offline (no CDNs). Only each package's distribution folder is exposed.
const vendor = (dir) => express.static(path.join(__dirname, 'node_modules', dir), { index: false, maxAge: '1d' });
app.use('/vendor/gsap', vendor('gsap/dist'));
app.use('/vendor/three', vendor('three/build'));
app.use('/vendor/lenis', vendor('lenis/dist'));
app.use('/vendor/chart.js', vendor('chart.js/dist'));
app.use('/vendor/jsbarcode', vendor('jsbarcode/dist'));
app.use('/vendor/html5-qrcode', vendor('html5-qrcode'));
app.use('/vendor/fonts/bricolage', vendor('@fontsource-variable/bricolage-grotesque/files'));
app.use('/vendor/fonts/plex-sans', vendor('@fontsource/ibm-plex-sans/files'));
app.use('/vendor/fonts/plex-mono', vendor('@fontsource/ibm-plex-mono/files'));

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
