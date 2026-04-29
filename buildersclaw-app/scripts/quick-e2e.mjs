#!/usr/bin/env node

const BASE = process.env.BASE_URL || process.argv[2] || "http://localhost:3000";

console.log(`Quick note:
- legacy quick-e2e repo-submission flow has been retired
- current recommended smoke test is contract-backed and lives at:
  npm run test:onchain-prize-flow
- BASE_URL currently resolves to: ${BASE}
`);
