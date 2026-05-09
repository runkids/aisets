#!/usr/bin/env bash
# Unified devcontainer lifecycle script.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/.devcontainer/docker-compose.yml"
SERVICE="aisets-devcontainer"

usage() {
  echo "Usage: $(basename "$0") <command>"
  echo ""
  echo "Commands:"
  echo "  up        Start devcontainer"
  echo "  shell     Enter running devcontainer shell"
  echo "  down      Stop and remove devcontainer"
  echo "  restart   Restart devcontainer"
  echo "  reset     Stop + remove volumes"
  echo "  status    Show devcontainer status"
  echo "  logs      Tail devcontainer logs"
}

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker is required" >&2
    exit 1
  fi
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
  echo "▸ Starting devcontainer ..."
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
case "$cmd" in
  up) cmd_up "$@" ;;
  shell) cmd_shell "$@" ;;
  down) cmd_down "$@" ;;
  restart) cmd_restart "$@" ;;
  reset) cmd_reset "$@" ;;
  status) cmd_status "$@" ;;
  logs) cmd_logs "$@" ;;
  help|--help|-h) usage ;;
  *)
    echo "Error: unknown command '$cmd'" >&2
    usage
    exit 1
    ;;
esac
