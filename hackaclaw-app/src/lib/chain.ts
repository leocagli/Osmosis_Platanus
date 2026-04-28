import { privateKeyToAccount } from "viem/accounts";
import {
  createPublicClient,
  createWalletClient,
  decodeFunctionData,
  defineChain,
  getAddress,
  http,
  isAddress,
  parseAbi,
  type Address,
  type Hash,
} from "viem";

const factoryAbi = parseAbi([
  "function createHackathon(uint256 _entryFee, uint256 _deadline) payable returns (address)",
  "function hackathons(uint256) view returns (address)",
  "function hackathonCount() view returns (uint256)",
  "event HackathonCreated(address indexed escrow, uint256 entryFee, uint256 deadline)",
]);

const escrowAbi = parseAbi([
  "function entryFee() view returns (uint256)",
  "function hasJoined(address) view returns (bool)",
  "function finalized() view returns (bool)",
  "function winner() view returns (address)",
  "function owner() view returns (address)",
  "function sponsor() view returns (address)",
  "function deadline() view returns (uint256)",
  "function prizePool() view returns (uint256)",
  "function join() payable",
  "function finalize(address _winner)",
  "function abort()",
]);

let cachedChain: ReturnType<typeof defineChain> | null = null;
let cachedPublicClient: any = null;
let cachedWalletClient: any = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function getConfiguredChainId(): number {
  const parsed = Number.parseInt(requireEnv("CHAIN_ID"), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("CHAIN_ID must be a positive integer");
  }
  return parsed;
}

function getChain() {
  if (cachedChain) return cachedChain;

  const rpcUrl = requireEnv("RPC_URL");
  cachedChain = defineChain({
    id: getConfiguredChainId(),
    name: "hackaclaw",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  return cachedChain;
}

export function getPublicChainClient() {
  if (cachedPublicClient) return cachedPublicClient;
  const client = createPublicClient({
    chain: getChain(),
    transport: http(requireEnv("RPC_URL")),
  });
  cachedPublicClient = client as ReturnType<typeof createPublicClient>;
  return cachedPublicClient;
}

export function getOrganizerWalletClient() {
  if (cachedWalletClient) return cachedWalletClient;
  const rawPrivateKey = requireEnv("ORGANIZER_PRIVATE_KEY");
  const privateKey = rawPrivateKey.startsWith("0x") ? rawPrivateKey : `0x${rawPrivateKey}`;
  const account = privateKeyToAccount(privateKey as Hash);
  const client = createWalletClient({
    account,
    chain: getChain(),
    transport: http(requireEnv("RPC_URL")),
  });
  cachedWalletClient = client as ReturnType<typeof createWalletClient>;
  return cachedWalletClient;
}

export function normalizeAddress(value: string): Address {
  if (!isAddress(value)) throw new Error(`Invalid address: ${value}`);
  return getAddress(value);
}

export function sameAddress(left: string, right: string) {
  return getAddress(left) === getAddress(right);
}

export async function verifyJoinTransaction(options: {
  contractAddress: string;
  walletAddress: string;
  txHash: string;
}) {
  const publicClient = getPublicChainClient();
  const contractAddress = normalizeAddress(options.contractAddress);
  const walletAddress = normalizeAddress(options.walletAddress);
  const txHash = options.txHash as Hash;

  const transaction = await publicClient.getTransaction({ hash: txHash }).catch(() => null);
  if (!transaction) throw new Error("Join transaction not found");

  const receipt = await publicClient.getTransactionReceipt({ hash: txHash }).catch(() => null);
  if (!receipt) throw new Error("Join transaction receipt not found");
  if (receipt.status !== "success") throw new Error("Join transaction failed on-chain");

  if (!transaction.to || !sameAddress(transaction.to, contractAddress)) {
    throw new Error("Join transaction was sent to the wrong contract address");
  }
  if (!sameAddress(transaction.from, walletAddress)) {
    throw new Error("Join transaction sender does not match the provided wallet");
  }

  const decoded = decodeFunctionData({ abi: escrowAbi, data: transaction.input });
  if (decoded.functionName !== "join") {
    throw new Error("Transaction is not a HackathonEscrow join() call");
  }

  const entryFee = await publicClient.readContract({
    address: contractAddress,
    abi: escrowAbi,
    functionName: "entryFee",
  });

  if (transaction.value !== entryFee) {
    throw new Error("Join transaction value does not match the contract entry fee");
  }

  const hasJoined = await publicClient.readContract({
    address: contractAddress,
    abi: escrowAbi,
    functionName: "hasJoined",
    args: [walletAddress],
  });

  if (!hasJoined) throw new Error("Wallet is not marked as joined on-chain");

  return { transaction, receipt, entryFee };
}

/**
 * Verify an ETH deposit transaction to the platform wallet.
 * Used when agents deposit funds for prompt credits.
 */
export async function verifyDepositTransaction(options: {
  txHash: string;
}) {
  const publicClient = getPublicChainClient();
  const txHash = options.txHash as Hash;

  const transaction = await publicClient.getTransaction({ hash: txHash }).catch(() => null);
  if (!transaction) throw new Error("Deposit transaction not found");

  const receipt = await publicClient.getTransactionReceipt({ hash: txHash }).catch(() => null);
  if (!receipt) throw new Error("Deposit transaction receipt not found");
  if (receipt.status !== "success") throw new Error("Deposit transaction failed on-chain");

  // Verify it was sent to our platform wallet
  const organizerWallet = getOrganizerWalletClient();
  const platformAddress = normalizeAddress(organizerWallet.account.address);

  if (!transaction.to || !sameAddress(transaction.to, platformAddress)) {
    throw new Error(
      `Deposit must be sent to the platform wallet: ${platformAddress}. ` +
      `This transaction was sent to: ${transaction.to || "null"}`
    );
  }

  if (transaction.value <= BigInt(0)) {
    throw new Error("Transaction has no ETH value");
  }

  const ethAmount = Number(transaction.value) / 1e18;

  return {
    from: transaction.from,
    to: transaction.to,
    value: transaction.value,
    ethAmount: ethAmount.toFixed(8),
    blockNumber: Number(receipt.blockNumber),
    txHash: options.txHash,
  };
}

export async function getContractPrizePool(contractAddress: string): Promise<bigint> {
  const publicClient = getPublicChainClient();
  const addr = normalizeAddress(contractAddress);
  return await publicClient.getBalance({ address: addr });
}

export async function finalizeHackathonOnChain(options: {
  contractAddress: string;
  winnerWallet: string;
}) {
  const publicClient = getPublicChainClient();
  const walletClient = getOrganizerWalletClient();
  const contractAddress = normalizeAddress(options.contractAddress);
  const winnerWallet = normalizeAddress(options.winnerWallet);

  const finalized = await publicClient.readContract({
    address: contractAddress,
    abi: escrowAbi,
    functionName: "finalized",
  });
  if (finalized) throw new Error("Hackathon contract is already finalized");

  const winnerHasJoined = await publicClient.readContract({
    address: contractAddress,
    abi: escrowAbi,
    functionName: "hasJoined",
    args: [winnerWallet],
  });
  if (!winnerHasJoined) throw new Error("Winner wallet is not marked as joined on-chain");

  const txHash = await walletClient.writeContract({
    address: contractAddress,
    abi: escrowAbi,
    functionName: "finalize",
    args: [winnerWallet],
    account: walletClient.account,
    chain: walletClient.chain,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error("Finalize transaction failed on-chain");

  return { txHash, receipt };
}

/**
 * Deploy a new HackathonEscrow via the on-chain HackathonFactory.
 * Requires FACTORY_ADDRESS env var to be set.
 */
export async function deployHackathonEscrow(options: {
  entryFeeWei: bigint;
  deadlineUnix: bigint;
  fundingWei?: bigint;
}): Promise<{ escrowAddress: string; txHash: string }> {
  const factoryAddress = process.env.FACTORY_ADDRESS || process.env.FACTORYA_ADDRESS;
  if (!factoryAddress) throw new Error("FACTORY_ADDRESS not configured");

  const publicClient = getPublicChainClient();
  const walletClient = getOrganizerWalletClient();
  const factory = normalizeAddress(factoryAddress);

  const txHash = await walletClient.writeContract({
    address: factory,
    abi: factoryAbi,
    functionName: "createHackathon",
    args: [options.entryFeeWei, options.deadlineUnix],
    value: options.fundingWei ?? BigInt(0),
    account: walletClient.account,
    chain: walletClient.chain,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error("Factory createHackathon transaction failed");

  // Extract escrow address from HackathonCreated event log
  // The escrow address is the first indexed param (topics[1]), zero-padded to 32 bytes
  let escrowAddress: string | null = null;
  for (const log of receipt.logs) {
    if (log.address && sameAddress(log.address, factory) && log.topics.length >= 2 && log.topics[1]) {
      // topics[1] is the indexed escrow address, padded to 32 bytes
      escrowAddress = getAddress("0x" + log.topics[1].slice(26));
      break;
    }
  }

  if (!escrowAddress) throw new Error("Could not find escrow address in transaction logs");

  return { escrowAddress, txHash };
}

/**
 * Verify that a sponsor has funded a HackathonEscrow contract.
 * Checks: tx succeeded, sent to contract, from sponsor wallet, value > 0,
 * contract sponsor() matches, and platform organizer is contract owner().
 */
export async function verifySponsorFunding(options: {
  contractAddress: string;
  sponsorWallet: string;
  txHash: string;
}): Promise<{ prizePoolWei: bigint; blockNumber: number }> {
  const publicClient = getPublicChainClient();
  const contractAddr = normalizeAddress(options.contractAddress);
  const sponsorAddr = normalizeAddress(options.sponsorWallet);
  const txHash = options.txHash as Hash;

  const transaction = await publicClient.getTransaction({ hash: txHash }).catch(() => null);
  if (!transaction) throw new Error("Funding transaction not found");

  const receipt = await publicClient.getTransactionReceipt({ hash: txHash }).catch(() => null);
  if (!receipt) throw new Error("Funding transaction receipt not found");
  if (receipt.status !== "success") throw new Error("Funding transaction failed on-chain");

  if (!transaction.to || !sameAddress(transaction.to, contractAddr)) {
    throw new Error("Funding transaction was not sent to the escrow contract");
  }
  if (!sameAddress(transaction.from, sponsorAddr)) {
    throw new Error("Funding transaction sender does not match sponsor wallet");
  }
  if (transaction.value <= BigInt(0)) {
    throw new Error("Funding transaction has no ETH value");
  }

  // Verify contract's sponsor() matches the provided wallet
  const onChainSponsor = await publicClient.readContract({
    address: contractAddr,
    abi: escrowAbi,
    functionName: "sponsor",
  }) as string;
  if (!sameAddress(onChainSponsor, sponsorAddr)) {
    throw new Error("Contract sponsor does not match provided wallet");
  }

  // Verify platform organizer is set as contract owner
  const organizerWallet = getOrganizerWalletClient();
  const platformAddress = normalizeAddress(organizerWallet.account.address);
  const onChainOwner = await publicClient.readContract({
    address: contractAddr,
    abi: escrowAbi,
    functionName: "owner",
  }) as string;
  if (!sameAddress(onChainOwner, platformAddress)) {
    throw new Error(
      `Contract owner must be the platform organizer (${platformAddress}). ` +
      `Found: ${onChainOwner}. Deploy the escrow with _owner set to the platform wallet.`
    );
  }

  // Read current prize pool
  const prizePoolWei = await publicClient.readContract({
    address: contractAddr,
    abi: escrowAbi,
    functionName: "prizePool",
  }) as bigint;

  return {
    prizePoolWei,
    blockNumber: Number(receipt.blockNumber),
  };
}
