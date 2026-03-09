import { PublicKey } from '@solana/web3.js';
import { AccountStore } from '../accounts.js';

export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

const MINT_SIZE = 82;
const TOKEN_ACCOUNT_SIZE = 165;

export function executeTokenInstruction(
  instructionData: Buffer,
  accountKeys: string[],
  signers: Set<string>,
  store: AccountStore,
): void {
  if (instructionData.length < 1) throw new Error('Token instruction too short');

  const discriminator = instructionData[0];

  switch (discriminator) {
    case 3:
      return tokenTransfer(instructionData, accountKeys, signers, store);
    case 7:
      return mintTo(instructionData, accountKeys, signers, store);
    case 8:
      return burn(instructionData, accountKeys, signers, store);
    case 9:
      return closeAccount(accountKeys, signers, store);
    case 12:
      return transferChecked(instructionData, accountKeys, signers, store);
    case 18:
      return initializeAccount3(instructionData, accountKeys, store);
    case 20:
      return initializeMint2(instructionData, accountKeys, store);
    default:
      throw new Error(`Unknown token instruction: ${discriminator}`);
  }
}

function initializeMint2(
  data: Buffer,
  accountKeys: string[],
  store: AccountStore,
): void {
  if (accountKeys.length < 1) throw new Error('InitializeMint2 requires 1 account');
  if (data.length < 1 + 1 + 32 + 1) throw new Error('InitializeMint2 data too short');

  const mintPubkey = accountKeys[0];
  const mintAccount = store.getOrDefault(mintPubkey);

  if (mintAccount.data.length >= MINT_SIZE) {
    const isInitialized = mintAccount.data[45];
    if (isInitialized === 1) throw new Error('Mint already initialized');
  }

  const decimals = data[1];
  const mintAuthority = data.subarray(2, 34);
  const hasFreezeAuth = data[34];

  const mintData = Buffer.alloc(MINT_SIZE);

  // mintAuthorityOption = 1 (Some)
  mintData.writeUInt32LE(1, 0);
  mintAuthority.copy(mintData, 4);

  // supply = 0
  mintData.writeBigUInt64LE(0n, 36);

  // decimals
  mintData[44] = decimals;

  // isInitialized = 1
  mintData[45] = 1;

  if (hasFreezeAuth && data.length >= 1 + 1 + 32 + 1 + 32) {
    mintData.writeUInt32LE(1, 46);
    data.subarray(35, 67).copy(mintData, 50);
  } else {
    mintData.writeUInt32LE(0, 46);
  }

  mintAccount.data = mintData;
  mintAccount.owner = TOKEN_PROGRAM_ID;
  store.set(mintPubkey, mintAccount);
}

function initializeAccount3(
  data: Buffer,
  accountKeys: string[],
  store: AccountStore,
): void {
  if (accountKeys.length < 2) throw new Error('InitializeAccount3 requires 2 accounts');
  if (data.length < 1 + 32) throw new Error('InitializeAccount3 data too short');

  const tokenAccountPubkey = accountKeys[0];
  const mintPubkey = accountKeys[1];
  const ownerPubkey = data.subarray(1, 33);

  const tokenAccount = store.getOrDefault(tokenAccountPubkey);

  const tokenData = Buffer.alloc(TOKEN_ACCOUNT_SIZE);

  // mint
  new PublicKey(mintPubkey).toBuffer().copy(tokenData, 0);
  // owner
  ownerPubkey.copy(tokenData, 32);
  // amount = 0
  tokenData.writeBigUInt64LE(0n, 64);
  // delegate option = None (4 bytes 0 + 32 bytes)
  // state = initialized (1)
  tokenData[108] = 1;
  // isNative option = None
  // delegatedAmount = 0
  // closeAuthority option = None

  tokenAccount.data = tokenData;
  tokenAccount.owner = TOKEN_PROGRAM_ID;
  store.set(tokenAccountPubkey, tokenAccount);
}

function mintTo(
  data: Buffer,
  accountKeys: string[],
  signers: Set<string>,
  store: AccountStore,
): void {
  if (accountKeys.length < 3) throw new Error('MintTo requires 3 accounts');
  if (data.length < 1 + 8) throw new Error('MintTo data too short');

  const mintPubkey = accountKeys[0];
  const destPubkey = accountKeys[1];
  const authorityPubkey = accountKeys[2];

  if (!signers.has(authorityPubkey)) throw new Error('Mint authority must be a signer');

  const amount = data.readBigUInt64LE(1);

  const mintAccount = store.get(mintPubkey);
  if (!mintAccount || mintAccount.data.length < MINT_SIZE) {
    throw new Error('Invalid mint account');
  }
  if (mintAccount.data[45] !== 1) throw new Error('Mint not initialized');

  const mintAuthOption = mintAccount.data.readUInt32LE(0);
  if (mintAuthOption !== 1) throw new Error('Mint has no authority');
  const mintAuthority = new PublicKey(mintAccount.data.subarray(4, 36)).toBase58();
  if (mintAuthority !== authorityPubkey) throw new Error('Invalid mint authority');

  const destAccount = store.get(destPubkey);
  if (!destAccount || destAccount.data.length < TOKEN_ACCOUNT_SIZE) {
    throw new Error('Invalid destination token account');
  }

  const currentAmount = destAccount.data.readBigUInt64LE(64);
  destAccount.data.writeBigUInt64LE(currentAmount + amount, 64);
  store.set(destPubkey, destAccount);

  const currentSupply = mintAccount.data.readBigUInt64LE(36);
  mintAccount.data.writeBigUInt64LE(currentSupply + amount, 36);
  store.set(mintPubkey, mintAccount);
}

function tokenTransfer(
  data: Buffer,
  accountKeys: string[],
  signers: Set<string>,
  store: AccountStore,
): void {
  if (accountKeys.length < 3) throw new Error('Transfer requires 3 accounts');
  if (data.length < 1 + 8) throw new Error('Transfer data too short');

  const sourcePubkey = accountKeys[0];
  const destPubkey = accountKeys[1];
  const ownerPubkey = accountKeys[2];

  if (!signers.has(ownerPubkey)) throw new Error('Owner must be a signer');

  const amount = data.readBigUInt64LE(1);

  const sourceAccount = store.get(sourcePubkey);
  if (!sourceAccount || sourceAccount.data.length < TOKEN_ACCOUNT_SIZE) {
    throw new Error('Invalid source token account');
  }

  const sourceOwner = new PublicKey(sourceAccount.data.subarray(32, 64)).toBase58();
  if (sourceOwner !== ownerPubkey) throw new Error('Source owner mismatch');

  const sourceBalance = sourceAccount.data.readBigUInt64LE(64);
  if (sourceBalance < amount) throw new Error('Insufficient token balance');

  const destAccount = store.get(destPubkey);
  if (!destAccount || destAccount.data.length < TOKEN_ACCOUNT_SIZE) {
    throw new Error('Invalid destination token account');
  }

  sourceAccount.data.writeBigUInt64LE(sourceBalance - amount, 64);
  store.set(sourcePubkey, sourceAccount);

  const destBalance = destAccount.data.readBigUInt64LE(64);
  destAccount.data.writeBigUInt64LE(destBalance + amount, 64);
  store.set(destPubkey, destAccount);
}

function transferChecked(
  data: Buffer,
  accountKeys: string[],
  signers: Set<string>,
  store: AccountStore,
): void {
  if (accountKeys.length < 4) throw new Error('TransferChecked requires 4 accounts');
  if (data.length < 1 + 8 + 1) throw new Error('TransferChecked data too short');

  const sourcePubkey = accountKeys[0];
  const mintPubkey = accountKeys[1];
  const destPubkey = accountKeys[2];
  const ownerPubkey = accountKeys[3];

  if (!signers.has(ownerPubkey)) throw new Error('Owner must be a signer');

  const amount = data.readBigUInt64LE(1);
  const decimals = data[9];

  const mintAccount = store.get(mintPubkey);
  if (!mintAccount || mintAccount.data.length < MINT_SIZE) {
    throw new Error('Invalid mint account');
  }
  if (mintAccount.data[44] !== decimals) {
    throw new Error('Decimals mismatch');
  }

  const sourceAccount = store.get(sourcePubkey);
  if (!sourceAccount || sourceAccount.data.length < TOKEN_ACCOUNT_SIZE) {
    throw new Error('Invalid source token account');
  }

  const sourceOwner = new PublicKey(sourceAccount.data.subarray(32, 64)).toBase58();
  if (sourceOwner !== ownerPubkey) throw new Error('Source owner mismatch');

  const sourceBalance = sourceAccount.data.readBigUInt64LE(64);
  if (sourceBalance < amount) throw new Error('Insufficient token balance');

  const destAccount = store.get(destPubkey);
  if (!destAccount || destAccount.data.length < TOKEN_ACCOUNT_SIZE) {
    throw new Error('Invalid destination token account');
  }

  sourceAccount.data.writeBigUInt64LE(sourceBalance - amount, 64);
  store.set(sourcePubkey, sourceAccount);

  const destBalance = destAccount.data.readBigUInt64LE(64);
  destAccount.data.writeBigUInt64LE(destBalance + amount, 64);
  store.set(destPubkey, destAccount);
}

function burn(
  data: Buffer,
  accountKeys: string[],
  signers: Set<string>,
  store: AccountStore,
): void {
  if (accountKeys.length < 3) throw new Error('Burn requires 3 accounts');
  if (data.length < 1 + 8) throw new Error('Burn data too short');

  const tokenAccountPubkey = accountKeys[0];
  const mintPubkey = accountKeys[1];
  const ownerPubkey = accountKeys[2];

  if (!signers.has(ownerPubkey)) throw new Error('Owner must be a signer');

  const amount = data.readBigUInt64LE(1);

  const tokenAccount = store.get(tokenAccountPubkey);
  if (!tokenAccount || tokenAccount.data.length < TOKEN_ACCOUNT_SIZE) {
    throw new Error('Invalid token account');
  }

  const tokenOwner = new PublicKey(tokenAccount.data.subarray(32, 64)).toBase58();
  if (tokenOwner !== ownerPubkey) throw new Error('Token account owner mismatch');

  const balance = tokenAccount.data.readBigUInt64LE(64);
  if (balance < amount) throw new Error('Insufficient token balance for burn');

  tokenAccount.data.writeBigUInt64LE(balance - amount, 64);
  store.set(tokenAccountPubkey, tokenAccount);

  const mintAccount = store.get(mintPubkey);
  if (!mintAccount || mintAccount.data.length < MINT_SIZE) {
    throw new Error('Invalid mint account');
  }

  const supply = mintAccount.data.readBigUInt64LE(36);
  mintAccount.data.writeBigUInt64LE(supply - amount, 36);
  store.set(mintPubkey, mintAccount);
}

function closeAccount(
  accountKeys: string[],
  signers: Set<string>,
  store: AccountStore,
): void {
  if (accountKeys.length < 3) throw new Error('CloseAccount requires 3 accounts');

  const accountPubkey = accountKeys[0];
  const destPubkey = accountKeys[1];
  const ownerPubkey = accountKeys[2];

  if (!signers.has(ownerPubkey)) throw new Error('Owner must be a signer');

  const account = store.get(accountPubkey);
  if (!account) throw new Error('Account not found');

  if (account.data.length >= TOKEN_ACCOUNT_SIZE) {
    const balance = account.data.readBigUInt64LE(64);
    if (balance > 0n) throw new Error('Token account balance must be 0 to close');

    const tokenOwner = new PublicKey(account.data.subarray(32, 64)).toBase58();
    if (tokenOwner !== ownerPubkey) throw new Error('Token account owner mismatch');
  }

  const destAccount = store.getOrDefault(destPubkey);
  destAccount.lamports += account.lamports;
  store.set(destPubkey, destAccount);

  store.delete(accountPubkey);
}
