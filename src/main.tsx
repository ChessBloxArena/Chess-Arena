import { createRoot } from "react-dom/client";
import { Buffer } from "buffer";
import "./index.css";
import "./blox.css";
import "./sky-club.css";

const browserGlobal = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
browserGlobal.Buffer ??= Buffer;

const root = createRoot(document.getElementById("root")!);
const WALLET_CONNECTOR_BOOTSTRAP_TIMEOUT_MS = 1500;

async function bootstrapWalletConnectors() {
  try {
    const { registerMetaMaskSolanaWallet } = await import("./solana/metamaskSolana");
    await Promise.race([
      registerMetaMaskSolanaWallet(),
      new Promise((resolve) => window.setTimeout(resolve, WALLET_CONNECTOR_BOOTSTRAP_TIMEOUT_MS)),
    ]);
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn("MetaMask Solana connector unavailable", err);
    }
  }
}

void bootstrapWalletConnectors().then(() => import("./App.tsx")).then(({ default: App }) => {
  root.render(<App />);
});
