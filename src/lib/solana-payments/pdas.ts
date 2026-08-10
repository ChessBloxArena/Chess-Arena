import { sha256 } from "@noble/hashes/sha256";
import { PublicKey } from "@solana/web3.js";
import { assertPublicKey } from "./config.js";

export type PdaDerivation = {
  publicKey: PublicKey;
  bump: number;
};

export type GamePdaInput = {
  programId: string;
  gameId: string;
};

export type ContestPdaInput = GamePdaInput & {
  contestId: string;
  gameConfig?: string;
};

export type ContestVaultPdaInput = {
  programId: string;
  contest: string;
  mint: string;
};

export function deriveGlobalConfigPda(programId: string): PdaDerivation {
  return derive(programId, [seed("global_config")]);
}

export function deriveGameConfigPda(input: GamePdaInput): PdaDerivation {
  return derive(input.programId, [seed("game"), seedHash(input.gameId)]);
}

export function deriveGameMintPda(input: {
  programId: string;
  gameConfig: string;
  mint: string;
}): PdaDerivation {
  return derive(input.programId, [
    seed("game_mint"),
    assertPublicKey(input.gameConfig, "gameConfig").toBytes(),
    assertPublicKey(input.mint, "mint").toBytes()
  ]);
}

export function deriveContestPda(input: ContestPdaInput): PdaDerivation {
  const gameConfig =
    input.gameConfig ?? deriveGameConfigPda(input).publicKey.toBase58();

  return derive(input.programId, [
    seed("contest"),
    assertPublicKey(gameConfig, "gameConfig").toBytes(),
    seedHash(input.contestId)
  ]);
}

export function deriveContestVaultPda(input: ContestVaultPdaInput): PdaDerivation {
  return derive(input.programId, [
    seed("contest_vault"),
    assertPublicKey(input.contest, "contest").toBytes(),
    assertPublicKey(input.mint, "mint").toBytes()
  ]);
}

export function deriveVaultAuthorityPda(input: {
  programId: string;
  contest: string;
}): PdaDerivation {
  return derive(input.programId, [
    seed("vault_authority"),
    assertPublicKey(input.contest, "contest").toBytes()
  ]);
}

function derive(programId: string, seeds: Uint8Array[]): PdaDerivation {
  const [publicKey, bump] = PublicKey.findProgramAddressSync(
    seeds,
    assertPublicKey(programId, "programId")
  );

  return { publicKey, bump };
}

function seed(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function seedHash(value: string): Uint8Array {
  return sha256(seed(value));
}
