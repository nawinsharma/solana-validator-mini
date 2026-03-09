import { AccountStore } from './accounts.js';

export interface Ledger {
  store: AccountStore;
  slot: number;
  blockHeight: number;
  blockhashes: Set<string>;
  signatures: Map<string, { slot: number }>;
}

export function createLedger(store: AccountStore): Ledger {
  return {
    store,
    slot: 1,
    blockHeight: 1,
    blockhashes: new Set<string>(),
    signatures: new Map(),
  };
}

