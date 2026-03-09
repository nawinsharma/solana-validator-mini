import { PublicKey } from '@solana/web3.js';

const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';

export interface AccountData {
  lamports: number;
  owner: string;
  data: Buffer;
  executable: boolean;
}

export class AccountStore {
  private accounts: Map<string, AccountData> = new Map();

  get(pubkey: string): AccountData | null {
    return this.accounts.get(pubkey) ?? null;
  }

  set(pubkey: string, account: AccountData): void {
    this.accounts.set(pubkey, account);
  }

  delete(pubkey: string): void {
    this.accounts.delete(pubkey);
  }

  getOrDefault(pubkey: string): AccountData {
    return this.accounts.get(pubkey) ?? {
      lamports: 0,
      owner: SYSTEM_PROGRAM_ID,
      data: Buffer.alloc(0),
      executable: false,
    };
  }

  exists(pubkey: string): boolean {
    const acc = this.accounts.get(pubkey);
    if (!acc) return false;
    return acc.lamports > 0 || acc.data.length > 0;
  }

  getAllTokenAccountsByOwnerAndMint(ownerPubkey: string, mintPubkey: string, tokenProgramId: string): Array<{ pubkey: string; account: AccountData }> {
    const results: Array<{ pubkey: string; account: AccountData }> = [];
    for (const [pubkey, account] of this.accounts.entries()) {
      if (account.owner !== tokenProgramId) continue;
      if (account.data.length < 165) continue;
      const mint = new PublicKey(account.data.subarray(0, 32)).toBase58();
      const owner = new PublicKey(account.data.subarray(32, 64)).toBase58();
      if (owner === ownerPubkey && mint === mintPubkey) {
        results.push({ pubkey, account });
      }
    }
    return results;
  }

  getAllTokenAccountsByOwnerAndProgram(ownerPubkey: string, programId: string): Array<{ pubkey: string; account: AccountData }> {
    const results: Array<{ pubkey: string; account: AccountData }> = [];
    for (const [pubkey, account] of this.accounts.entries()) {
      if (account.owner !== programId) continue;
      if (account.data.length < 165) continue;
      const owner = new PublicKey(account.data.subarray(32, 64)).toBase58();
      if (owner === ownerPubkey) {
        results.push({ pubkey, account });
      }
    }
    return results;
  }
}
