import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
// Legacy routes — disabled (no auth, not used by experiment)
// import { userRoutes } from './routes/users.js';
// import { profileRoutes } from './routes/profiles.js';
// import { summaryRoutes } from './routes/summaries.js';
// import { feedbackRoutes } from './routes/feedback.js';
import { articleRoutes } from './routes/articles.js';
import { experimentRoutes } from './routes/experiment.js';
import { authRoutes } from './routes/auth.js';
import { managerRoutes } from './routes/manager.js';
import { userRoutes } from './routes/user.js';
import { requireAuth } from './middleware/auth.js';
import { closeDb } from './db/connection.js';
import { runMigrations } from './db/auto-migrate.js';
import { getGroqStatus } from './services/groqClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;
const isDev = process.env.NODE_ENV !== 'production';

// Run database migrations on startup
await runMigrations();

// Security headers
app.use(helmet());

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

// LLM provider status check
app.get('/api/llm/status', async (req, res) => {
  const status = await getGroqStatus();
  res.json(status);
});

// Rate limiting on login to prevent brute-force attacks on access codes
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Muitas tentativas. Tente novamente em 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/auth/login', loginLimiter);

// Rate limiting on magic link to prevent abuse
const magicLinkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // per IP — additional per-email limit is enforced in the route handler
  message: { error: 'Muitas tentativas. Tente novamente em 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/auth/magic-link', magicLinkLimiter);

// Routes
app.use('/api/articles', requireAuth, articleRoutes);
app.use('/api/experiment', experimentRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/manager', managerRoutes);
app.use('/api/user', requireAuth, userRoutes);

// Legacy routes — disabled (no auth protection, not used by experiment)
// app.use('/api/users', userRoutes);
// app.use('/api/profiles', profileRoutes);
// app.use('/api/summaries', summaryRoutes);
// app.use('/api/feedback', feedbackRoutes);

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
  server.close(async () => {
    await closeDb();
    console.log('Server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
