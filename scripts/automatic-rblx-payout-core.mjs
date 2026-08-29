import { automaticRblxAbi, AUTO_RBLX_FALLBACK_SECONDS } from '../supabase/functions/_shared/automaticRblx.mjs';
import { getAddress, keccak256, stringToHex, parseAbiItem } from 'viem';

const prizeEvent = parseAbiItem('event PrizePaid(bytes32 indexed contestId, address indexed winner, uint8 asset, uint256 amount)');

export async function payAutomaticRblx(row, deps) {
  const { publicClient, wallet, account, chain, escrow, escrowAbi, router, quotePrize, saveCheckpoint, recordPaid } = deps;
  if (row.payout_mode !== 'automatic_rblx' || !['w', 'b'].includes(row.winner)) throw new Error('Automatic payout requires an authoritative winner');
  if (row.robinhood_escrow_address?.toLowerCase() !== escrow.toLowerCase()) throw new Error('Payout escrow mismatch');
  const contestId = keccak256(stringToHex(row.escrow_contest_id));
  const winner = getAddress(row.winner === 'w' ? row.white_wallet_address : row.black_wallet_address);
  const contest = await publicClient.readContract({ address: escrow, abi: escrowAbi, functionName: 'getContest', args: [contestId] });
  const expectedResult = row.referee_result_hash?.startsWith('0x') ? row.referee_result_hash : `0x${row.referee_result_hash}`;
  if (![3, 6].includes(Number(contest.state)) || contest.winner.toLowerCase() !== winner.toLowerCase()
    || contest.creator.toLowerCase() !== row.white_wallet_address.toLowerCase()
    || contest.joiner.toLowerCase() !== row.black_wallet_address.toLowerCase()
    || contest.stake !== BigInt(row.wager_stake_raw) || contest.resultHash.toLowerCase() !== expectedResult.toLowerCase()) {
    throw new Error('On-chain prize differs from the referee result');
  }
  const readPayout = () => publicClient.readContract({ address: escrow, abi: automaticRblxAbi, functionName: 'getPayout', args: [contestId] });
  let payout = await readPayout();
  const reconcile = async () => {
    if (![1, 2].includes(Number(payout.asset)) || payout.amount <= 0n || payout.paidBlock <= 0n) throw new Error('Prize has no confirmed payout');
    const logs = await publicClient.getLogs({ address: escrow, event: prizeEvent, args: { contestId, winner }, fromBlock: payout.paidBlock, toBlock: payout.paidBlock });
    const log = logs.find(log => Number(log.args.asset) === Number(payout.asset) && log.args.amount === payout.amount);
    if (!log?.transactionHash) throw new Error('Payout receipt needs reconciliation');
    const receipt = await publicClient.waitForTransactionReceipt({ hash: log.transactionHash, confirmations: 2, timeout: 120_000 });
    if (receipt.status !== 'success') throw new Error('Payout receipt reverted');
    await recordPaid({ hash: log.transactionHash, asset: Number(payout.asset) === 1 ? 'paid_rblx' : 'paid_eth', amount: payout.amount.toString() });
    return log.transactionHash;
  };
  if (Number(payout.asset) !== 0) return reconcile();
  if (Number(contest.state) === 6) throw new Error('Paid contest has no matching payout record');
  if (row.auto_payout_submitted_signature) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(row.auto_payout_submitted_signature)) throw new Error('Invalid payout checkpoint');
    // Unknown/dropped receipts remain pending. Never clear them on timeout and
    // accidentally broadcast another nonce while the first transaction can mine.
    const receipt = await publicClient.waitForTransactionReceipt({ hash: row.auto_payout_submitted_signature, confirmations: 2, timeout: 120_000 });
    if (receipt.status !== 'success') {
      await saveCheckpoint(null);
      throw new Error('Previous payout reverted; a fresh attempt can be made');
    }
    payout = await readPayout();
    return reconcile();
  }
  const block = await publicClient.getBlock();
  const fallbackAt = BigInt(payout.settledAt) + BigInt(AUTO_RBLX_FALLBACK_SECONDS);
  let functionName, args;
  if (block.timestamp >= fallbackAt) {
    functionName = 'payEthFallback'; args = [contestId];
  } else {
    const quote = await quotePrize(row);
    const pot = contest.stake * 2n;
    const floor = BigInt(row.winner === 'w' ? row.white_minimum_rblx : row.black_minimum_rblx);
    const onchainFloor = row.winner === 'w' ? payout.whiteMinimum : payout.blackMinimum;
    if (floor <= 0n || floor !== onchainFloor) throw new Error('Authorized payout minimum mismatch');
    if (quote.walletAddress?.toLowerCase() !== winner.toLowerCase() || quote.transaction?.to?.toLowerCase() !== router.toLowerCase()
      || quote.transaction.chainId !== 4663 || BigInt(quote.transaction.value) !== pot
      || !/^0x(?:[0-9a-fA-F]{2}){4,}$/.test(quote.transaction.data || '')
      || !/^[1-9][0-9]*$/.test(quote.minimumRblxOut) || !/^[1-9][0-9]*$/.test(quote.quotedRblxOut)
      || Date.parse(quote.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(quote.expiresAt))) throw new Error('Invalid automatic payout quote');
    if (BigInt(quote.quotedRblxOut) < floor) throw new Error('Current RBLX quote is below the player’s authorized minimum');
    const minOut = BigInt(quote.minimumRblxOut) > floor ? BigInt(quote.minimumRblxOut) : floor;
    if (minOut > BigInt(quote.quotedRblxOut)) throw new Error('Invalid quote minimum');
    const latest = await publicClient.getBlock();
    const expiry = BigInt(Math.floor(Date.parse(quote.expiresAt) / 1000));
    const deadline = [latest.timestamp + 60n, expiry, fallbackAt - 1n].reduce((a, b) => a < b ? a : b);
    if (deadline <= latest.timestamp) throw new Error('Payout quote expired');
    functionName = 'payRblx'; args = [contestId, quote.transaction.data, minOut, deadline];
  }
  const request = { account, chain, address: escrow, abi: automaticRblxAbi, functionName, args };
  await publicClient.simulateContract(request);
  const hash = await wallet.writeContract(request);
  await saveCheckpoint(hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 120_000 });
  if (receipt.status !== 'success') { await saveCheckpoint(null); throw new Error('Automatic payout reverted'); }
  payout = await readPayout();
  return reconcile();
}
