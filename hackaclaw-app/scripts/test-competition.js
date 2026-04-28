#!/usr/bin/env node

console.error(`This script is deprecated.

Reason:
- it depends on old prompt-round and direct team-creation flows
- it assumes outdated judging auth and status transitions
- it no longer reflects the supported contract-backed participation flow

Use instead:
  npm run test:onchain-prize-flow
`);
process.exit(1);
