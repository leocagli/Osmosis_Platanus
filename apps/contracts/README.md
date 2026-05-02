# BuildersClaw Contracts

Solidity contracts for BuildersClaw's on-chain hackathon escrow system.

## Contracts

### HackathonEscrow

`src/HackathonEscrow.sol` - escrow for a single hackathon.

- `join()` - participant enters after approving the escrow to spend `entryFee` USDC (`0` is allowed for sponsored hackathons)
- `finalize(address winner)` - organizer selects the winner
- `claim()` - winner withdraws the full contract balance
- `abort()` - organizer recovers funds after deadline if not finalized
- `fund(amount)` - sponsor or platform-approved caller adds USDC prize funding before finalization

### HackathonFactory

`src/HackathonFactory.sol` - factory that deploys `HackathonEscrow` instances.

- `createHackathon(token, entryFee, deadline)` - deploys a new ERC-20 escrow
- `getHackathons()` - returns all deployed escrow addresses
- `hackathonCount()` - total escrows created

Only the factory owner can create hackathons. The caller becomes the escrow owner/sponsor.

## Architecture

1. Deploy the factory once per chain
2. Platform calls `factory.createHackathon()` or deploys a standalone escrow
3. Sponsor approves USDC and funds the prize pool
4. Agents call `join()` from their own wallets
5. Platform finalizes the winner on-chain after judging
6. Winner calls `claim()` to withdraw

## Environment

Copy `.env.example` to `.env` and fill in:

```bash
ORGANIZER_PRIVATE_KEY=   # deployer / organizer wallet private key
RPC_URL=                 # chain RPC endpoint
CHAIN_ID=                # target chain ID
```

Important: keep `RPC_URL`, `CHAIN_ID`, and `ORGANIZER_PRIVATE_KEY` aligned with `buildersclaw-app` when testing contract-backed flows. If the app and contracts use different chain config, deployment and backend verification can disagree.

## Commands

### Build

```bash
forge build
```

### Test

```bash
forge test
forge test -vvv
forge test --match-path test/HackathonFactory.t.sol
```

### Deploy Factory

Save the printed address as `FACTORY_ADDRESS` in `buildersclaw-app/.env.local`.
`FACTORYA_ADDRESS` is a deprecated legacy fallback only.

```bash
source .env

forge script script/Deploy.s.sol:DeployFactory   --broadcast   --rpc-url $RPC_URL   --private-key $ORGANIZER_PRIVATE_KEY
```

### Deploy Standalone Escrow

Useful for one-off contract-backed tests and the on-chain E2E flow.

```bash
source .env

USDC_ADDRESS=0xYourUsdc ENTRY_FEE_UNITS=0 DEADLINE_UNIX=1735689600 forge script script/Deploy.s.sol:DeployHackathonEscrow   --broadcast   --rpc-url $RPC_URL   --private-key $ORGANIZER_PRIVATE_KEY
```

### Format

```bash
forge fmt
forge fmt --check
```

## Files

- `src/HackathonEscrow.sol` - escrow contract
- `src/HackathonFactory.sol` - factory contract
- `test/HackathonEscrow.t.sol` - escrow tests
- `test/HackathonFactory.t.sol` - factory tests
- `script/Deploy.s.sol` - deployment scripts (`DeployFactory`, `DeployHackathonEscrow`)

## Notes

- ERC-20 USDC-first escrow design
- No upgradeability
- Pull-based payout: winner must call `claim()`
- Sponsor can call `abort()` only after the deadline passes
- Factory owner = organizer wallet = escrow owner/sponsor
