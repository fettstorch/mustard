#!/bin/bash

# Universal Stop hook for automatic verification (Claude Code + Cursor compatible)
# Runs build when the agent completes.
#
# On failure, outputs JSON to stdout with both formats:
#   - decision/reason  → Claude Code reads this to block stopping
#   - followup_message → Cursor reads this to auto-submit a follow-up
# On success, exits 0 with no stdout (both systems treat this as "allow").
#
# All log output goes to stderr so it never interferes with JSON parsing.
# Requires: jq, git, npm
#
# References:
#   - Claude Code Hooks: https://docs.anthropic.com/en/docs/claude-code/hooks
#   - Cursor Hooks: https://cursor.com/docs/agent/hooks
#   - I/O Expectations: .claude/hooks/README.md
#
# Agent Detection:
#   Detects which agent by inspecting stdin JSON:
#   - Cursor: presence of `cursor_version` field
#   - Claude Code: presence of `stop_reason` field
#   - Unknown: outputs both JSON formats for compatibility
#
# Optimizations:
#   1. Skip if no changes: Uses `git status --porcelain` to detect uncommitted
#      changes. If no files were modified, skips build to save compute.
#   2. Infinite loop prevention: Checks `stop_hook_active` flag (Claude Code
#      only) to prevent infinite loops in forced continuation state.
#   3. Agent-specific output: Outputs only JSON fields the detected agent needs.
#
# Behavior:
#   - No uncommitted changes: exits 0, skips build
#   - stop_hook_active=true (Claude Code): exits 0, prevents infinite loop
#   - Build success: exits 0, no stdout (allows stopping)
#   - Build failure: exits 0, outputs agent-specific JSON to stdout
#   - Setup failure (missing tools): exits 2, stderr (blocks stop)

# Colors
ORANGE='\033[38;5;214m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RESET='\033[0m'

# Log to stderr (visible in terminal but doesn't interfere with JSON output)
log() {
  echo -e "${ORANGE}[verify.sh]${RESET} $1" >&2
}

log_success() {
  echo -e "${ORANGE}[verify.sh]${RESET} ${GREEN}✓${RESET} $1" >&2
}

log_error() {
  echo -e "${ORANGE}[verify.sh]${RESET} ${RED}✗${RESET} $1" >&2
}

log_info() {
  echo -e "${ORANGE}[verify.sh]${RESET} ${BLUE}ℹ${RESET} $1" >&2
}

# Output a verification failure message in agent-specific JSON format
# Args: $1 = message (should contain newlines as \n)
output_failure() {
  local MESSAGE="$1"

  # Escape for JSON using jq
  ESCAPED=$(printf '%s' "$MESSAGE" | jq -Rs .)

  # Output format depends on which agent is running us
  if [ "$AGENT_TYPE" = "cursor" ]; then
    # Cursor reads: followup_message
    echo "{\"followup_message\": $ESCAPED}"
  elif [ "$AGENT_TYPE" = "claude" ]; then
    # Claude Code reads: decision/reason
    echo "{\"decision\": \"block\", \"reason\": $ESCAPED}"
  else
    # Fallback: output both formats for maximum compatibility
    echo "{\"decision\": \"block\", \"reason\": $ESCAPED, \"followup_message\": $ESCAPED}"
  fi
}

log "Starting verification hook..."

# Detect which agent is running us by reading the JSON input
AGENT_TYPE="unknown"
STOP_HOOK_ACTIVE="false"
if [ -t 0 ]; then
  log_info "Running in interactive mode (stdin not a pipe)"
else
  INPUT=$(cat)

  # Check for Cursor-specific fields
  if echo "$INPUT" | jq -e '.cursor_version' > /dev/null 2>&1; then
    AGENT_TYPE="cursor"
  # Check for Claude Code-specific fields
  elif echo "$INPUT" | jq -e '.stop_reason' > /dev/null 2>&1; then
    AGENT_TYPE="claude"
    # Check stop_hook_active to prevent infinite loops (Claude Code only)
    if echo "$INPUT" | jq -e '.stop_hook_active == true' > /dev/null 2>&1; then
      STOP_HOOK_ACTIVE="true"
    fi
  fi
fi

log_info "Detected agent: $AGENT_TYPE"

# Prevent infinite loops: if stop_hook_active is true, allow stopping immediately
if [ "$STOP_HOOK_ACTIVE" = "true" ]; then
  log_info "stop_hook_active=true, allowing stop to prevent infinite loop"
  log "Hook complete (skipped)."
  exit 0
fi

# Determine project root (works for both Cursor and Claude Code)
PROJECT_DIR="${CURSOR_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-}}"

# If no project dir from env, try to infer from git, then fall back to pwd
if [ -z "$PROJECT_DIR" ]; then
  GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
  if [ -n "$GIT_ROOT" ]; then
    PROJECT_DIR="$GIT_ROOT"
  else
    PROJECT_DIR="$(pwd)"
  fi
fi

log_info "Project directory: $PROJECT_DIR"

if [ ! -f "$PROJECT_DIR/package.json" ]; then
  log_error "No package.json found in $PROJECT_DIR"
  echo "Could not locate project directory. Expected package.json in $PROJECT_DIR" >&2
  exit 2
fi

cd "$PROJECT_DIR" || {
  log_error "Failed to cd to $PROJECT_DIR"
  echo "Could not change directory to $PROJECT_DIR" >&2
  exit 2
}
log_info "Changed to: $(pwd)"

# Check if there are any uncommitted changes (staged or unstaged)
# If no changes, skip the build to save compute
GIT_CHANGES=$(git status --porcelain 2>/dev/null)
if [ -z "$GIT_CHANGES" ]; then
  log_info "No uncommitted changes detected, skipping build verification"
  log "Hook complete (no changes)."
  exit 0
fi

log_info "Detected uncommitted changes, running build verification"

# =============================================================================
# Step 1: Knip + Lint (auto-fix cascade)
# =============================================================================
# Knip runs first to remove unused exports, then eslint runs to apply fixes.
# Both must complete before we check for remaining issues.

echo "" >&2
log "Running ${YELLOW}npm run knip:fix${RESET}..."

# Run knip --fix to auto-remove unused exports/dependencies
npm run knip:fix > /dev/null 2>&1

# -----------------------------------------------------------------------------
# Step 1.1: ESLint auto-fix
# -----------------------------------------------------------------------------

log "Running ${YELLOW}npm run lint${RESET}..."

# Run eslint --fix: auto-fixes issues and reports only unfixable ones
LINT_OUTPUT=$(npm run lint 2>&1)
LINT_EXIT=$?

if [ "$LINT_EXIT" -ne 0 ]; then
  log_error "eslint found unfixable errors"
else
  log_success "eslint PASSED"
fi

# -----------------------------------------------------------------------------
# Step 1.2: Check for remaining knip issues
# -----------------------------------------------------------------------------
# knip --fix always exits 1 if it found issues, even if all were fixed.
# So we run plain knip to check if unfixable issues remain.

log "Running ${YELLOW}npm run knip${RESET}..."

KNIP_OUTPUT=$(npm run knip 2>&1)
KNIP_EXIT=$?

if [ "$KNIP_EXIT" -ne 0 ]; then
  log_error "knip found unfixable issues"
else
  log_success "knip PASSED"
fi

# -----------------------------------------------------------------------------
# Step 1.3: Report combined knip + lint failures
# -----------------------------------------------------------------------------

if [ "$KNIP_EXIT" -ne 0 ] || [ "$LINT_EXIT" -ne 0 ]; then
  echo "" >&2
  MESSAGE="Verification failed. Auto-fix was applied, but these issues remain:\n\n"

  if [ "$KNIP_EXIT" -ne 0 ]; then
    MESSAGE="${MESSAGE}## Knip Errors\n\n\`\`\`\n$KNIP_OUTPUT\n\`\`\`\n\n"
  fi

  if [ "$LINT_EXIT" -ne 0 ]; then
    MESSAGE="${MESSAGE}## ESLint Errors\n\n\`\`\`\n$LINT_OUTPUT\n\`\`\`\n\n"
  fi

  output_failure "$MESSAGE"

  log "Hook complete."
  exit 0
fi

# =============================================================================
# Step 2: Format (prettier) - fire and forget
# =============================================================================
# Run prettier in background to auto-format files. We don't block on this since:
#   - It's fast but we don't need to wait for it
#   - CI will catch any formatting issues that slip through
#   - This keeps the hook fast for iteration speed

log "Running ${YELLOW}npm run format${RESET} (background)..."
npm run format > /dev/null 2>&1 &

# =============================================================================
# Step 3: Build (TypeScript type-check + Vite build)
# =============================================================================

echo "" >&2
log "Running ${YELLOW}npm run build${RESET}..."

# Run build (type-check + build-only in parallel via run-p)
CHECK_OUTPUT=$(npm run build 2>&1)
CHECK_EXIT=$?

if [ "$CHECK_EXIT" -ne 0 ]; then
  log_error "build FAILED (exit code: $CHECK_EXIT)"
  echo "" >&2

  MESSAGE="Verification failed. Please fix these errors and then stop:\n\n## Build Errors\n\n\`\`\`\n$CHECK_OUTPUT\n\`\`\`\n\n"
  output_failure "$MESSAGE"
else
  log_success "build PASSED"
  echo "" >&2
  log_success "Verification PASSED"
  # Exit 0 with no stdout — both Claude Code and Cursor treat this as "allow"
fi

log "Hook complete."
