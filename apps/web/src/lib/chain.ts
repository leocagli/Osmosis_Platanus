import { privateKeyToAccount } from "viem/accounts";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  decodeFunctionData,
  getAddress,
  http,
  isAddress,
  parseAbi,
  type Address,
  type Chain,
  type Hash,
} from "viem";
import { resolveChain } from "@/lib/chain-config";

const factoryAbi = parseAbi([
  "function createHackathon(address _token, uint256 _entryFee, uint256 _deadline) returns (address)",
  "function hackathons(uint256) view returns (address)",
  "function hackathonCount() view returns (uint256)",
  "event HackathonCreated(address indexed escrow, address indexed token, uint256 entryFee, uint256 deadline)",
]);

const escrowAbi = parseAbi([
  "function token() view returns (address)",
  "function entryFee() view returns (uint256)",
  "function hasJoined(address) view returns (bool)",
  "function finalized() view returns (bool)",
  "function owner() view returns (address)",
  "function sponsor() view returns (address)",
  "function deadline() view returns (uint256)",
  "function prizePool() view returns (uint256)",
  "function getWinners() view returns (address[])",
  "function getWinnerShare(address) view returns (uint256)",
  "function winnerCount() view returns (uint256)",
  "function hasClaimed(address) view returns (bool)",
  "function totalPrizeAtFinalize() view returns (uint256)",
  "function join()",
  "function fund(uint256 amount)",
  "function finalize(address[] _winners, uint256[] _sharesBps)",
  "function abort()",
  "event Joined(address indexed participant)",
  "event Funded(address indexed sponsor, uint256 amount)",
]);

const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

let cachedChain: Chain | null = null;
let cachedPublicClient: ReturnType<typeof createPublicClient> | null = null;
let cachedWalletClient: ReturnType<typeof createWalletClient> | null = null;

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

export function getUsdcAddress(): Address {
  return normalizeAddress(requireEnv("USDC_ADDRESS"));
}

export function getUsdcDecimals(): number {
  const parsed = Number.parseInt(process.env.USDC_DECIMALS || "18", 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("USDC_DECIMALS must be a non-negative integer");
  }
  return parsed;
}

export function getUsdcSymbol(): string {
  return process.env.USDC_SYMBOL || "USDC";
}

function getChain() {
  if (cachedChain) return cachedChain;

  const rpcUrl = requireEnv("RPC_URL");
  cachedChain = resolveChain({
    chainId: getConfiguredChainId(),
    rpcUrl,
    fallbackName: process.env.CHAIN_NAME || "buildersclaw",
    fallbackCurrencyName: process.env.CHAIN_CURRENCY_NAME || "BNB",
    fallbackCurrencySymbol: process.env.CHAIN_CURRENCY_SYMBOL || "BNB",
  });
  return cachedChain;
}

export function getPublicChainClient() {
  if (cachedPublicClient) return cachedPublicClient;
  const client = createPublicClient({
    chain: getChain(),
    transport: http(requireEnv("RPC_URL")),
  });
  cachedPublicClient = client;
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
  cachedWalletClient = client;
  return cachedWalletClient;
}

export function normalizeAddress(value: string): Address {
  if (!isAddress(value)) throw new Error(`Invalid address: ${value}`);
  return getAddress(value);
}

export function sameAddress(left: string, right: string) {
  return getAddress(left) === getAddress(right);
}

function getTransferValueFromReceipt(opts: {
  receipt: { logs: Array<{ address?: string | null; data: `0x${string}`; topics: readonly `0x${string}`[] }> };
  tokenAddress: Address;
  from: Address;
  to: Address;
}): bigint {
  let total = BigInt(0);

  for (const log of opts.receipt.logs) {
    if (!log.address || !sameAddress(log.address, opts.tokenAddress)) continue;
    if (log.topics.length === 0) continue;
    try {
      const decoded = decodeEventLog({
        abi: erc20Abi,
        data: log.data,
        topics: [...log.topics] as [`0x${string}`, ...`0x${string}`[]],
      });
      if (decoded.eventName !== "Transfer") continue;
      const args = decoded.args as { from: Address; to: Address; value: bigint };
      if (sameAddress(args.from, opts.from) && sameAddress(args.to, opts.to)) {
        total += args.value;
      }
    } catch {
      continue;
    }
  }

  return total;
}

export async function getEscrowTokenConfig(contractAddress: string) {
  const publicClient = getPublicChainClient();
  const address = normalizeAddress(contractAddress);
  const tokenAddress = await publicClient.readContract({
    address,
    abi: escrowAbi,
    functionName: "token",
  }) as Address;

  const [symbol, decimals] = await Promise.all([
    publicClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "symbol" }).catch(() => getUsdcSymbol()),
    publicClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "decimals" }).catch(() => getUsdcDecimals()),
  ]);

  return { tokenAddress, symbol: symbol as string, decimals: Number(decimals) };
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

  const [entryFee, tokenAddress, hasJoined] = await Promise.all([
    publicClient.readContract({ address: contractAddress, abi: escrowAbi, functionName: "entryFee" }),
    publicClient.readContract({ address: contractAddress, abi: escrowAbi, functionName: "token" }),
    publicClient.readContract({
      address: contractAddress,
      abi: escrowAbi,
      functionName: "hasJoined",
      args: [walletAddress],
    }),
  ]);

  const transferred = getTransferValueFromReceipt({
    receipt,
    tokenAddress: tokenAddress as Address,
    from: walletAddress,
    to: contractAddress,
  });

  if (transferred !== (entryFee as bigint)) {
    throw new Error("Join transaction token transfer does not match the contract entry fee");
  }
  if (!hasJoined) throw new Error("Wallet is not marked as joined on-chain");

  return { transaction, receipt, entryFee, tokenAddress };
}

export async function verifyDepositTransaction(options: {
  txHash: string;
  expectedFrom: string;
}) {
  const publicClient = getPublicChainClient();
  const txHash = options.txHash as Hash;
  const expectedFrom = normalizeAddress(options.expectedFrom);

  const transaction = await publicClient.getTransaction({ hash: txHash }).catch(() => null);
  if (!transaction) throw new Error("Deposit transaction not found");

  const receipt = await publicClient.getTransactionReceipt({ hash: txHash }).catch(() => null);
  if (!receipt) throw new Error("Deposit transaction receipt not found");
  if (receipt.status !== "success") throw new Error("Deposit transaction failed on-chain");

  const organizerWallet = getOrganizerWalletClient();
  const treasuryAddress = normalizeAddress(organizerWallet.account!.address);
  const tokenAddress = getUsdcAddress();

  if (!sameAddress(transaction.from, expectedFrom)) {
    throw new Error("Deposit transaction sender does not match your registered wallet_address");
  }

  const transferred = getTransferValueFromReceipt({
    receipt,
    tokenAddress,
    from: expectedFrom,
    to: treasuryAddress,
  });

  if (transferred <= BigInt(0)) {
    throw new Error(`Transaction has no ${getUsdcSymbol()} transfer to the platform treasury`);
  }

  return {
    from: transaction.from,
    to: treasuryAddress,
    value: transferred,
    blockNumber: Number(receipt.blockNumber),
    txHash: options.txHash,
    tokenAddress,
    decimals: getUsdcDecimals(),
    symbol: getUsdcSymbol(),
  };
}

export async function getContractPrizePool(contractAddress: string): Promise<bigint> {
  const publicClient = getPublicChainClient();
  const addr = normalizeAddress(contractAddress);
  return await publicClient.readContract({
    address: addr,
    abi: escrowAbi,
    functionName: "prizePool",
  }) as bigint;
}

export async function finalizeHackathonOnChain(options: {
  contractAddress: string;
  winners: { wallet: string; shareBps: number }[];
}) {
  const txHash = await broadcastFinalizeHackathonOnChain(options);
  const receipt = await waitForFinalizeReceipt(txHash);
  return { txHash, receipt };
}

export async function broadcastFinalizeHackathonOnChain(options: {
  contractAddress: string;
  winners: { wallet: string; shareBps: number }[];
}) {
  const publicClient = getPublicChainClient();
  const walletClient = getOrganizerWalletClient();
  const contractAddress = normalizeAddress(options.contractAddress);

  if (options.winners.length === 0) throw new Error("No winners provided");

  const totalBps = options.winners.reduce((sum, w) => sum + w.shareBps, 0);
  if (totalBps !== 10000) throw new Error(`Winner shares must sum to 10000, got ${totalBps}`);

  const winnerAddresses = options.winners.map((w) => normalizeAddress(w.wallet));
  const winnerShares = options.winners.map((w) => BigInt(w.shareBps));

  const finalized = await publicClient.readContract({
    address: contractAddress,
    abi: escrowAbi,
    functionName: "finalized",
  });
  if (finalized) throw new Error("Hackathon contract is already finalized");

  const txHash = await walletClient.writeContract({
    address: contractAddress,
    abi: escrowAbi,
    functionName: "finalize",
    args: [winnerAddresses, winnerShares],
    account: walletClient.account!,
    chain: walletClient.chain,
  });

  return txHash;
}

export async function waitForFinalizeReceipt(txHash: string) {
  const publicClient = getPublicChainClient();
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as Hash });
  if (receipt.status !== "success") throw new Error("Finalize transaction failed on-chain");

  return receipt;
}

export async function deployHackathonEscrow(options: {
  entryFeeUnits: bigint;
  deadlineUnix: bigint;
  fundingUnits?: bigint;
  tokenAddress?: string;
}): Promise<{ escrowAddress: string; txHash: string; fundingTxHash?: string }> {
  const factoryAddress = process.env.FACTORY_ADDRESS;
  if (!factoryAddress) throw new Error("FACTORY_ADDRESS not configured");

  const publicClient = getPublicChainClient();
  const walletClient = getOrganizerWalletClient();
  const factory = normalizeAddress(factoryAddress);
  const token = options.tokenAddress ? normalizeAddress(options.tokenAddress) : getUsdcAddress();

  const txHash = await walletClient.writeContract({
    address: factory,
    abi: factoryAbi,
    functionName: "createHackathon",
    args: [token, options.entryFeeUnits, options.deadlineUnix],
    account: walletClient.account!,
    chain: walletClient.chain,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error("Factory createHackathon transaction failed");

  let escrowAddress: string | null = null;
  for (const log of receipt.logs) {
    if (log.address && sameAddress(log.address, factory) && log.topics.length >= 2 && log.topics[1]) {
      escrowAddress = getAddress(`0x${log.topics[1].slice(26)}`);
      break;
    }
  }

  if (!escrowAddress) throw new Error("Could not find escrow address in transaction logs");

  let fundingTxHash: string | undefined;
  if ((options.fundingUnits ?? BigInt(0)) > BigInt(0)) {
    fundingTxHash = await walletClient.writeContract({
      address: token,
      abi: parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]),
      functionName: "approve",
      args: [normalizeAddress(escrowAddress), options.fundingUnits!],
      account: walletClient.account!,
      chain: walletClient.chain,
    });

    await publicClient.waitForTransactionReceipt({ hash: fundingTxHash as Hash });

    const fundCallHash = await walletClient.writeContract({
      address: normalizeAddress(escrowAddress),
      abi: escrowAbi,
      functionName: "fund",
      args: [options.fundingUnits!],
      account: walletClient.account!,
      chain: walletClient.chain,
    });

    await publicClient.waitForTransactionReceipt({ hash: fundCallHash });
    fundingTxHash = fundCallHash;
  }

  return { escrowAddress, txHash, fundingTxHash };
}

export async function verifySponsorFunding(options: {
  contractAddress: string;
  sponsorWallet: string;
  txHash: string;
}): Promise<{ prizePoolUnits: bigint; blockNumber: number; tokenAddress: Address }> {
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

  const decoded = decodeFunctionData({ abi: escrowAbi, data: transaction.input });
  if (decoded.functionName !== "fund") {
    throw new Error("Funding transaction is not a HackathonEscrow fund(amount) call");
  }

  const [tokenAddress, onChainSponsor, onChainOwner, prizePoolUnits] = await Promise.all([
    publicClient.readContract({ address: contractAddr, abi: escrowAbi, functionName: "token" }),
    publicClient.readContract({ address: contractAddr, abi: escrowAbi, functionName: "sponsor" }),
    publicClient.readContract({ address: contractAddr, abi: escrowAbi, functionName: "owner" }),
    publicClient.readContract({ address: contractAddr, abi: escrowAbi, functionName: "prizePool" }),
  ]);

  if (!sameAddress(onChainSponsor as string, sponsorAddr)) {
    throw new Error("Contract sponsor does not match provided wallet");
  }

  const organizerWallet = getOrganizerWalletClient();
  const platformAddress = normalizeAddress(organizerWallet.account!.address);
  if (!sameAddress(onChainOwner as string, platformAddress)) {
    throw new Error("Contract owner does not match platform organizer wallet");
  }

  const transferred = getTransferValueFromReceipt({
    receipt,
    tokenAddress: tokenAddress as Address,
    from: sponsorAddr,
    to: contractAddr,
  });

  const requestedAmount = (decoded.args?.[0] ?? BigInt(0)) as bigint;
  if (transferred !== requestedAmount || transferred <= BigInt(0)) {
    throw new Error("Funding transaction token transfer does not match the requested fund amount");
  }

  return {
    prizePoolUnits: prizePoolUnits as bigint,
    blockNumber: Number(receipt.blockNumber),
    tokenAddress: tokenAddress as Address,
  };
}
