import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEther } from "viem";
import { getWagerConfig } from "./wagerConfig";

afterEach(() => vi.unstubAllEnvs());

describe("ETH wager presets", () => {
  it("starts the default ladder at 0.002 ETH", () => {
    vi.stubEnv("VITE_WAGER_PRESET_STAKES", "");
    vi.stubEnv("VITE_WAGER_MAX_STAKE_UNITS", "0.34");
    expect(getWagerConfig().presetStakeLamports.slice(0, 3)).toEqual(
      ["0.002", "0.004", "0.01"].map((stake) => parseEther(stake)),
    );
  });

  it("uses the lower default when configured presets are invalid", () => {
    vi.stubEnv("VITE_WAGER_PRESET_STAKES", "invalid,0,-1");
    vi.stubEnv("VITE_WAGER_MAX_STAKE_UNITS", "0.34");
    expect(getWagerConfig().presetStakeLamports).toEqual([parseEther("0.002")]);
  });

  it("never returns a fallback stake above the configured cap", () => {
    vi.stubEnv("VITE_WAGER_PRESET_STAKES", "0.025");
    vi.stubEnv("VITE_WAGER_MAX_STAKE_UNITS", "0.001");
    expect(getWagerConfig().presetStakeLamports).toEqual([parseEther("0.001")]);
  });
});
