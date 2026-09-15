import { robinhoodReadTransport } from '../../supabase/functions/_shared/robinhoodReadTransport.mjs';
import { walletErrorMessage } from "@/lib/walletError";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  keccak256,
  custom,
  formatEther,
  getAddress,
  hexToBytes,
  type Address,
  type EIP1193Provider,
  type Hash,
  type Hex,
} from "viem";
import { readTransactionRecord, runRecoverableTransaction } from "@/lib/walletTransactionJournal";
import { robinhoodChain } from "@/lib/robinhoodChain";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export interface RobinhoodWallet {
  address: Address | null;
  shortAddress: string;
  balanceWei: bigint | null;
  balanceEth: number | null;
  connecting: boolean;
  refreshing: boolean;
  error: string | null;
  connect: () => Promise<Address | null>;
  disconnect: () => Promise<void>;
  refreshBalance: () => Promise<void>;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  writeContract: (request: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
    value?: bigint;
  }) => Promise<Hash>;
  sendTransaction: (request: {
    to: Address;
    data: Hex;
    value: bigint;
    operationId?: string;
  }) => Promise<Hash>;
}

const browserRpc = import.meta.env.PROD && typeof window !== 'undefined' ? `${window.location.origin}/api/robinhood-rpc` : undefined;
const publicClient = createPublicClient({ chain: robinhoodChain, transport: robinhoodReadTransport(browserRpc) });


export function useRobinhoodWallet(): RobinhoodWallet {
  const [address, setAddress] = useState<Address | null>(null);
  const [balanceWei, setBalanceWei] = useState<bigint | null>(null);
  const [balanceEth, setBalanceEth] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const provider = typeof window === "undefined" ? undefined : window.ethereum;

  const ensureChain = useCallback(async () => {
    if (!provider) throw new Error("No EVM wallet found.");
    const chainHex = `0x${robinhoodChain.id.toString(16)}`;
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
    } catch (switchError) {
      const code = (switchError as { code?: number }).code;
      if (code !== 4902) throw switchError;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: chainHex,
          chainName: robinhoodChain.name,
          nativeCurrency: robinhoodChain.nativeCurrency,
          rpcUrls: robinhoodChain.rpcUrls.default.http,
          blockExplorerUrls: [robinhoodChain.blockExplorers.default.url],
        }],
      });
    }
  }, [provider]);

  const refreshBalance = useCallback(async () => {
    if (!address) return;
    setRefreshing(true);
    try {
      const balance = await publicClient.getBalance({ address });
      setError(null);
      setBalanceWei(balance);
      setBalanceEth(Number(formatEther(balance)));
    } catch (refreshError) {
      setError(walletErrorMessage(refreshError));
    } finally {
      setRefreshing(false);
    }
  }, [address]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      if (!provider) throw new Error("No EVM wallet found.");
      await ensureChain();
      const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
      const nextAddress = accounts[0] ? getAddress(accounts[0]) : null;
      setAddress(nextAddress);
      return nextAddress;
    } catch (connectError) {
      setError(walletErrorMessage(connectError));
      return null;
    } finally {
      setConnecting(false);
    }
  }, [ensureChain, provider]);

  const disconnect = useCallback(async () => {
    setAddress(null);
    setBalanceEth(null);
    setBalanceWei(null);
    setError(null);
  }, []);

  const walletClient = useMemo(
    () => provider ? createWalletClient({ chain: robinhoodChain, transport: custom(provider) }) : null,
    [provider],
  );

  const signMessage = useCallback(async (message: Uint8Array) => {
    const account = address ?? await connect();
    if (!account || !walletClient) throw new Error("Connect an EVM wallet first.");
    await ensureChain();
    const signature = await walletClient.signMessage({ account, message: { raw: message } });
    return hexToBytes(signature);
  }, [address, connect, ensureChain, walletClient]);

  const writeContract = useCallback(async (request: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
    value?: bigint;
  }) => {
    const account = address ?? await connect();
    if (!account || !walletClient) throw new Error("Connect an EVM wallet first.");
    await ensureChain();
    const data = encodeFunctionData(request as never);
    const identity = `${robinhoodChain.id}:${account.toLowerCase()}:${request.address.toLowerCase()}:${keccak256(data)}:${request.value ?? 0n}`;
    const saved = readTransactionRecord(identity);
    if (!saved || saved.status === "reverted") {
      await publicClient.simulateContract({ ...request, account } as never);
    }
    const hash = await runRecoverableTransaction({
      identity,
      broadcast: () => walletClient.writeContract({ ...request, account, chain: robinhoodChain } as never),
      confirm: async (hash) => (await publicClient.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 120_000 })).status,
    });
    await refreshBalance();
    return hash;
  }, [address, connect, ensureChain, refreshBalance, walletClient]);

  const sendTransaction = useCallback(async (request: {
    to: Address;
    data: Hex;
    value: bigint;
    operationId?: string;
  }) => {
    const account = address ?? await connect();
    if (!account || !walletClient) throw new Error("Connect an EVM wallet first.");
    await ensureChain();
    const { operationId, ...transaction } = request;
    const identity = `${robinhoodChain.id}:${account.toLowerCase()}:swap:${operationId ?? keccak256(request.data)}`;
    const hash = await runRecoverableTransaction({
      identity,
      broadcast: () => walletClient.sendTransaction({ ...transaction, account, chain: robinhoodChain }),
      confirm: async (hash) => (await publicClient.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 120_000 })).status,
    });
    await refreshBalance();
    return hash;
  }, [address, connect, ensureChain, refreshBalance, walletClient]);

  useEffect(() => {
    if (!provider) return;
    void provider.request({ method: "eth_accounts" }).then((accounts) => {
      const first = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : null;
      if (first) setAddress(getAddress(first));
    }).catch(() => undefined);
    const eventProvider = provider as EIP1193Provider & {
      on?: (event: string, listener: (value: unknown) => void) => void;
      removeListener?: (event: string, listener: (value: unknown) => void) => void;
    };
    const handleAccountsChanged = (value: unknown) => {
      const accounts = Array.isArray(value) ? value : [];
      const first = typeof accounts[0] === "string" ? accounts[0] : null;
      setAddress(first ? getAddress(first) : null);
      if (!first) {
        setBalanceWei(null);
        setBalanceEth(null);
      }
    };
    eventProvider.on?.("accountsChanged", handleAccountsChanged);
    return () => eventProvider.removeListener?.("accountsChanged", handleAccountsChanged);
  }, [provider]);

  useEffect(() => { void refreshBalance(); }, [refreshBalance]);

  return {
    address,
    shortAddress: address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "",
    balanceWei,
    balanceEth,
    connecting,
    refreshing,
    error,
    connect,
    disconnect,
    refreshBalance,
    signMessage,
    writeContract,
    sendTransaction,
  };
}
