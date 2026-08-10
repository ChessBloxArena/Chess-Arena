// @vitest-environment node

import { describe, expect, it } from "vitest";
import { Keypair, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  buildCancelWsolContestTransaction,
  buildCreateWsolContestTransaction,
  buildJoinWsolContestTransaction,
  buildReclaimWsolContestRentTransaction,
  buildRefundExpiredWsolContestTransaction,
  buildSettleWsolContestTransaction,
  buildUnwrapSolTransaction,
  type EscrowInstructionFactory,
} from "@/lib/solanaWagerTransactions";
import { WSOL_MINT_ADDRESS } from "@/lib/wagerConfig";

const escrowInstruction = () => new TransactionInstruction({
  keys: [],
  programId: SystemProgram.programId,
  data: Buffer.alloc(0),
});

const escrow: EscrowInstructionFactory = {
  createContest: escrowInstruction,
  joinContest: escrowInstruction,
  cancelContest: escrowInstruction,
  refundExpiredContest: escrowInstruction,
  settleContest: escrowInstruction,
  reclaimContestRent: escrowInstruction,
};

describe("wSOL wager transactions", () => {
  it("wraps SOL with ATA creation and SyncNative before create escrow", async () => {
    const wallet = Keypair.generate().publicKey;
    const request = await buildCreateWsolContestTransaction({
      walletPublicKey: wallet,
      contestId: "contest-a",
      stakeLamports: 10_000_000n,
      escrow,
    });

    expect(request.kind).toBe("create");
    expect(request.contestId).toBe("contest-a");
    expect(request.accounts.mint.toBase58()).toBe(WSOL_MINT_ADDRESS);
    expect(request.accounts.tokenProgramId.toBase58()).toBe(TOKEN_PROGRAM_ID.toBase58());
    expect(request.instructionLabels).toEqual([
      "create-associated-token-account-idempotent",
      "system-transfer-lamports-to-wsol-ata",
      "sync-native",
      "escrow-create-contest",
    ]);
    expect(request.transaction.instructions).toHaveLength(4);
  });

  it("wraps the matching stake before join escrow", async () => {
    const wallet = Keypair.generate().publicKey;
    const request = await buildJoinWsolContestTransaction({
      walletPublicKey: wallet,
      contestId: "contest-a",
      stakeLamports: 10_000_000n,
      escrow,
    });

    expect(request.kind).toBe("join");
    expect(request.instructionLabels).toContain("sync-native");
    expect(request.instructionLabels[request.instructionLabels.length - 1]).toBe("escrow-join-contest");
  });

  it("builds cancel, refund, settle, reclaim rent, and unwrap requests without wallet secrets", async () => {
    const white = Keypair.generate().publicKey;
    const black = Keypair.generate().publicKey;
    const authority = Keypair.generate().publicKey;
    const winner = white;
    const common = {
      walletPublicKey: white,
      contestId: "contest-a",
      stakeLamports: 10_000_000n,
      escrow,
    };

    const cancel = await buildCancelWsolContestTransaction(common);
    const refund = await buildRefundExpiredWsolContestTransaction(common);
    const settle = await buildSettleWsolContestTransaction({
      resultAuthority: authority,
      white,
      black,
      winner,
      contestId: "contest-a",
      stakeLamports: 10_000_000n,
      resultHash: new Uint8Array([1, 2, 3]),
      escrow,
    });
    const reclaimRent = await buildReclaimWsolContestRentTransaction({
      payer: authority,
      rentRecipient: white,
      contestId: "contest-a",
      stakeLamports: 10_000_000n,
      escrow,
    });
    const unwrap = buildUnwrapSolTransaction(white);

    expect(cancel.instructionLabels).toEqual(["escrow-cancel-contest"]);
    expect(refund.instructionLabels).toEqual(["escrow-refund-expired-contest"]);
    expect(settle.accounts.payer.toBase58()).toBe(authority.toBase58());
    expect(reclaimRent.kind).toBe("reclaim_rent");
    expect(reclaimRent.accounts.payer.toBase58()).toBe(authority.toBase58());
    expect(reclaimRent.instructionLabels).toEqual(["escrow-reclaim-contest-rent"]);
    expect(unwrap.instructionLabels).toEqual(["close-wsol-associated-token-account"]);
  });

  it("supports configured SPL token wagers without wrapping SOL", async () => {
    const request = await buildCreateWsolContestTransaction({
      walletPublicKey: Keypair.generate().publicKey,
      contestId: "contest-a",
      stakeLamports: 10_000_000n,
      mint: new PublicKey("11111111111111111111111111111111"),
      escrow,
    });

    expect(request.instructionLabels).toEqual([
      "create-associated-token-account-idempotent",
      "escrow-create-contest",
    ]);
    expect(request.transaction.instructions).toHaveLength(2);
  });
});
