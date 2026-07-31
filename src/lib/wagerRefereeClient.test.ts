// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "@noble/hashes/sha256";
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import type { EscrowInstructionFactory } from "@/lib/solanaWagerTransactions";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: invokeMock,
    },
  },
}));

import { assertSponsoredWagerTransactionSafe, prepareWagerQueue, enterWagerQueue, enterWagerLobbyHost } from "@/lib/wagerRefereeClient";
import { RefereeClientError } from "@/lib/refereeErrors";
import { clearStoredPvpSession, ensurePvpSession } from "@/lib/pvpSession";

const escrow: EscrowInstructionFactory = {
  reclaimContestRent: () => new TransactionInstruction({ keys: [], programId: SystemProgram.programId, data: Buffer.alloc(0) }),
  createContest: () => new TransactionInstruction({ keys: [], programId: SystemProgram.programId, data: Buffer.alloc(0) }),
  joinContest: () => new TransactionInstruction({ keys: [], programId: SystemProgram.programId, data: Buffer.alloc(0) }),
  cancelContest: () => new TransactionInstruction({ keys: [], programId: SystemProgram.programId, data: Buffer.alloc(0) }),
  refundExpiredContest: () => new TransactionInstruction({ keys: [], programId: SystemProgram.programId, data: Buffer.alloc(0) }),
  settleContest: () => new TransactionInstruction({ keys: [], programId: SystemProgram.programId, data: Buffer.alloc(0) }),
};

function seed(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function seedHash(value: string): Uint8Array {
  return sha256(seed(value));
}

function discriminator(name: string): Buffer {
  return Buffer.from(sha256(seed(`global:${name}`))).subarray(0, 8);
}

function u32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value, 0);
  return out;
}

function u64(value: bigint): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value, 0);
  return out;
}

function i64(value: bigint): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigInt64LE(value, 0);
  return out;
}

function anchorString(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([u32(bytes.length), bytes]);
}

function nativeAccounts(programId: PublicKey, gameId: string, contestId: string) {
  const globalConfig = PublicKey.findProgramAddressSync([seed("global_config")], programId)[0];
  const gameConfig = PublicKey.findProgramAddressSync([seed("game"), seedHash(gameId)], programId)[0];
  const nativeContest = PublicKey.findProgramAddressSync(
    [seed("native_contest"), gameConfig.toBytes(), seedHash(contestId)],
    programId,
  )[0];
  return { globalConfig, gameConfig, nativeContest };
}

function sponsoredWhiteDepositTransaction(args: {
  programId: PublicKey;
  sponsor: Keypair;
  wallet: PublicKey;
  gameId: string;
  contestId: string;
  stakeLamports: bigint;
  rulesHash: string;
}) {
  const accounts = nativeAccounts(args.programId, args.gameId, args.contestId);
  const transaction = new Transaction();
  transaction.feePayer = args.sponsor.publicKey;
  transaction.recentBlockhash = Keypair.generate().publicKey.toBase58();
  transaction.add(new TransactionInstruction({
    programId: args.programId,
    keys: [
      { pubkey: accounts.globalConfig, isSigner: false, isWritable: false },
      { pubkey: accounts.gameConfig, isSigner: false, isWritable: false },
      { pubkey: accounts.nativeContest, isSigner: false, isWritable: true },
      { pubkey: args.wallet, isSigner: true, isWritable: true },
      { pubkey: args.sponsor.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      discriminator("create_native_contest"),
      anchorString(args.contestId),
      u64(args.stakeLamports),
      anchorString(args.rulesHash),
      i64(BigInt(Math.floor(Date.now() / 1000) + 600)),
    ]),
  }));
  transaction.partialSign(args.sponsor);
  return transaction;
}

function sessionResponse(sessionId = "session-a") {
  return {
    data: {
      sessionId,
      sessionProof: `${sessionId}-proof`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      riskLevel: "low",
      captchaRequired: false,
      walletProofRequired: false,
    },
    error: null,
  };
}

describe("wager referee client", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    clearStoredPvpSession();
  });

  it("accepts only the expected sponsored native deposit transaction before wallet signing", () => {
    const programId = Keypair.generate().publicKey;
    const sponsor = Keypair.generate();
    const wallet = Keypair.generate().publicKey;
    const transaction = sponsoredWhiteDepositTransaction({
      programId,
      sponsor,
      wallet,
      gameId: "chess-arena",
      contestId: "contest-a",
      stakeLamports: 50_000_000n,
      rulesHash: "chess-arena-v1",
    });

    expect(() => assertSponsoredWagerTransactionSafe(transaction, {
      action: "white_deposit",
      contestId: "contest-a",
      stakeLamports: 50_000_000n,
      walletAddress: wallet.toBase58(),
      rentSponsorAddress: sponsor.publicKey.toBase58(),
      rentRecipientAddress: sponsor.publicKey.toBase58(),
      escrowProgramId: programId.toBase58(),
      gameId: "chess-arena",
      rulesHash: "chess-arena-v1",
    })).not.toThrow();
  });

  it("rejects tampered sponsored native transactions before wallet signing", () => {
    const programId = Keypair.generate().publicKey;
    const sponsor = Keypair.generate();
    const wallet = Keypair.generate().publicKey;
    const transaction = sponsoredWhiteDepositTransaction({
      programId,
      sponsor,
      wallet,
      gameId: "chess-arena",
      contestId: "contest-a",
      stakeLamports: 50_000_000n,
      rulesHash: "chess-arena-v1",
    });
    transaction.add(new TransactionInstruction({
      programId: SystemProgram.programId,
      keys: [{ pubkey: wallet, isSigner: true, isWritable: true }],
      data: Buffer.alloc(0),
    }));

    expect(() => assertSponsoredWagerTransactionSafe(transaction, {
      action: "white_deposit",
      contestId: "contest-a",
      stakeLamports: 50_000_000n,
      walletAddress: wallet.toBase58(),
      rentSponsorAddress: sponsor.publicKey.toBase58(),
      rentRecipientAddress: sponsor.publicKey.toBase58(),
      escrowProgramId: programId.toBase58(),
      gameId: "chess-arena",
      rulesHash: "chess-arena-v1",
    })).toThrow("exactly one escrow instruction");
  });

  it("does not confirm a deposit when the wallet rejects signing", async () => {
    const walletPublicKey = Keypair.generate().publicKey;
    invokeMock
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce({
        data: {
          walletProof: {
            message: "Chess Arena PvP\nAction: prepare_wager_queue",
            nonce: "nonce-a",
            expiresAt: "2026-06-17T03:00:00.000Z",
          },
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          gameId: "game-a",
          playerToken: "token-a",
          color: "w",
          depositRole: "white",
          contestId: "contest-a",
          stakeLamports: "50000000",
          assetMint: "So11111111111111111111111111111111111111112",
        },
        error: null,
      });

    await expect(enterWagerQueue({
      sessionId: "session-a",
      walletPublicKey,
      walletAddress: walletPublicKey.toBase58(),
      assetMint: "So11111111111111111111111111111111111111112",
      tokenProgramId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      stakeLamports: 50_000_000n,
      paymentMode: "wsol_escrow",
      escrow,
      signMessage: vi.fn().mockResolvedValue(new Uint8Array(64).fill(7)),
      signAndSendTransaction: vi.fn().mockRejectedValue(new Error("User rejected")),
    })).rejects.toThrow("User rejected");

    expect(invokeMock).toHaveBeenCalledTimes(3);
    expect(invokeMock.mock.calls[0][1].body.action).toBe("init_session");
    expect(invokeMock.mock.calls[1][1].body.action).toBe("create_wallet_proof_challenge");
    expect(invokeMock.mock.calls[1][1].body.sessionProof).toBe("session-a-proof");
    expect(invokeMock.mock.calls[2][1].body.action).toBe("prepare_wager_queue");
    expect(invokeMock.mock.calls[2][1].body.walletProofNonce).toBe("nonce-a");
  });

  it("confirms the matching deposit only after a wallet signature", async () => {
    const walletPublicKey = Keypair.generate().publicKey;
    invokeMock
      .mockResolvedValueOnce(sessionResponse("session-b"))
      .mockResolvedValueOnce({
        data: {
          walletProof: {
            message: "Chess Arena PvP\nAction: prepare_wager_queue",
            nonce: "nonce-a",
            expiresAt: "2026-06-17T03:00:00.000Z",
          },
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          gameId: "game-a",
          playerToken: "token-a",
          color: "b",
          depositRole: "black",
          contestId: "contest-a",
          stakeLamports: "50000000",
          assetMint: "So11111111111111111111111111111111111111112",
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { ok: true, gameId: "game-a", status: "matched" },
        error: null,
      });

    const response = await enterWagerQueue({
      sessionId: "session-b",
      walletPublicKey,
      walletAddress: walletPublicKey.toBase58(),
      assetMint: "So11111111111111111111111111111111111111112",
      tokenProgramId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      stakeLamports: 50_000_000n,
      paymentMode: "wsol_escrow",
      escrow,
      signMessage: vi.fn().mockResolvedValue(new Uint8Array(64).fill(9)),
      signAndSendTransaction: vi.fn().mockResolvedValue("signature-a"),
    });

    expect(response.gameId).toBe("game-a");
    expect(invokeMock).toHaveBeenCalledTimes(4);
    expect(invokeMock.mock.calls[0][1].body.action).toBe("init_session");
    expect(invokeMock.mock.calls[1][1].body.action).toBe("create_wallet_proof_challenge");
    expect(invokeMock.mock.calls[2][1].body.action).toBe("prepare_wager_queue");
    expect(invokeMock.mock.calls[2][1].body.walletProofNonce).toBe("nonce-a");
    expect(invokeMock.mock.calls[3][1].body.action).toBe("confirm_black_deposit");
    expect(invokeMock.mock.calls[3][1].body.transactionSignature).toBe("signature-a");
    expect(invokeMock.mock.calls[3][1].body.stakeRaw).toBe("50000000");
    expect(invokeMock.mock.calls[3][1].body.escrowContestId).toBe("contest-a");
  });

  it("prepares wager lobby hosts without entering quick matchmaking", async () => {
    const walletPublicKey = Keypair.generate().publicKey;
    invokeMock
      .mockResolvedValueOnce(sessionResponse("session-host"))
      .mockResolvedValueOnce({
        data: {
          walletProof: {
            message: "Chess Arena PvP\nAction: prepare_wager_lobby",
            nonce: "nonce-host",
            expiresAt: "2026-06-17T03:00:00.000Z",
          },
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          gameId: "game-host",
          playerToken: "token-host",
          color: "w",
          depositRole: "white",
          contestId: "contest-host",
          stakeLamports: "50000000",
          assetMint: "So11111111111111111111111111111111111111112",
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { ok: true, gameId: "game-host", status: "queued" },
        error: null,
      });

    const response = await enterWagerLobbyHost({
      sessionId: "session-host",
      walletPublicKey,
      walletAddress: walletPublicKey.toBase58(),
      assetMint: "So11111111111111111111111111111111111111112",
      tokenProgramId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      stakeLamports: 50_000_000n,
      paymentMode: "wsol_escrow",
      escrow,
      signMessage: vi.fn().mockResolvedValue(new Uint8Array(64).fill(4)),
      signAndSendTransaction: vi.fn().mockResolvedValue("signature-host"),
    });

    expect(response.gameId).toBe("game-host");
    expect(invokeMock).toHaveBeenCalledTimes(4);
    expect(invokeMock.mock.calls[1][1].body.action).toBe("create_wallet_proof_challenge");
    expect(invokeMock.mock.calls[1][1].body.proofAction).toBe("prepare_wager_lobby");
    expect(invokeMock.mock.calls[2][1].body.action).toBe("prepare_wager_lobby");
    expect(invokeMock.mock.calls[2][1].body.walletProofNonce).toBe("nonce-host");
    expect(invokeMock.mock.calls[3][1].body.action).toBe("confirm_white_deposit");
    expect(invokeMock.mock.calls[3][1].body.transactionSignature).toBe("signature-host");
  });

  it("passes sponsor-presigned native SOL wager transactions to the wallet unchanged", async () => {
    const programId = Keypair.generate().publicKey;
    const sponsor = Keypair.generate();
    const walletPublicKey = Keypair.generate().publicKey;
    const transaction = sponsoredWhiteDepositTransaction({
      programId,
      sponsor,
      wallet: walletPublicKey,
      gameId: "chess-arena",
      contestId: "contest-native",
      stakeLamports: 500_000n,
      rulesHash: "chess-arena-v1",
    });
    const sponsorBlockhash = transaction.recentBlockhash;
    const serializedTransaction = Buffer.from(transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    })).toString("base64");
    const signAndSendTransaction = vi.fn(async (tx: Transaction) => {
      expect(tx.recentBlockhash).toBe(sponsorBlockhash);
      expect(tx.lastValidBlockHeight).toBe(456);
      expect(tx.feePayer?.equals(sponsor.publicKey)).toBe(true);
      const sponsorSignature = tx.signatures.find((signature) => signature.publicKey.equals(sponsor.publicKey));
      expect(sponsorSignature?.signature).not.toBeNull();
      return "signature-native";
    });

    invokeMock
      .mockResolvedValueOnce(sessionResponse("session-native"))
      .mockResolvedValueOnce({
        data: {
          walletProof: {
            message: "Chess Arena PvP\nAction: prepare_sponsored_wager",
            nonce: "nonce-native",
            expiresAt: "2026-06-17T03:00:00.000Z",
          },
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          gameId: "game-native",
          playerToken: "token-native",
          color: "w",
          depositRole: "white",
          contestId: "contest-native",
          stakeLamports: "500000",
          assetMint: "So11111111111111111111111111111111111111112",
          assetKind: "native_sol",
          paymentMode: "native_sol_sponsored",
          rentSponsorAddress: sponsor.publicKey.toBase58(),
          rentRecipientAddress: sponsor.publicKey.toBase58(),
          sponsoredTransaction: {
            serializedTransaction,
            lastValidBlockHeight: 456,
            requestId: "request-native",
            gameId: "game-native",
            contestId: "contest-native",
            stakeRaw: "500000",
            escrowProgramId: programId.toBase58(),
            rentSponsorAddress: sponsor.publicKey.toBase58(),
            rentRecipientAddress: sponsor.publicKey.toBase58(),
          },
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { ok: true, gameId: "game-native", status: "queued" },
        error: null,
      });

    const response = await enterWagerQueue({
      sessionId: "session-native",
      walletPublicKey,
      walletAddress: walletPublicKey.toBase58(),
      assetMint: "So11111111111111111111111111111111111111112",
      tokenProgramId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      stakeLamports: 500_000n,
      paymentMode: "native_sol_sponsored",
      sponsorSignerUrl: "https://sponsor.example.com",
      signMessage: vi.fn().mockResolvedValue(new Uint8Array(64).fill(3)),
      signAndSendTransaction,
    });

    expect(response.gameId).toBe("game-native");
    expect(signAndSendTransaction).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledTimes(4);
    expect(invokeMock.mock.calls[2][1].body.action).toBe("prepare_sponsored_wager");
    expect(invokeMock.mock.calls[3][1].body.action).toBe("confirm_sponsored_deposit");
    expect(invokeMock.mock.calls[3][1].body.transactionSignature).toBe("signature-native");
    expect(invokeMock.mock.calls[3][1].body.requestId).toBe("request-native");
  });

  it("surfaces missing wallet proof as a typed wager queue error", async () => {
    const walletPublicKey = Keypair.generate().publicKey;
    invokeMock
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce({
        data: { error: "Wallet proof required", code: "wallet_proof_required" },
        error: null,
      });

    await expect(prepareWagerQueue({
      sessionId: "session-a",
      walletAddress: walletPublicKey.toBase58(),
      assetMint: "So11111111111111111111111111111111111111112",
      tokenProgramId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      stakeLamports: 50_000_000n,
      paymentMode: "wsol_escrow",
    })).rejects.toMatchObject({
      name: "RefereeClientError",
      code: "wallet_proof_required",
    } satisfies Partial<RefereeClientError>);
  });

  it("refreshes a stale PvP session once when the referee rejects its proof", async () => {
    const walletPublicKey = Keypair.generate().publicKey;
    invokeMock.mockResolvedValueOnce(sessionResponse("stale-session"));
    await ensurePvpSession();
    invokeMock.mockReset();
    invokeMock
      .mockResolvedValueOnce({
        data: { error: "Invalid session proof", code: "invalid_session_proof" },
        error: null,
      })
      .mockResolvedValueOnce(sessionResponse("fresh-session"))
      .mockResolvedValueOnce({
        data: {
          gameId: "game-fresh",
          playerToken: "token-fresh",
          color: "w",
          depositRole: "white",
          contestId: "contest-fresh",
          stakeLamports: "50000000",
          assetMint: "So11111111111111111111111111111111111111112",
        },
        error: null,
      });

    const response = await prepareWagerQueue({
      sessionId: "stale-session",
      walletAddress: walletPublicKey.toBase58(),
      assetMint: "So11111111111111111111111111111111111111112",
      tokenProgramId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      stakeLamports: 50_000_000n,
      paymentMode: "wsol_escrow",
      walletSignature: "signature",
      walletProofNonce: "nonce",
      walletProofExpiresAt: "2026-06-17T03:00:00.000Z",
    });

    expect(response.gameId).toBe("game-fresh");
    expect(invokeMock).toHaveBeenCalledTimes(3);
    expect(invokeMock.mock.calls[0][1].body.sessionId).toBe("stale-session");
    expect(invokeMock.mock.calls[1][1].body.action).toBe("init_session");
    expect(invokeMock.mock.calls[2][1].body.sessionId).toBe("fresh-session");
  });
});
