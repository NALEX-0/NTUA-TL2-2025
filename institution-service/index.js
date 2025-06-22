// index.js
// Main entry point for Institution Service (Express + Sequelize)

const express = require('express');
const instRoutes = require('./routes/institutions');
const db = require('./models'); // Sequelize instance and models

const app = express();

// Built-in middleware for JSON parsing
app.use(express.json());

// Simple request logger (for debugging/commits)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

/**
 * Health check endpoint
 * GET /health → should return OK when service is up
 */
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Mount all institution-related routes under /institutions
app.use('/institutions', instRoutes);

// Global 404 handler for unknown routes
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[ERROR] Unhandled exception:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Start the HTTP server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`> Institution Service listening on port ${PORT}`);
  // Ensure database connection on startup
  db.sequelize
    .authenticate()
    .then(() => console.log('> Database connection OK'))
    .catch((err) => console.error('> Database connection FAILED:', err));
});
