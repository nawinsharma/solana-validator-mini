import { WebSocketServer, WebSocket } from 'ws';
import { Ledger } from './ledger.js';

interface SignatureSubscription {
  ws: WebSocket;
  subscriptionId: number;
  signature: string;
}

export function createWebSocketHandlers(ledger: Ledger) {
  let wsSubscriptionId = 0;
  const signatureSubscriptions: SignatureSubscription[] = [];

  function notifySignatureSubscribers(signature: string) {
    const toRemove: number[] = [];
    for (let i = 0; i < signatureSubscriptions.length; i++) {
      const sub = signatureSubscriptions[i];
      if (sub.signature === signature) {
        try {
          sub.ws.send(JSON.stringify({
            jsonrpc: '2.0',
            method: 'signatureNotification',
            params: {
              result: { context: { slot: ledger.slot }, value: { err: null } },
              subscription: sub.subscriptionId,
            },
          }));
        } catch {
          // Ignore send errors
        }
        toRemove.push(i);
      }
    }
    for (let i = toRemove.length - 1; i >= 0; i--) {
      signatureSubscriptions.splice(toRemove[i], 1);
    }
  }

  function setupWss(wss: WebSocketServer) {
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          const { jsonrpc, id, method, params } = msg;

          if (jsonrpc !== '2.0' || !method) {
            ws.send(JSON.stringify(rpcErr(null, -32600, 'Invalid request')));
            return;
          }

          if (method === 'signatureSubscribe') {
            const signature = params[0];
            wsSubscriptionId++;
            const subId = wsSubscriptionId;

            signatureSubscriptions.push({ ws, subscriptionId: subId, signature });
            ws.send(JSON.stringify({ jsonrpc: '2.0', result: subId, id }));

            if (ledger.signatures.has(signature)) {
              setTimeout(() => {
                try {
                  ws.send(JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'signatureNotification',
                    params: {
                      result: { context: { slot: ledger.slot }, value: { err: null } },
                      subscription: subId,
                    },
                  }));
                } catch {
                  // Ignore send errors
                }
              }, 10);
            }
          } else if (method === 'signatureUnsubscribe') {
            const subId = params[0];
            const idx = signatureSubscriptions.findIndex(s => s.subscriptionId === subId);
            if (idx >= 0) signatureSubscriptions.splice(idx, 1);
            ws.send(JSON.stringify({ jsonrpc: '2.0', result: true, id }));
          } else {
            ws.send(JSON.stringify(rpcErr(id, -32601, 'Method not found')));
          }
        } catch {
          ws.send(JSON.stringify(rpcErr(null, -32600, 'Invalid request')));
        }
      });
    });
  }

  function rpcErr(id: any, code: number, message: string) {
    return { jsonrpc: '2.0', id, error: { code, message } };
  }

  return { notifySignatureSubscribers, setupWss };
}

