import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { AccountStore } from './accounts.js';
import { processTransaction } from './transaction.js';
import { TOKEN_PROGRAM_ID } from './programs/token.js';
import { getRentExemptMinimum } from './programs/ata.js';
import { Ledger } from './ledger.js';

function ok(id: any, result: any) {
  return { jsonrpc: '2.0', id, result };
}

function rpcErr(id: any, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

export interface RpcDependencies {
  ledger: Ledger;
  store: AccountStore;
  notifySignatureSubscribers: (signature: string) => void;
}

export function createRpcHandler(deps: RpcDependencies) {
  const { ledger, store, notifySignatureSubscribers } = deps;
  let airdropCounter = 0;

  function generateBlockhash(): string {
    const bytes = nacl.randomBytes(32);
    return bs58.encode(bytes);
  }

  function handleRpc(body: any): any {
    const { jsonrpc, id, method, params } = body;

    if (jsonrpc !== '2.0' || !method) {
      return rpcErr(id ?? null, -32600, 'Invalid request');
    }

    try {
      switch (method) {
        case 'getVersion':
          return ok(id, { 'solana-core': '1.18.0', 'feature-set': 0 });

        case 'getSlot':
          return ok(id, ledger.slot);

        case 'getBlockHeight':
          return ok(id, ledger.blockHeight);

        case 'getHealth':
          return ok(id, 'ok');

        case 'getLatestBlockhash': {
          const bh = generateBlockhash();
          ledger.blockhashes.add(bh);
          return ok(id, {
            context: { slot: ledger.slot },
            value: {
              blockhash: bh,
              lastValidBlockHeight: ledger.blockHeight + 150,
            },
          });
        }

        case 'getBalance': {
          if (!params || !params[0]) return rpcErr(id, -32602, 'Invalid params');
          const pubkey = params[0];
          try { new PublicKey(pubkey); } catch { return rpcErr(id, -32602, 'Invalid pubkey'); }
          const account = store.get(pubkey);
          return ok(id, {
            context: { slot: ledger.slot },
            value: account ? account.lamports : 0,
          });
        }

        case 'getAccountInfo': {
          if (!params || !params[0]) return rpcErr(id, -32602, 'Invalid params');
          const pubkey = params[0];
          try { new PublicKey(pubkey); } catch { return rpcErr(id, -32602, 'Invalid pubkey'); }
          const account = store.get(pubkey);
          if (!account) {
            return ok(id, { context: { slot: ledger.slot }, value: null });
          }
          return ok(id, {
            context: { slot: ledger.slot },
            value: {
              data: [account.data.toString('base64'), 'base64'],
              executable: account.executable,
              lamports: account.lamports,
              owner: account.owner,
              rentEpoch: 0,
            },
          });
        }

        case 'getMinimumBalanceForRentExemption': {
          if (!params || typeof params[0] !== 'number') return rpcErr(id, -32602, 'Invalid params');
          const dataSize = params[0];
          return ok(id, getRentExemptMinimum(dataSize));
        }

        case 'getTokenAccountBalance': {
          if (!params || !params[0]) return rpcErr(id, -32602, 'Invalid params');
          const pubkey = params[0];
          try { new PublicKey(pubkey); } catch { return rpcErr(id, -32602, 'Invalid pubkey'); }
          const account = store.get(pubkey);
          if (!account || account.data.length < 165 || account.owner !== TOKEN_PROGRAM_ID) {
            return rpcErr(id, -32602, 'Not a token account');
          }

          const mintPubkey = new PublicKey(account.data.subarray(0, 32)).toBase58();
          const amount = account.data.readBigUInt64LE(64);

          let decimals = 0;
          const mintAccount = store.get(mintPubkey);
          if (mintAccount && mintAccount.data.length >= 82) {
            decimals = mintAccount.data[44];
          }

          const amountStr = amount.toString();
          const uiAmount = Number(amount) / Math.pow(10, decimals);

          return ok(id, {
            context: { slot: ledger.slot },
            value: {
              amount: amountStr,
              decimals,
              uiAmount,
            },
          });
        }

        case 'getTokenAccountsByOwner': {
          if (!params || !params[0] || !params[1]) return rpcErr(id, -32602, 'Invalid params');
          const ownerPubkey = params[0];
          try { new PublicKey(ownerPubkey); } catch { return rpcErr(id, -32602, 'Invalid pubkey'); }
          const filter = params[1];

          let results: Array<{ pubkey: string; account: any }>;

          if (filter.mint) {
            results = store.getAllTokenAccountsByOwnerAndMint(ownerPubkey, filter.mint, TOKEN_PROGRAM_ID);
          } else if (filter.programId) {
            results = store.getAllTokenAccountsByOwnerAndProgram(ownerPubkey, filter.programId);
          } else {
            return rpcErr(id, -32602, 'Invalid filter');
          }

          const value = results.map(r => ({
            pubkey: r.pubkey,
            account: {
              data: [r.account.data.toString('base64'), 'base64'],
              executable: r.account.executable,
              lamports: r.account.lamports,
              owner: r.account.owner,
              rentEpoch: 0,
            },
          }));

          return ok(id, { context: { slot: ledger.slot }, value });
        }

        case 'requestAirdrop': {
          if (!params || !params[0] || typeof params[1] !== 'number') {
            return rpcErr(id, -32602, 'Invalid params');
          }
          const pubkey = params[0];
          try { new PublicKey(pubkey); } catch { return rpcErr(id, -32602, 'Invalid pubkey'); }
          const lamports = params[1];

          const account = store.getOrDefault(pubkey);
          account.lamports += lamports;
          store.set(pubkey, account);

          ledger.slot += 1;
          ledger.blockHeight += 1;

          airdropCounter++;
          const fakeSig = bs58.encode(nacl.randomBytes(64));
          ledger.signatures.set(fakeSig, { slot: ledger.slot });
          return ok(id, fakeSig);
        }

        case 'sendTransaction': {
          if (!params || !params[0]) return rpcErr(id, -32602, 'Invalid params');
          const encodedTx = params[0];

          try {
            const sig = processTransaction(encodedTx, ledger);
            notifySignatureSubscribers(sig);
            return ok(id, sig);
          } catch (e: any) {
            return rpcErr(id, -32003, e.message || 'Transaction failed');
          }
        }

        case 'getSignatureStatuses': {
          if (!params || !Array.isArray(params[0])) {
            return rpcErr(id, -32602, 'Invalid params');
          }
          const sigs: string[] = params[0];
          const value = sigs.map(sig => {
            const info = ledger.signatures.get(sig);
            if (!info) return null;
            return {
              slot: info.slot,
              confirmations: null,
              err: null,
              confirmationStatus: 'confirmed',
            };
          });
          return ok(id, { context: { slot: ledger.slot }, value });
        }

        default:
          return rpcErr(id, -32601, 'Method not found');
      }
    } catch (e: any) {
      return rpcErr(id, -32603, e.message || 'Internal error');
    }
  }

  return { handleRpc };
}

