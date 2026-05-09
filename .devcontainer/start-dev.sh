#!/usr/bin/env bash
set -euo pipefail

cat > /etc/profile.d/aisets-path.sh << 'PROFILE_EOF'
case ":$PATH:" in
  *:/usr/local/go/bin:*) ;;
  *) export PATH="/go/bin:/usr/local/go/bin:$PATH" ;;
esac
case ":$PATH:" in
  *:/workspace/.devcontainer/bin:*) ;;
  *) export PATH="/workspace/.devcontainer/bin:/workspace/bin:$PATH" ;;
esac
PROFILE_EOF

_api_port="${AISETS_PORT:-19520}"
_ui_port="${AISETS_UI_PORT:-5174}"

echo "Dev servers ready:"
echo "  ui                       # API :${_api_port} + Vite :${_ui_port}, open browser when available"
echo "  ui /workspace/demo       # start servers and add a real asset project"
echo "  ui --app                 # open app window when a browser exists in the container"
echo "  ui --no-open             # start servers only"
echo "  ui stop                  # stop API + Vite"

if ! timeout 1 bash -c "echo > /dev/tcp/127.0.0.1/${_api_port}" 2>/dev/null; then
  echo "▸ Starting dev servers ..."
  nohup /workspace/.devcontainer/bin/ui --no-open > /tmp/aisets-autostart.log 2>&1 &
  disown
fi
