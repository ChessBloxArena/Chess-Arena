import { createSolanaClient, type SolanaSupportedNetworks } from "@metamask/connect-solana";
import { publicPaymentConfig } from "@/lib/paymentConfig";

let registrationPromise: Promise<void> | null = null;

function supportedNetworks(): SolanaSupportedNetworks {
  const { cluster, endpoint } = publicPaymentConfig.solana;

  if (cluster === "mainnet-beta") return { mainnet: endpoint };
  if (cluster === "devnet") return { devnet: endpoint };
  if (cluster === "testnet") return { testnet: endpoint };
  return {};
}

export function registerMetaMaskSolanaWallet(): Promise<void> {
  registrationPromise ??= createSolanaClient({
    dapp: {
      name: "ChessBlox",
      url: window.location.origin,
    },
    analytics: {
      enabled: false,
    },
    api: {
      supportedNetworks: supportedNetworks(),
    },
  }).then(() => undefined);

  return registrationPromise;
}
