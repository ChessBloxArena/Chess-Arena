// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  MemorySponsoredRequestStore,
  SponsoredTransactionError,
  prepareSponsoredWagerTransaction,
  type SponsoredNativeInstructionFactory,
  type SponsoredTransactionRequest,
  type SponsoredTransactionServiceConfig,
  type SponsoredWagerTerms,
} from "./sponsoredWagerTransactionService";

const nowMs = Date.parse("2026-06-19T00:00:00.000Z");

function baseSetup(overrides: Partial<SponsoredTransactionServiceConfig> = {}) {
  const sponsor = Keypair.generate();
  const wallet = Keypair.generate().publicKey;
  const rentRecipient = Keypair.generate().publicKey;
  const programId = Keypair.generate().publicKey;
  const config: SponsoredTransactionServiceConfig = {
    enabled: true,
    refereeKillSwitch: false,
    sponsorUnavailable: false,
    treasuryLow: false,
    minTreasuryLamports: 1_000_000n,
    requestTtlMs: 5 * 60 * 1000,
    escrowProgramId: programId,
    sponsorPublicKey: sponsor.publicKey,
    rentRecipientAddress: rentRecipient,
    ...overrides,
  };
  const request: SponsoredTransactionRequest = {
    action: "white_deposit",
    gameId: "00000000-0000-4000-8000-000000000001",
    sessionId: "00000000-0000-4000-8000-000000000002",
    sessionProof: "proof-a",
    playerToken: "player-token-a",
    walletAddress: wallet.toBase58(),
    stakeRaw: "10000000",
    assetKind: "native_sol",
    requestId: "request-a",
    requestedAtMs: nowMs,
    expectedEscrowContestId: "contest-a",
    walletSignature: "wallet-proof-signature",
    walletProofNonce: "wallet-proof-nonce",
    walletProofExpiresAt: "2026-06-19T00:05:00.000Z",
  };
  const terms: SponsoredWagerTerms = {
    gameId: request.gameId,
    playerToken: "player-token-a",
    color: "w",
    depositRole: "white",
    contestId: "contest-a",
    stakeLamports: request.stakeRaw,
    assetMint: "So11111111111111111111111111111111111111112",
    assetKind: "native_sol",
    paymentMode: "native_sol_sponsored",
    rentSponsorAddress: sponsor.publicKey.toBase58(),
    rentRecipientAddress: rentRecipient.toBase58(),
    escrowProgramId: programId.toBase58(),
  };
  const state = {
    gameId: request.gameId,
    paymentMode: "native_sol_sponsored",
    assetKind: "native_sol",
    paymentStatus: "white_prepared",
    stakeRaw: request.stakeRaw,
    assetMint: terms.assetMint,
    escrowContestId: terms.contestId,
    rentSponsorAddress: terms.rentSponsorAddress,
    rentRecipientAddress: terms.rentRecipientAddress,
    whiteWalletAddress: request.walletAddress,
    blackWalletAddress: null,
  };
  const instructionFactory: SponsoredNativeInstructionFactory = {
    async buildSponsoredInstruction(input) {
      return {
        instruction: new TransactionInstruction({
          programId,
          keys: [
            { pubkey: sponsor.publicKey, isSigner: true, isWritable: true },
            { pubkey: new PublicKey(input.walletAddress), isSigner: true, isWritable: true },
          ],
          data: Buffer.from([1, 2, 3]),
        }),
        metadata: {
          action: input.action,
          gameId: input.gameId,
          contestId: input.contestId,
          walletAddress: input.walletAddress,
          stakeRaw: input.stakeRaw,
          assetKind: "native_sol",
          paymentMode: "native_sol_sponsored",
          rentSponsorAddress: input.rentSponsorAddress,
          rentRecipientAddress: input.rentRecipientAddress,
        },
      };
    },
  };

  return {
    sponsor,
    config,
    request,
    terms,
    instructionFactory,
    referee: {
      prepareSponsoredWager: vi.fn().mockResolvedValue(terms),
      getSponsoredWagerState: vi.fn().mockResolvedValue(state),
    },
    signer: {
      publicKey: sponsor.publicKey,
      async signTransaction(transaction) {
        transaction.partialSign(sponsor);
        return transaction;
      },
    },
    connection: {
      async getLatestBlockhash() {
        return {
          blockhash: Keypair.generate().publicKey.toBase58(),
          lastValidBlockHeight: 123,
        };
      },
    },
    treasury: {
      balanceLamports: vi.fn().mockResolvedValue(2_000_000n),
    },
    requestStore: new MemorySponsoredRequestStore(),
  };
}

async function callService(setup: ReturnType<typeof baseSetup>) {
  return prepareSponsoredWagerTransaction({
    request: setup.request,
    config: setup.config,
    referee: setup.referee,
    instructionFactory: setup.instructionFactory,
    signer: setup.signer,
    connection: setup.connection,
    treasury: setup.treasury,
    requestStore: setup.requestStore,
    nowMs,
  });
}

describe("sponsored wager transaction service", () => {
  it("signs only an exact native SOL sponsored program transaction", async () => {
    const setup = baseSetup();
    const response = await callService(setup);

    expect(response.gameId).toBe(setup.request.gameId);
    expect(response.contestId).toBe("contest-a");
    expect(response.stakeRaw).toBe("10000000");
    expect(response.sponsorSignatureCount).toBe(1);
    expect(response.lastValidBlockHeight).toBe(123);
    expect(response.escrowProgramId).toBe(setup.config.escrowProgramId.toBase58());
    expect(response.rentSponsorAddress).toBe(setup.config.sponsorPublicKey.toBase58());
    expect(response.rentRecipientAddress).toBe(setup.config.rentRecipientAddress.toBase58());
    expect(response.serializedTransaction.length).toBeGreaterThan(20);

    const transaction = Transaction.from(Buffer.from(response.serializedTransaction, "base64"));
    transaction.lastValidBlockHeight = response.lastValidBlockHeight;
    expect(transaction.feePayer?.equals(setup.config.sponsorPublicKey)).toBe(true);
    expect(transaction.lastValidBlockHeight).toBe(123);
    expect(transaction.instructions).toHaveLength(1);
    expect(transaction.instructions[0].programId.equals(setup.config.escrowProgramId)).toBe(true);
    expect(transaction.signatures.find((signature) => signature.publicKey.equals(setup.config.sponsorPublicKey))?.signature).not.toBeNull();
  });

  it("rejects missing session proof before referee or signing", async () => {
    const setup = baseSetup();
    setup.request.sessionProof = "";

    await expect(callService(setup)).rejects.toMatchObject({
      code: "missing_session_proof",
    } satisfies Partial<SponsoredTransactionError>);
    expect(setup.referee.prepareSponsoredWager).not.toHaveBeenCalled();
    expect(setup.referee.getSponsoredWagerState).not.toHaveBeenCalled();
  });

  it("rejects wrong wallet proof surfaced by the referee", async () => {
    const setup = baseSetup();
    setup.referee.getSponsoredWagerState.mockRejectedValueOnce(
      new SponsoredTransactionError("wallet_proof_failed", "Wallet proof verification failed", 403),
    );

    await expect(callService(setup)).rejects.toMatchObject({
      code: "wallet_proof_failed",
    } satisfies Partial<SponsoredTransactionError>);
  });

  it("rejects stale request ids", async () => {
    const setup = baseSetup();
    setup.request.requestedAtMs = nowMs - 10 * 60 * 1000;

    await expect(callService(setup)).rejects.toMatchObject({
      code: "stale_request_id",
    } satisfies Partial<SponsoredTransactionError>);
  });

  it("rejects duplicate request ids", async () => {
    const setup = baseSetup();
    await callService(setup);

    await expect(callService(setup)).rejects.toMatchObject({
      code: "duplicate_request_id",
    } satisfies Partial<SponsoredTransactionError>);
  });

  it("rejects a fresh request id while the same sponsored action is already leased", async () => {
    const setup = baseSetup();
    await callService(setup);
    setup.request.requestId = "request-b";

    await expect(callService(setup)).rejects.toMatchObject({
      code: "sponsored_action_in_flight",
      status: 429,
    } satisfies Partial<SponsoredTransactionError>);
  });

  it("rejects wrong stake returned by referee", async () => {
    const setup = baseSetup();
    setup.referee.getSponsoredWagerState.mockResolvedValueOnce({
      gameId: setup.request.gameId,
      paymentMode: "native_sol_sponsored",
      assetKind: "native_sol",
      paymentStatus: "white_prepared",
      stakeRaw: "20000000",
      assetMint: setup.terms.assetMint,
      escrowContestId: setup.terms.contestId,
      rentSponsorAddress: setup.terms.rentSponsorAddress,
      rentRecipientAddress: setup.terms.rentRecipientAddress,
      whiteWalletAddress: setup.request.walletAddress,
      blackWalletAddress: null,
    });

    await expect(callService(setup)).rejects.toMatchObject({
      code: "wrong_stake",
    } satisfies Partial<SponsoredTransactionError>);
  });

  it("rejects wrong asset kind", async () => {
    const setup = baseSetup();
    setup.request.assetKind = "spl_token" as "native_sol";

    await expect(callService(setup)).rejects.toMatchObject({
      code: "wrong_asset_kind",
    } satisfies Partial<SponsoredTransactionError>);
  });

  it("rejects wrong contest id returned by referee", async () => {
    const setup = baseSetup();
    setup.referee.getSponsoredWagerState.mockResolvedValueOnce({
      gameId: setup.request.gameId,
      paymentMode: "native_sol_sponsored",
      assetKind: "native_sol",
      paymentStatus: "white_prepared",
      stakeRaw: setup.request.stakeRaw,
      assetMint: setup.terms.assetMint,
      escrowContestId: "contest-b",
      rentSponsorAddress: setup.terms.rentSponsorAddress,
      rentRecipientAddress: setup.terms.rentRecipientAddress,
      whiteWalletAddress: setup.request.walletAddress,
      blackWalletAddress: null,
    });

    await expect(callService(setup)).rejects.toMatchObject({
      code: "wrong_contest",
    } satisfies Partial<SponsoredTransactionError>);
  });

  it("rejects sponsor unavailable kill switches", async () => {
    const setup = baseSetup({ sponsorUnavailable: true });

    await expect(callService(setup)).rejects.toMatchObject({
      code: "sponsor_unavailable",
    } satisfies Partial<SponsoredTransactionError>);
  });

  it("rejects treasury-low sponsorship before signing", async () => {
    const setup = baseSetup();
    setup.treasury.balanceLamports.mockResolvedValueOnce(100n);

    await expect(callService(setup)).rejects.toMatchObject({
      code: "treasury_low",
    } satisfies Partial<SponsoredTransactionError>);
  });

  it("rejects signer responses that drop the sponsor pre-signature", async () => {
    const setup = baseSetup();
    setup.signer.signTransaction = vi.fn().mockImplementation(async (transaction: Transaction) => transaction);

    await expect(callService(setup)).rejects.toMatchObject({
      code: "missing_sponsor_signature",
      status: 503,
    } satisfies Partial<SponsoredTransactionError>);
  });

  it("rejects signer responses that change the exact escrow program", async () => {
    const setup = baseSetup();
    const wrongProgramId = Keypair.generate().publicKey;
    setup.signer.signTransaction = vi.fn().mockImplementation(async (transaction: Transaction) => {
      const mutated = new Transaction();
      mutated.feePayer = transaction.feePayer;
      mutated.recentBlockhash = transaction.recentBlockhash;
      mutated.lastValidBlockHeight = transaction.lastValidBlockHeight;
      mutated.add(new TransactionInstruction({
        programId: wrongProgramId,
        keys: transaction.instructions[0].keys,
        data: transaction.instructions[0].data,
      }));
      mutated.partialSign(setup.sponsor);
      return mutated;
    });

    await expect(callService(setup)).rejects.toMatchObject({
      code: "wrong_program",
      status: 503,
    } satisfies Partial<SponsoredTransactionError>);
  });
});
