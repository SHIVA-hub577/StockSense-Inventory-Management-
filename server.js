require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const connectDB = require('./config/db');

// Route Imports
const healthRoutes = require('./routes/healthRoutes');
const authRoutes = require('./routes/authRoutes');
const viewRoutes = require('./routes/viewRoutes');

// Middleware Imports
const notFoundHandler = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Initialize MongoDB Connection
connectDB();

// View Engine Setup (EJS)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Core Middlewares
app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Mount Web UI Routes
app.use('/', viewRoutes);

// Mount API Routes
app.use('/health', healthRoutes);
app.use('/auth', authRoutes);

// Fallback & Error Handling Middlewares
app.use(notFoundHandler);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`\n=============================================================`);
  console.log(`🚀 [Server] Running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  console.log(`🌐 Landing Page  : http://localhost:${PORT}/`);
  console.log(`📝 Signup Page    : http://localhost:${PORT}/auth/signup`);
  console.log(`🔑 Login Page     : http://localhost:${PORT}/auth/login`);
  console.log(`📊 Dashboard      : http://localhost:${PORT}/dashboard`);
  console.log(`💚 Health Check  : http://localhost:${PORT}/health`);
  console.log(`=============================================================\n`);
});
