#!/usr/bin/env node

console.error(`This script is deprecated.

Reason:
- it tests direct team creation instead of the supported join flow
- it does not reflect free / balance-funded / contract-backed join behavior

Use instead:
  npm run test:onchain-prize-flow
`);
process.exit(1);
