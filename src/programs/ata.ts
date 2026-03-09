import { PublicKey } from '@solana/web3.js';
import { AccountStore } from '../accounts.js';
import { TOKEN_PROGRAM_ID } from './token.js';

export const ATA_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

const TOKEN_ACCOUNT_SIZE = 165;

export function executeAtaInstruction(
  instructionData: Buffer,
  accountKeys: string[],
  signers: Set<string>,
  store: AccountStore,
): void {
  if (accountKeys.length < 6) throw new Error('ATA Create requires 6 accounts');

  const payer = accountKeys[0];
  const ata = accountKeys[1];
  const owner = accountKeys[2];
  const mint = accountKeys[3];

  if (!signers.has(payer)) throw new Error('Payer must be a signer');

  const [derivedAta] = PublicKey.findProgramAddressSync(
    [
      new PublicKey(owner).toBuffer(),
      new PublicKey(TOKEN_PROGRAM_ID).toBuffer(),
      new PublicKey(mint).toBuffer(),
    ],
    new PublicKey(ATA_PROGRAM_ID),
  );

  if (derivedAta.toBase58() !== ata) {
    throw new Error('Derived ATA address does not match provided account');
  }

  if (store.exists(ata)) {
    throw new Error('Associated token account already exists');
  }

  const rentExempt = getRentExemptMinimum(TOKEN_ACCOUNT_SIZE);
  const payerAccount = store.getOrDefault(payer);
  if (payerAccount.lamports < rentExempt) {
    throw new Error('Insufficient funds for ATA creation');
  }

  payerAccount.lamports -= rentExempt;
  store.set(payer, payerAccount);

  const tokenData = Buffer.alloc(TOKEN_ACCOUNT_SIZE);
  new PublicKey(mint).toBuffer().copy(tokenData, 0);
  new PublicKey(owner).toBuffer().copy(tokenData, 32);
  tokenData.writeBigUInt64LE(0n, 64);
  tokenData[108] = 1; // state = initialized

  store.set(ata, {
    lamports: rentExempt,
    owner: TOKEN_PROGRAM_ID,
    data: tokenData,
    executable: false,
  });
}

export function getRentExemptMinimum(dataSize: number): number {
  return (dataSize + 128) * 2;
}
