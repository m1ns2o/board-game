import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import { attachGameSocketServer } from './socket';

const app = express();
const port = Number(process.env.PORT ?? 3001);
const clientDistPath = path.resolve(process.cwd(), 'dist');
const clientIndexPath = path.join(clientDistPath, 'index.html');

app.use(cors());
app.use(express.json());

app.get('/health', (_request, response) => {
  response.json({ ok: true, service: 'quiz-board-game', timestamp: Date.now() });
});

if (existsSync(clientIndexPath)) {
  app.use(express.static(clientDistPath));
  app.get(/^\/(?!socket\.io\/).*/, (_request, response) => {
    response.sendFile(clientIndexPath);
  });
} else {
  console.warn(`React build not found at ${clientIndexPath}; serving API and sockets only.`);
}

const server = http.createServer(app);
attachGameSocketServer(server);

server.listen(port, () => {
  console.log(`Quiz board game server listening on http://127.0.0.1:${port}`);
});
