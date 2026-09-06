#!/usr/bin/env bash
#
# Generate the Base Sepolia operator key and write it straight to contracts/.env.
#
# Prints ONLY the address. The private key is never displayed, so it cannot end
# up in a terminal screenshot, a shell history, or a chat transcript.
#
# TESTNET ONLY. This key opens markets and declares winners, so leaking it leaks
# settlement authority, not just funds. Never reuse it on mainnet.
#
#   ./new-operator-key.sh
#   <fund the printed address from a Base Sepolia faucet>
#   forge script script/LifecycleBaseSepolia.s.sol:LifecycleBaseSepolia \
#     --rpc-url https://sepolia.base.org --skip-simulation --broadcast -vvv
#
set -euo pipefail
cd "$(dirname "$0")"

if [ -f .env ] && grep -qE '^BASE_SEPOLIA_PRIVATE_KEY=.+' .env; then
  echo "contracts/.env already holds a key."
  echo "Address: $(grep -E '^BASE_SEPOLIA_PRIVATE_KEY=' .env | cut -d= -f2 | xargs cast wallet address --private-key)"
  echo
  echo "To replace it, delete contracts/.env first."
  exit 1
fi

cast wallet new --json | python3 -c '
import json, sys, os
w = json.load(sys.stdin)[0]
fd = os.open(".env", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f:
    f.write("BASE_SEPOLIA_PRIVATE_KEY=" + w["private_key"] + "\n")
print(w["address"])
' > .operator-address

echo "Operator key written to contracts/.env (mode 600, gitignored)."
echo
echo "Fund this address from a Base Sepolia faucet:"
echo
echo "    $(cat .operator-address)"
echo
echo "Faucets: https://www.alchemy.com/faucets/base-sepolia"
echo "         https://faucet.quicknode.com/base/sepolia"
echo
echo "0.0005 ETH is enough for the whole run: 0.0004 in bets and ~0.00007 in gas."
echo "Base Sepolia gas is 0.006 gwei, so almost any drip covers it."
rm -f .operator-address
