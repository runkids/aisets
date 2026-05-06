#!/usr/bin/env bash
set -euo pipefail

cat > /etc/profile.d/asset-studio-path.sh << 'PROFILE_EOF'
case ":$PATH:" in
  *:/usr/local/go/bin:*) ;;
  *) export PATH="/go/bin:/usr/local/go/bin:$PATH" ;;
esac
case ":$PATH:" in
  *:/workspace/.devcontainer/bin:*) ;;
  *) export PATH="/workspace/.devcontainer/bin:/workspace/bin:$PATH" ;;
esac
PROFILE_EOF

echo "Dev servers ready:"
echo "  ui /workspace            # API :19520 + Vite :5174, open browser when available"
echo "  ui --app /workspace      # open app window when a browser exists in the container"
echo "  ui --no-open /workspace  # start servers only"
echo "  ui stop                  # stop API + Vite"
