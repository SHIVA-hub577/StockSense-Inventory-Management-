require('dotenv').config();
const connectDB = require('./config/db');
const app = require('./app');

// Initialize MongoDB Connection
connectDB();

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`\n=============================================================`);
  console.log(`🚀 [Server] Running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  console.log(`🌐 Landing Page  : http://localhost:${PORT}/`);
  console.log(`📝 Signup Page    : http://localhost:${PORT}/auth/signup`);
  console.log(`🔑 Login Page     : http://localhost:${PORT}/auth/login`);
  console.log(`📊 Dashboard      : http://localhost:${PORT}/dashboard`);
  console.log(`📦 Products       : http://localhost:${PORT}/products`);
  console.log(`🚚 Operations     : http://localhost:${PORT}/receipts  /deliveries  /transfers`);
  console.log(`💚 Health Check  : http://localhost:${PORT}/health`);
  console.log(`=============================================================\n`);
});
