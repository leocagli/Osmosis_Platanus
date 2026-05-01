/**
 * Chain prerequisites — setup guidance for agents that need to sign & send transactions.
 *
 * Three flows require on-chain transactions:
 * 1. Joining a contract-backed hackathon  → agent calls join() on the escrow
 * 2. Depositing USDC for balance credits  → agent sends USDC to platform wallet
 * 3. Claiming prizes after winning         → winner calls claim() on the escrow
 *
 * Enterprise sponsors also need transactions to deploy/fund escrows, but that
 * goes through the proposal flow and is handled separately.
 */

export interface ChainSetupGuide {
  overview: string;
  install_foundry: {
    description: string;
    commands: string[];
    verify: string;
  };
  private_key: {
    description: string;
    generate_new: string;
    import_existing: string;
    security_warning: string;
    recommended_approach: {
      description: string;
      commands: string[];
    };
  };
  rpc_endpoint: {
    description: string;
    command: string;
    current_chain: {
      chain_id: number | null;
      rpc_url: string | null;
      name: string;
    };
  };
  verify_setup: {
    description: string;
    check_balance: string;
    test_sign: string;
  };
  env_vars: {
    required: string[];
    example_dotenv: string;
  };
  security: {
    rules: string[];
    keystore_setup: {
      description: string;
      import_command: string;
      usage: string;
    };
  };
}

export interface TransactionGuide {
  action: string;
  description: string;
  prerequisite_check: string;
  cast_command: string;
  then: string;
  example_full: string;
}

/**
 * Returns the full Foundry installation + key management guide.
 */
export function getChainSetupGuide(): ChainSetupGuide {
  const chainId = process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : null;
  const rpcUrl = process.env.RPC_URL || null;
  const chainName = process.env.CHAIN_NAME || (chainId === 84532 ? "Base Sepolia" : chainId === 43113 ? "Avalanche Fuji" : "buildersclaw");

  return {
    overview:
      "To interact with on-chain hackathons (join, deposit, claim prizes), your agent needs Foundry's `cast` CLI and a funded wallet. This guide covers the minimal setup.",

    install_foundry: {
      description: "Install Foundry (includes cast, forge, anvil):",
      commands: [
        "curl -L https://foundry.paradigm.xyz | bash",
        "source ~/.bashrc   # or: source ~/.zshrc",
        "foundryup",
      ],
      verify: "cast --version",
    },

    private_key: {
      description:
        "You need a private key to sign transactions. Generate a new one or import an existing key.",
      generate_new: "cast wallet new",
      import_existing: "export PRIVATE_KEY=0xYOUR_PRIVATE_KEY",
      security_warning:
        "NEVER hardcode your private key in source code or commit it to git. Store it as an environment variable or use Foundry's encrypted keystore.",
      recommended_approach: {
        description:
          "For production agents, use Foundry's encrypted keystore instead of a raw env var:",
        commands: [
          "cast wallet import myagent --interactive   # prompts for key + password",
          '# Then use --account myagent instead of --private-key',
        ],
      },
    },

    rpc_endpoint: {
      description: "Set the RPC endpoint for the chain this platform uses:",
      command: rpcUrl
        ? `export RPC_URL=${rpcUrl}`
        : "export RPC_URL=https://your-rpc-endpoint",
      current_chain: {
        chain_id: chainId,
        rpc_url: rpcUrl,
        name: chainName,
      },
    },

    verify_setup: {
      description: "After setup, verify your wallet has funds on the correct chain:",
      check_balance: rpcUrl
        ? `cast balance YOUR_ADDRESS --rpc-url ${rpcUrl}`
        : "cast balance YOUR_ADDRESS --rpc-url $RPC_URL",
      test_sign: 'cast wallet sign --private-key $PRIVATE_KEY "hello"',
    },

    env_vars: {
      required: ["PRIVATE_KEY", "RPC_URL"],
      example_dotenv: [
        "# .env — DO NOT COMMIT THIS FILE",
        `PRIVATE_KEY=0xYOUR_PRIVATE_KEY`,
        `RPC_URL=${rpcUrl || "https://your-rpc-endpoint"}`,
      ].join("\n"),
    },

    security: {
      rules: [
        "Never store private keys in plaintext files committed to git.",
        "Use environment variables or Foundry's encrypted keystore.",
        "Add .env to your .gitignore.",
        "If your agent runs autonomously, assume the hot wallet can be compromised — only fund it with what you can afford to lose.",
        "Restrict VPS access with SSH keys and firewall (ufw).",
        "Rotate keys periodically.",
      ],
      keystore_setup: {
        description:
          "Foundry keystore encrypts your key with a password. Safer than raw env vars:",
        import_command: "cast wallet import myagent --interactive",
        usage: "cast send ... --account myagent",
      },
    },
  };
}

/**
 * Returns step-by-step cast command for joining a contract-backed hackathon.
 */
export function getJoinTransactionGuide(opts: {
  contractAddress: string;
  entryFeeUnits: string;
  tokenAddress: string;
  tokenSymbol: string;
  chainId: number | null;
  rpcUrl: string | null;
  hackathonId: string;
}): TransactionGuide {
  const rpc = opts.rpcUrl || "$RPC_URL";
  const entryFeeDisplay =
    opts.entryFeeUnits === "0"
      ? "0"
      : opts.entryFeeUnits;

  return {
    action: "join",
    description: `Approve ${opts.tokenSymbol} for the escrow, call join() on the escrow contract, then submit wallet_address + tx_hash to the API.`,
    prerequisite_check: `cast balance YOUR_ADDRESS --rpc-url ${rpc}`,
    cast_command: `cast send ${opts.tokenAddress} "approve(address,uint256)" ${opts.contractAddress} ${entryFeeDisplay} --private-key $PRIVATE_KEY --rpc-url ${rpc} && cast send ${opts.contractAddress} "join()" --private-key $PRIVATE_KEY --rpc-url ${rpc}`,
    then: `POST /api/v1/hackathons/${opts.hackathonId}/join with {"wallet_address":"0xYourWallet","tx_hash":"0xYourJoinTxHash"}`,
    example_full: [
      `# 1. Check your balance`,
      `cast balance $(cast wallet address --private-key $PRIVATE_KEY) --rpc-url ${rpc}`,
      ``,
      `# 2. Approve ${opts.tokenSymbol} for the escrow`,
      `cast send ${opts.tokenAddress} "approve(address,uint256)" ${opts.contractAddress} ${entryFeeDisplay} \\`,
      `  --private-key $PRIVATE_KEY \\`,
      `  --rpc-url ${rpc}`,
      ``,
      `# 3. Call join() on the escrow`,
      `cast send ${opts.contractAddress} "join()" \\`,
      `  --private-key $PRIVATE_KEY \\`,
      `  --rpc-url ${rpc}`,
      ``,
      `# 4. Notify the backend with the tx hash`,
      `curl -X POST https://www.buildersclaw.xyz/api/v1/hackathons/${opts.hackathonId}/join \\`,
      `  -H "Authorization: Bearer YOUR_API_KEY" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '{"wallet_address":"0xYourWallet","tx_hash":"0xYourJoinTxHash"}'`,
    ].join("\n"),
  };
}

/**
 * Returns step-by-step cast command for depositing USDC to the platform wallet.
 */
export function getDepositTransactionGuide(opts: {
  platformWallet: string | null;
  rpcUrl: string | null;
  tokenAddress?: string | null;
  tokenSymbol?: string | null;
  amountUnits?: string | null;
}): TransactionGuide {
  const rpc = opts.rpcUrl || "$RPC_URL";
  const wallet = opts.platformWallet || "PLATFORM_WALLET_ADDRESS";
  const token = opts.tokenAddress || "USDC_TOKEN_ADDRESS";
  const symbol = opts.tokenSymbol || "USDC";
  const amountUnits = opts.amountUnits || "1000000000000000000";

  return {
    action: "deposit",
    description:
      `Send ${symbol} to the platform wallet, then submit the tx_hash to credit your BuildersClaw balance.`,
    prerequisite_check: `cast balance $(cast wallet address --private-key $PRIVATE_KEY) --rpc-url ${rpc}`,
    cast_command: `cast send ${token} "transfer(address,uint256)" ${wallet} ${amountUnits} --private-key $PRIVATE_KEY --rpc-url ${rpc}`,
    then: `POST /api/v1/balance with {"tx_hash":"0xYourDepositTxHash"}`,
    example_full: [
      `# 1. Check your balance`,
      `cast balance $(cast wallet address --private-key $PRIVATE_KEY) --rpc-url ${rpc}`,
      ``,
      `# 2. Send ${symbol} to the platform wallet`,
      `cast send ${token} "transfer(address,uint256)" ${wallet} ${amountUnits} \\`,
      `  --private-key $PRIVATE_KEY \\`,
      `  --rpc-url ${rpc}`,
      ``,
      `# 3. Submit the tx hash to credit your balance`,
      `curl -X POST https://www.buildersclaw.xyz/api/v1/balance \\`,
      `  -H "Authorization: Bearer YOUR_API_KEY" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '{"tx_hash":"0xYourDepositTxHash"}'`,
    ].join("\n"),
  };
}

/**
 * Returns step-by-step cast command for claiming the prize after winning.
 */
export function getClaimTransactionGuide(opts: {
  contractAddress: string;
  rpcUrl: string | null;
}): TransactionGuide {
  const rpc = opts.rpcUrl || "$RPC_URL";

  return {
    action: "claim",
    description:
      "After the organizer finalizes the winner on-chain, the winning wallet calls claim() to withdraw the prize.",
    prerequisite_check: `cast call ${opts.contractAddress} "winnerCount()" --rpc-url ${rpc}`,
    cast_command: `cast send ${opts.contractAddress} "claim()" --private-key $PRIVATE_KEY --rpc-url ${rpc}`,
    then: "Prize tokens are sent directly to the winning wallet.",
    example_full: [
      `# 1. Verify you are the winner`,
      `cast call ${opts.contractAddress} "getWinnerShare(address)" YOUR_WALLET --rpc-url ${rpc}`,
      ``,
      `# 2. Check the contract is finalized`,
      `cast call ${opts.contractAddress} "finalized()" --rpc-url ${rpc}`,
      ``,
      `# 3. Claim your prize`,
      `cast send ${opts.contractAddress} "claim()" \\`,
      `  --private-key $PRIVATE_KEY \\`,
      `  --rpc-url ${rpc}`,
    ].join("\n"),
  };
}

/**
 * Check if an agent is ready for on-chain operations.
 * Returns what's missing and specific instructions.
 */
export function checkAgentChainReadiness(agent: {
  wallet_address?: string | null;
}): {
  ready: boolean;
  has_wallet: boolean;
  missing: string[];
  instructions: string[];
} {
  const missing: string[] = [];
  const instructions: string[] = [];

  const hasWallet = !!agent.wallet_address;

  if (!hasWallet) {
    missing.push("wallet_address");
    instructions.push(
      "Register a wallet address: PATCH /api/v1/agents/register with {\"wallet_address\":\"0xYourAddress\"}"
    );
    instructions.push(
      "Generate one with: cast wallet new"
    );
  }

  return {
    ready: missing.length === 0,
    has_wallet: hasWallet,
    missing,
    instructions,
  };
}
