import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { userRoutes } from './routes/users.js';
import { profileRoutes } from './routes/profiles.js';
import { articleRoutes } from './routes/articles.js';
import { summaryRoutes } from './routes/summaries.js';
import { feedbackRoutes } from './routes/feedback.js';
import { experimentRoutes } from './routes/experiment.js';
import { authRoutes } from './routes/auth.js';
import { closeDb } from './db/connection.js';
import { runMigrations } from './db/auto-migrate.js';
import { getOllamaStatus } from './services/ollamaClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const isDev = process.env.NODE_ENV !== 'production';

// Run database migrations on startup
runMigrations();

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:5173'];
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

// Body parsing with size limits
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Ollama status check
app.get('/api/ollama/status', async (req, res) => {
  const status = await getOllamaStatus();
  res.json(status);
});

// Routes
app.use('/api/users', userRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/articles', articleRoutes);
app.use('/api/summaries', summaryRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/experiment', experimentRoutes);
app.use('/api/auth', authRoutes);

// Serve frontend in production
if (!isDev) {
  const frontendPath = path.join(__dirname, '../../web/dist');
  app.use(express.static(frontendPath));
  // SPA fallback - serve index.html for any non-API route
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(frontendPath, 'index.html'));
    }
  });
}

// Error handler - don't leak details in production
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  console.error('Error:', err.message, isDev ? err.stack : '');
  res.status(500).json({
    error: isDev ? err.message : 'Internal server error',
  });
});

const server = app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});

// Graceful shutdown
const shutdown = () => {
  console.log('Shutting down gracefully...');
  server.close(() => {
    closeDb();
    console.log('Server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
