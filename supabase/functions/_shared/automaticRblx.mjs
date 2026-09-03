import { parseAbi, getAddress, isAddress } from 'viem';

export const AUTO_RBLX_TERMS_VERSION = 1;
export const AUTO_RBLX_FALLBACK_SECONDS = 900;
export const automaticRblxAbi = parseAbi([
  'function createRblxContest(bytes32 contestId, uint64 expiresAt, uint256 minimumRblx) payable',
  'function joinRblxContest(bytes32 contestId, uint256 minimumRblx) payable',
  'function payRblx(bytes32 contestId, bytes swapData, uint256 minimumOut, uint256 deadline)',
  'function payEthFallback(bytes32 contestId)',
  'function getPayout(bytes32 contestId) view returns ((uint256 whiteMinimum, uint256 blackMinimum, uint64 settledAt, uint8 asset, uint256 amount, uint256 paidBlock) payout)',
  'function swapRouter() view returns (address)',
  'function rblxToken() view returns (address)',
  'function FALLBACK_DELAY() view returns (uint256)',
  'event PayoutAuthorized(bytes32 indexed contestId, address indexed player, uint256 minimumRblx)',
  'event PrizePaid(bytes32 indexed contestId, address indexed winner, uint8 asset, uint256 amount)',
]);

// Legacy null addresses resolve only to the original escrow. Never infer a new
// contract from the current entry feature flag when recovering an existing game.
export function resolveGameEscrow(address, legacy, automatic) {
  const candidate = address || legacy;
  if (!isAddress(candidate || '')) throw new Error('Match escrow is not configured');
  const normalized = candidate.toLowerCase();
  if (![legacy, automatic].filter(Boolean).some(value => value.toLowerCase() === normalized)) {
    throw new Error('Match uses an unrecognized escrow');
  }
  return getAddress(candidate);
}
