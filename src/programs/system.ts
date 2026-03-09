import { PublicKey } from '@solana/web3.js';
import { AccountStore, AccountData } from '../accounts.js';

export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';

export function executeSystemInstruction(
  instructionData: Buffer,
  accountKeys: string[],
  signers: Set<string>,
  store: AccountStore,
): void {
  if (instructionData.length < 4) {
    throw new Error('System instruction too short');
  }

  const discriminator = instructionData.readUInt32LE(0);

  switch (discriminator) {
    case 0:
      return createAccount(instructionData, accountKeys, signers, store);
    case 2:
      return transfer(instructionData, accountKeys, signers, store);
    case 3:
      return assign(instructionData, accountKeys, signers, store);
    default:
      throw new Error(`Unknown system instruction: ${discriminator}`);
  }
}

function createAccount(
  data: Buffer,
  accountKeys: string[],
  signers: Set<string>,
  store: AccountStore,
): void {
  if (accountKeys.length < 2) throw new Error('CreateAccount requires 2 accounts');
  if (data.length < 4 + 8 + 8 + 32) throw new Error('CreateAccount data too short');

  const payer = accountKeys[0];
  const newAccount = accountKeys[1];

  if (!signers.has(payer)) throw new Error('Payer must be a signer');
  if (!signers.has(newAccount)) throw new Error('New account must be a signer');

  const lamports = Number(data.readBigUInt64LE(4));
  const space = Number(data.readBigUInt64LE(12));
  const owner = new PublicKey(data.subarray(20, 52)).toBase58();

  if (store.exists(newAccount)) {
    throw new Error('Account already exists');
  }

  const payerAccount = store.getOrDefault(payer);
  if (payerAccount.lamports < lamports) {
    throw new Error('Insufficient funds for CreateAccount');
  }

  payerAccount.lamports -= lamports;
  store.set(payer, payerAccount);

  store.set(newAccount, {
    lamports,
    owner,
    data: Buffer.alloc(space),
    executable: false,
  });
}

function transfer(
  data: Buffer,
  accountKeys: string[],
  signers: Set<string>,
  store: AccountStore,
): void {
  if (accountKeys.length < 2) throw new Error('Transfer requires 2 accounts');
  if (data.length < 4 + 8) throw new Error('Transfer data too short');

  const from = accountKeys[0];
  const to = accountKeys[1];

  if (!signers.has(from)) throw new Error('Source must be a signer');

  const lamports = Number(data.readBigUInt64LE(4));

  const fromAccount = store.getOrDefault(from);
  if (fromAccount.lamports < lamports) {
    throw new Error('Insufficient funds for transfer');
  }

  const toAccount = store.getOrDefault(to);

  fromAccount.lamports -= lamports;
  toAccount.lamports += lamports;

  store.set(from, fromAccount);
  store.set(to, toAccount);
}

function assign(
  data: Buffer,
  accountKeys: string[],
  signers: Set<string>,
  store: AccountStore,
): void {
  if (accountKeys.length < 1) throw new Error('Assign requires 1 account');
  if (data.length < 4 + 32) throw new Error('Assign data too short');

  const account = accountKeys[0];
  if (!signers.has(account)) throw new Error('Account must be a signer');

  const owner = new PublicKey(data.subarray(4, 36)).toBase58();
  const acc = store.getOrDefault(account);
  acc.owner = owner;
  store.set(account, acc);
}
