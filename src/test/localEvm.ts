import { createHardhatRuntimeEnvironment } from 'hardhat/hre';
import { toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/** Isolated in-process chain. These public, deterministic keys are test fixtures only. */
export async function createLocalEvm() {
  const keys = Array.from({ length: 10 }, (_, index) => toHex(BigInt(index + 1), { size: 32 }));
  const runtime = await createHardhatRuntimeEnvironment({
    networks: {
      localTest: {
        type: 'edr-simulated',
        chainType: 'l1',
        chainId: 1337,
        hardfork: 'prague',
        accounts: keys.map(privateKey => ({ privateKey, balance: 10n ** 22n })),
      },
    },
  });
  const connection = await runtime.network.create('localTest');
  return {
    provider: connection.provider,
    accounts: keys.map(privateKey => privateKeyToAccount(privateKey)),
    close: () => connection.close(),
  };
}
