#!/usr/bin/env bash
# start.sh — One-click setup and launch for RGB-LDK Integration Demo
#
# Usage:
#   ./start.sh            Start all services and open browser
#   ./start.sh --reset    Tear down volumes, restart everything fresh
#   ./start.sh --pull     Pull latest Docker images before starting
#   ./start.sh --stop     Stop all services
#   ./start.sh --status   Show current service status
#   ./start.sh --help     Show this help

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Colors ────────────────────────────────────────────────────────────────────

if [[ -t 1 ]]; then
  RED='\033[0;31m'; YELLOW='\033[0;33m'; GREEN='\033[0;32m'
  CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
else
  RED=''; YELLOW=''; GREEN=''; CYAN=''; BOLD=''; RESET=''
fi

# ── Helpers ───────────────────────────────────────────────────────────────────

info()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }
die()     { error "$*"; exit 1; }
step()    { echo -e "\n${BOLD}▶ $*${RESET}"; }

# ── Argument parsing ──────────────────────────────────────────────────────────

MODE="start"
PULL=false

for arg in "$@"; do
  case "$arg" in
    --reset)  MODE="reset"  ;;
    --stop)   MODE="stop"   ;;
    --status) MODE="status" ;;
    --pull)   PULL=true     ;;
    --help|-h)
      echo ""
      echo "  ${BOLD}RGB-LDK Integration Demo — Start Script${RESET}"
      echo "  Author: Stash Labs"
      echo ""
      echo "  Usage: ./start.sh [option]"
      echo ""
      echo "  Options:"
      echo "    (none)    Start all services and open browser"
      echo "    --reset   Tear down volumes, restart everything fresh"
      echo "    --pull    Pull latest Docker images before starting"
      echo "    --stop    Stop all Docker services"
      echo "    --status  Show current service status"
      echo "    --help    Show this help"
      echo ""
      exit 0
      ;;
    *) die "Unknown argument: $arg  (run ./start.sh --help)" ;;
  esac
done

# ── Banner ────────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║        RGB-LDK Integration Demo — Start Script       ║${RESET}"
echo -e "${BOLD}║        Author: Stash Labs                            ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════╝${RESET}"
echo ""

# ── --stop ────────────────────────────────────────────────────────────────────

if [[ "$MODE" == "stop" ]]; then
  step "Stopping Docker services"
  docker compose down
  success "All services stopped."
  exit 0
fi

# ── --status ──────────────────────────────────────────────────────────────────

if [[ "$MODE" == "status" ]]; then
  step "Service status"
  docker compose ps
  echo ""
  info "Alice  HTTP: http://localhost:8500"
  info "Bob    HTTP: http://localhost:8501"
  info "Proxy  UI:   http://localhost:3000"
  info "Bitcoind RPC: http://localhost:18443"
  exit 0
fi

# ── Prerequisite checks ───────────────────────────────────────────────────────

step "Checking prerequisites"

# Docker
if ! command -v docker &>/dev/null; then
  die "Docker is not installed. Install Docker Desktop: https://docs.docker.com/get-docker/"
fi
if ! docker info &>/dev/null; then
  die "Docker daemon is not running. Start Docker Desktop and try again."
fi
success "Docker: $(docker --version | head -1)"

# Docker Compose (v2 plugin or standalone)
if docker compose version &>/dev/null 2>&1; then
  success "Docker Compose: $(docker compose version | head -1)"
elif command -v docker-compose &>/dev/null; then
  # Alias v1 to the compose subcommand used later
  docker() { if [[ "$1" == "compose" ]]; then shift; command docker-compose "$@"; else command docker "$@"; fi; }
  warn "Using docker-compose v1 — consider upgrading to Docker Compose v2"
else
  die "Docker Compose is not available. Install Docker Desktop or 'docker compose' plugin."
fi

# Node.js >= 18
if ! command -v node &>/dev/null; then
  die "Node.js is not installed (>= 18 required). Install: https://nodejs.org/"
fi
NODE_VER=$(node -e "process.stdout.write(process.version.slice(1))")
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  die "Node.js >= 18 required (found v${NODE_VER}). Update: https://nodejs.org/"
fi
success "Node.js: v${NODE_VER}"

# Issuer file (optional — warn only, Step 5 will fail without it)
ISSUER_FILE="$SCRIPT_DIR/RGB20-Simplest-v0-rLosfg.issuer"
if [[ -f "$ISSUER_FILE" ]]; then
  success "Issuer file found"
else
  warn "Issuer file not found at:"
  warn "  $ISSUER_FILE"
  warn "Step 5 (Import Issuer) will fail. Place RGB20-Simplest-v0-rLosfg.issuer in this repo root."
fi

# ── --reset ───────────────────────────────────────────────────────────────────

if [[ "$MODE" == "reset" ]]; then
  step "Resetting: removing containers and volumes"
  docker compose down -v
  success "All containers and volumes removed."
fi

# ── Pull latest images ────────────────────────────────────────────────────────

if [[ "$PULL" == "true" ]]; then
  step "Pulling latest Docker images"
  docker compose pull
fi

# ── Start Docker services ─────────────────────────────────────────────────────

step "Starting Docker services"

# Check if services are already up
RUNNING=$(docker compose ps --status running --quiet 2>/dev/null | wc -l | tr -d ' ')
if [[ "$RUNNING" -gt 0 && "$MODE" == "start" ]]; then
  info "${RUNNING} service(s) already running — skipping start"
else
  docker compose up -d
fi

# ── Wait for services to become healthy ───────────────────────────────────────

step "Waiting for services to be ready"

# Wait until a TCP port accepts connections (works for any protocol).
wait_for_port() {
  local name="$1" host="$2" port="$3" max_secs="${4:-60}"
  local elapsed=0
  printf "  Waiting for %-20s " "${name}..."
  while true; do
    if (echo > /dev/tcp/"$host"/"$port") 2>/dev/null; then
      echo -e " ${GREEN}ready${RESET} (${elapsed}s)"
      return 0
    fi
    if [[ "$elapsed" -ge "$max_secs" ]]; then
      echo -e " ${RED}timeout${RESET}"
      return 1
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
}

# Wait until an HTTP endpoint returns a 2xx or 3xx response.
wait_for_http() {
  local name="$1" url="$2" max_secs="${3:-60}"
  local elapsed=0
  printf "  Waiting for %-20s " "${name}..."
  while true; do
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$url" 2>/dev/null || echo "000")
    if [[ "$code" =~ ^[23] ]]; then
      echo -e " ${GREEN}ready${RESET} (${elapsed}s)"
      return 0
    fi
    if [[ "$elapsed" -ge "$max_secs" ]]; then
      echo -e " ${RED}timeout${RESET}"
      return 1
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
}

# bitcoind: check TCP port only — the RPC endpoint returns 400/401 on plain GET,
# which would fool an HTTP-status check into thinking it has timed out.
wait_for_port "bitcoind (18443)" localhost 18443 60 || \
  warn "bitcoind port not open — check: docker compose logs bitcoind"

# Alice node
wait_for_http "Alice (8500)" \
  "http://localhost:8500/api/v1/status" 120 || \
  warn "Alice node not responding — check: docker compose logs rgb-node-alice"

# Bob node
wait_for_http "Bob (8501)" \
  "http://localhost:8501/api/v1/status" 120 || \
  warn "Bob node not responding — check: docker compose logs rgb-node-bob"

success "Docker stack is up"

# ── Show service summary ──────────────────────────────────────────────────────

echo ""
echo -e "  ${BOLD}Services:${RESET}"
docker compose ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null || docker compose ps
echo ""

# ── Open browser (macOS / Linux / WSL) ───────────────────────────────────────

open_browser() {
  local url="$1"
  if command -v open &>/dev/null; then       # macOS
    open "$url" &
  elif command -v xdg-open &>/dev/null; then # Linux
    xdg-open "$url" &>/dev/null &
  fi
}

# ── npm install ───────────────────────────────────────────────────────────────

if [[ ! -d "$SCRIPT_DIR/node_modules" ]]; then
  step "Installing npm dependencies"
  npm install
else
  info "node_modules found — skipping npm install"
fi

# ── Start dev servers and wait for Vite to be ready ──────────────────────────

step "Starting proxy + Vite dev server"
info "Press Ctrl+C to stop (Docker services will keep running)"
echo ""

# Run npm start in the background so we can poll the Vite port
npm run start &
NPM_PID=$!

# Ensure npm start is killed on Ctrl+C / script exit
trap 'kill "$NPM_PID" 2>/dev/null; exit' INT TERM EXIT

# Poll localhost:5173 until Vite is ready, then open browser
VITE_URL="http://localhost:5173"
VITE_TIMEOUT=60
elapsed=0
printf "  Waiting for %-20s " "Vite (5173)..."
while true; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "$VITE_URL" 2>/dev/null || echo "000")
  if [[ "$code" =~ ^[23] ]]; then
    echo -e " ${GREEN}ready${RESET} (${elapsed}s)"
    break
  fi
  if [[ "$elapsed" -ge "$VITE_TIMEOUT" ]]; then
    echo -e " ${YELLOW}timeout — opening anyway${RESET}"
    break
  fi
  sleep 1
  elapsed=$((elapsed + 1))
done

echo ""
success "Demo is ready → $VITE_URL"
echo ""
open_browser "$VITE_URL"

# Keep script alive (forwards Ctrl+C via the trap above)
wait "$NPM_PID"
