// @vitest-environment node

import { describe, expect, it } from "vitest";
import { Keypair, SendTransactionError, SystemProgram, Transaction, TransactionInstruction, type Connection } from "@solana/web3.js";
import { hasExternalPresignature, prepareTransactionForWalletSend, transactionErrorMessage } from "./useSolanaWallet";

describe("wallet transaction preparation", () => {
  it("preserves a sponsor-presigned transaction message and signature", () => {
    const sponsor = Keypair.generate();
    const wallet = Keypair.generate().publicKey;
    const transaction = new Transaction();
    transaction.feePayer = sponsor.publicKey;
    transaction.recentBlockhash = Keypair.generate().publicKey.toBase58();
    transaction.lastValidBlockHeight = 222;
    transaction.add(new TransactionInstruction({
      programId: SystemProgram.programId,
      keys: [
        { pubkey: wallet, isSigner: true, isWritable: true },
        { pubkey: sponsor.publicKey, isSigner: true, isWritable: true },
      ],
      data: Buffer.alloc(0),
    }));
    transaction.partialSign(sponsor);

    const prepared = prepareTransactionForWalletSend(transaction, wallet, {
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 999,
    });

    expect(hasExternalPresignature(transaction, wallet)).toBe(true);
    expect(prepared.preservesExternalSignature).toBe(true);
    expect(prepared.transaction).toBe(transaction);
    expect(prepared.latestBlockhash).toEqual({
      blockhash: transaction.recentBlockhash,
      lastValidBlockHeight: 222,
    });
    const sponsorSignature = prepared.transaction.signatures.find((signature) =>
      signature.publicKey.equals(sponsor.publicKey)
    );
    expect(sponsorSignature?.signature).not.toBeNull();
  });

  it("clones ordinary wallet transactions with a fresh blockhash", () => {
    const wallet = Keypair.generate().publicKey;
    const recipient = Keypair.generate().publicKey;
    const transaction = new Transaction().add(SystemProgram.transfer({
      fromPubkey: wallet,
      toPubkey: recipient,
      lamports: 1,
    }));
    const blockhash = Keypair.generate().publicKey.toBase58();

    const prepared = prepareTransactionForWalletSend(transaction, wallet, {
      blockhash,
      lastValidBlockHeight: 777,
    });

    expect(prepared.preservesExternalSignature).toBe(false);
    expect(prepared.transaction).not.toBe(transaction);
    expect(prepared.transaction.feePayer?.equals(wallet)).toBe(true);
    expect(prepared.transaction.recentBlockhash).toBe(blockhash);
    expect(prepared.transaction.lastValidBlockHeight).toBe(777);
  });

  it("explains Anchor instruction fallback instead of showing raw simulation boilerplate", async () => {
    const err = new SendTransactionError({
      action: "simulate",
      signature: "",
      transactionMessage: "Transaction simulation failed: Error processing Instruction 0: custom program error: 0x65",
      logs: [
        "Program log: AnchorError occurred. Error Code: InstructionFallbackNotFound. Error Number: 101. Error Message: Fallback functions are not supported.",
      ],
    });

    await expect(transactionErrorMessage(err, {} as Connection)).resolves.toBe(
      "The wager escrow program on-chain does not recognize this sponsored wager instruction. Wagers need to be paused until the deployed escrow program is upgraded or the configured program id is corrected.",
    );
  });

  it("explains escrow funding failures instead of raw custom error 0x1", async () => {
    const err = new SendTransactionError({
      action: "simulate",
      signature: "",
      transactionMessage: "Transaction simulation failed: Error processing Instruction 5: custom program error: 0x1",
      logs: [
        "Program 11111111111111111111111111111111 invoke [2]",
        "Transfer: insufficient lamports 1000, need 2039280",
      ],
    });

    await expect(transactionErrorMessage(err, {} as Connection)).resolves.toBe(
      "Insufficient SOL on DEVNET for this wager. Check that your wallet is funded on the app's selected Solana network, then refresh balance or try a smaller stake.",
    );
  });

  it("does not call a generic custom program error 0x1 an SOL shortage", async () => {
    const err = new SendTransactionError({
      action: "simulate",
      signature: "",
      transactionMessage: "Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1",
      logs: [
        "Program ArenaEscrow111111111111111111111111111 invoke [1]",
        "Program ArenaEscrow111111111111111111111111111 failed: custom program error: 0x1",
      ],
    });

    const message = await transactionErrorMessage(err, {} as Connection);
    expect(message).toContain("custom program error: 0x1");
    expect(message).not.toContain("Insufficient SOL");
  });

  it("strips SendTransactionError getLogs guidance from generic failures", async () => {
    await expect(transactionErrorMessage(
      new Error("Simulation failed. \nMessage: Transaction simulation failed: account is missing. \nCatch the `SendTransactionError` and call `getLogs()` on it for full details."),
      {} as Connection,
    )).resolves.toBe("Transaction simulation failed: account is missing.");
  });
});
