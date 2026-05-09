#!/usr/bin/env bash
# Unified devcontainer lifecycle script.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/.devcontainer/docker-compose.yml"
DOTENV_FILE="$PROJECT_ROOT/.devcontainer/.env"
SERVICE="aisets-devcontainer"

write_dotenv() {
  cat > "$DOTENV_FILE" <<EOF
PROJECT_ROOT=${PROJECT_ROOT}
AISETS_PORT=${AISETS_PORT:-19520}
AISETS_UI_PORT=${AISETS_UI_PORT:-5174}
AISETS_LLM_ENDPOINT=${AISETS_LLM_ENDPOINT:-http://host.docker.internal:11434}
EOF
}

usage() {
  echo "Usage: $(basename "$0") <command> [options]"
  echo ""
  echo "Commands:"
  echo "  up        Start devcontainer"
  echo "  shell     Enter running devcontainer shell"
  echo "  down      Stop and remove devcontainer"
  echo "  restart   Restart devcontainer"
  echo "  reset     Stop + remove volumes"
  echo "  status    Show devcontainer status"
  echo "  logs      Tail devcontainer logs"
  echo ""
  echo "Options:"
  echo "  --port N  API port (default: 19520). UI port auto-derives as N-19520+5174."
  echo "            Example: --port 19521 → API 19521, UI 5175"
}

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker is required" >&2
    exit 1
  fi
}

is_docker_port_owner() {
  case "$1" in
    OrbStack|Docker|com.docke*|docker*) return 0 ;;
    *) return 1 ;;
  esac
}

check_host_port_available() {
  local port="$1"
  local role="$2"
  local conflicts=()
  local line command

  if ! command -v lsof >/dev/null 2>&1; then
    return 0
  fi

  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    command="${line%% *}"
    if ! is_docker_port_owner "$command"; then
      conflicts+=("$line")
    fi
  done < <(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | tail -n +2)

  if [[ ${#conflicts[@]} -eq 0 ]]; then
    return 0
  fi

  echo "Error: ${role} port ${port} is already owned by a non-Docker host process:" >&2
  printf '  %s\n' "${conflicts[@]}" >&2
  echo "Stop the process or choose another PORT before starting the devcontainer." >&2
  return 1
}

check_host_ports_available() {
  check_host_port_available "${AISETS_UI_PORT:-5174}" "UI"
  check_host_port_available "${AISETS_PORT:-19520}" "API"
}

parse_port_flag() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --port)
        local api_port="${2:?--port requires a value}"
        export AISETS_PORT="$api_port"
        export AISETS_UI_PORT="$(( api_port - 19520 + 5174 ))"
        export COMPOSE_PROJECT_NAME="aisets_devcontainer_${api_port}"
        shift 2
        ;;
      --port=*)
        local api_port="${1#--port=}"
        export AISETS_PORT="$api_port"
        export AISETS_UI_PORT="$(( api_port - 19520 + 5174 ))"
        export COMPOSE_PROJECT_NAME="aisets_devcontainer_${api_port}"
        shift
        ;;
      *) shift ;;
    esac
  done
}

is_running() {
  local cid
  cid="$(docker compose -f "$COMPOSE_FILE" ps -q "$SERVICE" 2>/dev/null || true)"
  [[ -n "$cid" ]]
}

is_initialised() {
  docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE" \
    test -f /home/developer/.devcontainer-initialized 2>/dev/null
}

cmd_up() {
  require_docker
  cd "$PROJECT_ROOT"
  local ui_port="${AISETS_UI_PORT:-5174}"
  local api_port="${AISETS_PORT:-19520}"
  check_host_ports_available
  echo "▸ Starting devcontainer (UI :${ui_port}  API :${api_port}) ..."
  docker compose -f "$COMPOSE_FILE" up -d --build
  if is_initialised; then
    docker compose -f "$COMPOSE_FILE" exec -T -w /workspace "$SERVICE" \
      bash -c '/workspace/.devcontainer/start-dev.sh'
  else
    docker compose -f "$COMPOSE_FILE" exec -T -w /workspace "$SERVICE" \
      bash -c '/workspace/.devcontainer/setup.sh'
  fi
}

cmd_shell() {
  require_docker
  cd "$PROJECT_ROOT"
  if ! is_running; then
    echo "Devcontainer is not running. Start it with: make devc-up" >&2
    exit 1
  fi
  docker compose -f "$COMPOSE_FILE" exec -w /workspace "$SERVICE" bash -l
}

cmd_down() {
  require_docker
  cd "$PROJECT_ROOT"
  docker compose -f "$COMPOSE_FILE" down
}

cmd_restart() {
  require_docker
  cd "$PROJECT_ROOT"
  check_host_ports_available
  docker compose -f "$COMPOSE_FILE" restart
  docker compose -f "$COMPOSE_FILE" exec -T -w /workspace "$SERVICE" \
    bash -c '/workspace/.devcontainer/start-dev.sh'
}

cmd_reset() {
  require_docker
  cd "$PROJECT_ROOT"
  docker compose -f "$COMPOSE_FILE" down -v
  echo "Volumes removed. Run 'make devc' to re-initialise."
}

cmd_status() {
  require_docker
  cd "$PROJECT_ROOT"
  docker compose -f "$COMPOSE_FILE" ps
}

cmd_logs() {
  require_docker
  cd "$PROJECT_ROOT"
  docker compose -f "$COMPOSE_FILE" logs -f "$SERVICE"
}

if [[ $# -eq 0 ]]; then
  usage
  exit 1
fi

cmd="$1"
shift

parse_port_flag "$@"
write_dotenv

case "$cmd" in
  up) cmd_up ;;
  shell) cmd_shell ;;
  down) cmd_down ;;
  restart) cmd_restart ;;
  reset) cmd_reset ;;
  status) cmd_status ;;
  logs) cmd_logs ;;
  help|--help|-h) usage ;;
  *)
    echo "Error: unknown command '$cmd'" >&2
    usage
    exit 1
    ;;
esac
