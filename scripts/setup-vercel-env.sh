#!/bin/bash
#
# Push environment variables to Vercel from .env.local
# Requires: vercel CLI installed and logged in (npx vercel login)
#
# Usage:
#   bash scripts/setup-vercel-env.sh [--vercel-url https://your-app.vercel.app]
#
# This reads .env.local and pushes each variable to Vercel for production.
# You'll be prompted to override MCP_GATEWAY_URL and NEXTAUTH_URL with production values.

set -euo pipefail

VERCEL_URL="${1:-}"

if [ ! -f .env.local ]; then
  echo "Error: .env.local not found. Run from the project root."
  exit 1
fi

echo "=== Vercel Environment Setup ==="
echo ""

# Read production overrides
if [ -z "$VERCEL_URL" ]; then
  read -rp "Your Vercel app URL (e.g. https://dashboarder.vercel.app): " VERCEL_URL
fi

read -rp "Railway MCP gateway URL [https://sdmx-mcp-gateway-production.up.railway.app/mcp]: " MCP_URL
MCP_URL="${MCP_URL:-https://sdmx-mcp-gateway-production.up.railway.app/mcp}"

echo ""
echo "Setting environment variables for production..."
echo ""

# Read .env.local and push each var
while IFS= read -r line; do
  # Skip comments and empty lines
  [[ -z "$line" || "$line" == \#* ]] && continue

  key="${line%%=*}"
  value="${line#*=}"

  # Override production-specific values
  case "$key" in
    MCP_GATEWAY_URL)
      value="$MCP_URL"
      ;;
    NEXTAUTH_URL)
      value="$VERCEL_URL"
      ;;
  esac

  echo "  Setting $key..."
  echo "$value" | npx vercel env add "$key" production --force 2>/dev/null || \
    echo "    (may already exist — skipping)"

done < .env.local

echo ""
echo "Done. Run 'npx vercel --prod' to deploy, or push to main for auto-deploy."
