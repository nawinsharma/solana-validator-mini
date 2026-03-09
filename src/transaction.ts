import { Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Ledger } from './ledger.js';
import { executeSystemInstruction, SYSTEM_PROGRAM_ID } from './programs/system.js';
import { executeTokenInstruction, TOKEN_PROGRAM_ID } from './programs/token.js';
import { executeAtaInstruction, ATA_PROGRAM_ID } from './programs/ata.js';

export function processTransaction(
  base64Tx: string,
  ledger: Ledger,
): string {
  const txBytes = Buffer.from(base64Tx, 'base64');
  const tx = Transaction.from(txBytes);

  const message = tx.compileMessage();
  const messageBytes = message.serialize();

  const recentBlockhash = message.recentBlockhash;
  if (!ledger.blockhashes.has(recentBlockhash)) {
    throw new Error('Blockhash not found — use getLatestBlockhash first');
  }

  const numRequired = message.header.numRequiredSignatures;
  const accountKeys = message.accountKeys.map(k => k.toBase58());

  if (tx.signatures.length < numRequired) {
    throw new Error('Missing required signatures');
  }

  const signers = new Set<string>();
  for (let i = 0; i < numRequired; i++) {
    const sig = tx.signatures[i];
    if (!sig || !sig.signature) {
      throw new Error(`Missing signature for account ${i}`);
    }

    const sigBytes = sig.signature;
    if (sigBytes.length !== 64) {
      throw new Error(`Invalid signature length for account ${i}`);
    }

    const allZero = sigBytes.every(b => b === 0);
    if (allZero) {
      throw new Error(`Signature is all zeros for account ${i}`);
    }

    const pubkeyBytes = sig.publicKey.toBuffer();
    const valid = nacl.sign.detached.verify(
      messageBytes,
      sigBytes,
      pubkeyBytes,
    );

    if (!valid) {
      throw new Error(`Invalid signature for account ${accountKeys[i]}`);
    }

    signers.add(sig.publicKey.toBase58());
  }

  for (const ix of tx.instructions) {
    const programId = ix.programId.toBase58();
    const ixAccountKeys = ix.keys.map(k => k.pubkey.toBase58());
    const ixData = ix.data;

    for (const k of ix.keys) {
      if (k.isSigner) {
        signers.add(k.pubkey.toBase58());
      }
    }

    switch (programId) {
      case SYSTEM_PROGRAM_ID:
        executeSystemInstruction(ixData, ixAccountKeys, signers, ledger.store);
        break;
      case TOKEN_PROGRAM_ID:
        executeTokenInstruction(ixData, ixAccountKeys, signers, ledger.store);
        break;
      case ATA_PROGRAM_ID:
        executeAtaInstruction(ixData, ixAccountKeys, signers, ledger.store);
        break;
      default:
        throw new Error(`Unknown program: ${programId}`);
    }
  }

  ledger.slot += 1;
  ledger.blockHeight += 1;

  const sigStr = bs58.encode(tx.signatures[0].signature!);
  ledger.signatures.set(sigStr, { slot: ledger.slot });

  return sigStr;
}
