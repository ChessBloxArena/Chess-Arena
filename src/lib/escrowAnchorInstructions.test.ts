// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { createEscrowInstructionFactory } from "@/lib/escrowAnchorInstructions";
import { WSOL_MINT_ADDRESS } from "@/lib/wagerConfig";

const programId = new PublicKey("EPJweRGs6TzuBaSJqceboSy8YonZ5FKZ2qGR6na9f8Fd");
const mint = new PublicKey(WSOL_MINT_ADDRESS);

describe("escrow Anchor instruction factory", () => {
  it("builds real create and join escrow instructions with Anchor discriminators", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-16T12:00:00.000Z"));
    const white = Keypair.generate().publicKey;
    const black = Keypair.generate().publicKey;
    const factory = createEscrowInstructionFactory({
      programId,
      gameId: "chess-arena",
      rulesHash: "chess-arena-v1",
      contestTtlSeconds: 600,
      feeAuthority: Keypair.generate().publicKey,
    });

    const create = await factory.createContest({
      contestId: "contest-a",
      stakeLamports: 50_000_000n,
      assetMint: mint,
      tokenProgramId: TOKEN_PROGRAM_ID,
      creator: white,
      creatorTokenAccount: Keypair.generate().publicKey,
    });
    const join = await factory.joinContest({
      contestId: "contest-a",
      stakeLamports: 50_000_000n,
      assetMint: mint,
      tokenProgramId: TOKEN_PROGRAM_ID,
      joiner: black,
      joinerTokenAccount: Keypair.generate().publicKey,
    });

    expect(create.programId.toBase58()).toBe(programId.toBase58());
    expect([...create.data.subarray(0, 8)]).toEqual([129, 189, 164, 27, 152, 242, 123, 93]);
    expect(create.keys).toHaveLength(10);
    expect(create.keys[7]).toMatchObject({ pubkey: white, isSigner: true, isWritable: true });
    expect([...join.data.subarray(0, 8)]).toEqual([247, 243, 77, 111, 247, 254, 100, 133]);
    expect(join.keys).toHaveLength(9);
    expect(join.keys[7]).toMatchObject({ pubkey: black, isSigner: true, isWritable: true });
    vi.useRealTimers();
  });

  it("builds a rent reclaim instruction that returns SPL escrow rent to the creator", async () => {
    const creator = Keypair.generate().publicKey;
    const factory = createEscrowInstructionFactory({
      programId,
      gameId: "chess-arena",
      rulesHash: "chess-arena-v1",
      contestTtlSeconds: 600,
      feeAuthority: Keypair.generate().publicKey,
    });

    const instruction = await factory.reclaimContestRent({
      contestId: "contest-a",
      stakeLamports: 50_000_000n,
      assetMint: mint,
      tokenProgramId: TOKEN_PROGRAM_ID,
      rentRecipient: creator,
    });

    expect(instruction.programId.toBase58()).toBe(programId.toBase58());
    expect([...instruction.data.subarray(0, 8)]).toEqual([94, 36, 53, 152, 64, 248, 229, 180]);
    expect(instruction.keys).toHaveLength(6);
    expect(instruction.keys[0]).toMatchObject({ isSigner: false, isWritable: true });
    expect(instruction.keys[1]).toMatchObject({ pubkey: mint, isSigner: false, isWritable: false });
    expect(instruction.keys[2]).toMatchObject({ isSigner: false, isWritable: true });
    expect(instruction.keys[3]).toMatchObject({ isSigner: false, isWritable: false });
    expect(instruction.keys[4]).toMatchObject({ pubkey: creator, isSigner: false, isWritable: true });
    expect(instruction.keys[5]).toMatchObject({ pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false });
  });
});
