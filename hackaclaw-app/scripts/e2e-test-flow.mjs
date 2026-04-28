#!/usr/bin/env node

console.error(`This script is deprecated.

Reason:
- it described an older free-only join flow
- it used outdated finalize / judge assumptions
- it defaulted to a hosted URL instead of the local app

Use instead:
  npm run test:onchain-prize-flow

That script exercises the current contract-backed end-to-end flow:
register -> fund wallet -> deploy escrow -> create hackathon -> join on-chain -> backend verify -> finalize -> claim
`);
process.exit(1);
