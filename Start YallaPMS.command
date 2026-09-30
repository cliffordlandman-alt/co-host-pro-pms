#!/bin/zsh
cd -- "${0:A:h}"
if command -v node >/dev/null 2>&1; then
  exec node scripts/dev.mjs
fi
print 'Install Node.js 24 and pnpm 11, then follow START-HERE.md.'
read '?Press Return to close.'
