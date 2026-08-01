import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { mealsRouter } from './routes/meals';
import { reportsRouter } from './routes/reports';
import { glucoseRouter } from './routes/glucose';
import { healthRouter } from './routes/health';

const app = express();
const port = Number(process.env.PORT) || 8787;
const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(uploadDir));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'health-companion-api',
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.startsWith('sk-your-key')),
  });
});

app.use('/meals', mealsRouter);
app.use('/reports', reportsRouter);
app.use('/glucose', glucoseRouter);
app.use('/health-data', healthRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'server error' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Health Companion API listening on http://0.0.0.0:${port}`);
});
