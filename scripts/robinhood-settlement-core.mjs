import { getAddress, isAddress, parseAbiItem } from "viem";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
function bytes32(value, label) {
  const normalized = value?.startsWith("0x") ? value : `0x${value || ""}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) throw new Error(`Invalid ${label}`);
  return normalized;
}

export async function settleRobinhoodRow(row, { publicClient, wallet, supabase, reportSettlement, account, chain, escrow: ESCROW, abi, deployBlock }) {
  if (!["w", "b", "draw"].includes(row.winner)) throw new Error("Missing authoritative game result");
  const winner = row.winner === "w"
    ? row.white_wallet_address
    : row.winner === "b"
      ? row.black_wallet_address
      : ZERO_ADDRESS;
  if (!isAddress(winner || "")) throw new Error(`Game ${row.id} has no valid winner wallet`);
  const contestId = bytes32(row.escrow_contest_key, "contest key");
  const resultHash = bytes32(row.referee_result_hash, "result hash");
  let checkpoint = row.settlement_submitted_signature;
  if (checkpoint && !/^0x[0-9a-fA-F]{64}$/.test(checkpoint)) throw new Error("Invalid settlement checkpoint; reconciliation required");
  if (!checkpoint) {
    const contest = await publicClient.readContract({ address: ESCROW, abi, functionName: "getContest", args: [contestId] });
    if ([3, 4, 6].includes(Number(contest.state))) {
      if (contest.winner.toLowerCase() !== winner.toLowerCase() || contest.resultHash.toLowerCase() !== resultHash.toLowerCase()) {
        throw new Error("On-chain result differs from referee result; reconciliation required");
      }
      // Only scan history for an already settled contest, in bounded RPC ranges.
      for (let end = await publicClient.getBlockNumber(); end >= deployBlock;) {
        const start = end - 1999n > deployBlock ? end - 1999n : deployBlock;
        const logs = await publicClient.getLogs({
          address: ESCROW,
          event: parseAbiItem("event ContestSettled(bytes32 indexed contestId, address indexed winner, bytes32 resultHash, bool draw)"),
          args: { contestId }, fromBlock: start, toBlock: end,
        });
        checkpoint = logs.find((log) => log.args.winner?.toLowerCase() === winner.toLowerCase() && log.args.resultHash?.toLowerCase() === resultHash.toLowerCase())?.transactionHash;
        if (checkpoint) break;
        end = start - 1n;
      }
      if (!checkpoint) throw new Error("Settled contest has no recoverable receipt; reconciliation required");
    } else if (Number(contest.state) !== 2) {
      throw new Error("Contest is not active; settlement refused");
    }
  }
  const hash = /^0x[0-9a-fA-F]{64}$/.test(checkpoint || "")
    ? checkpoint
    : await wallet.writeContract({
      account,
      chain,
      address: ESCROW,
      abi,
      functionName: "settleContest",
      args: [contestId, getAddress(winner), resultHash],
    });
  if (row.settlement_submitted_signature !== hash) {
    const { error } = await supabase
      .from("pvp_games")
      .update({ settlement_submitted_signature: hash, settlement_attempted_at: new Date().toISOString() })
      .eq("id", row.id)
      .in("settlement_status", ["pending", "failed"]);
    if (error) throw error;
  }
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`Settlement reverted: ${hash}`);
  await reportSettlement(row, hash, getAddress(winner));
  return hash;
}
