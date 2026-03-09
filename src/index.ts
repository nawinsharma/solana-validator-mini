import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { AccountStore } from './accounts.js';
import { createLedger } from './ledger.js';
import { createWebSocketHandlers } from './websocket.js';
import { createRpcHandler } from './rpc.js';

const app = express();
app.use(express.json({ limit: '10mb' }));

const store = new AccountStore();
const ledger = createLedger(store);

const { notifySignatureSubscribers, setupWss } = createWebSocketHandlers(ledger);
const { handleRpc } = createRpcHandler({ ledger, store, notifySignatureSubscribers });

app.post('/', (req, res) => {
  const body = req.body;
  if (Array.isArray(body)) {
    res.json(body.map(handleRpc));
  } else {
    res.json(handleRpc(body));
  }
});

const server = http.createServer(app);

// WS on same HTTP server (port 3000)
const wss = new WebSocketServer({ server });
setupWss(wss);

// @solana/web3.js connects WS to port+1, so also listen on 3001
const wsServer3001 = new WebSocketServer({ port: 3001 });
setupWss(wsServer3001);

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Mini Solana Validator running on port ${PORT} (ws on ${PORT} and ${PORT + 1})`);
});
