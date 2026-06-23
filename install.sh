#!/usr/bin/env bash
set -euo pipefail

# Dunning Kruger installer.
#
# Makes the /dunning-kruger skill discoverable to Claude Code (it auto-loads skills from
# ~/.claude/skills and routes on the skill's `description`, so no CLAUDE.md edit is required
# for the agent to know about it). Optionally adds a proactive routing hint to a CLAUDE.md.
#
#   ./install.sh                 symlink the skill into ~/.claude/skills (default; dev-friendly)
#   ./install.sh --copy          copy it instead (stable; survives moving this repo)
#   ./install.sh --claude-md     also add a routing hint to ~/.claude/CLAUDE.md (opt-in)
#   ./install.sh --claude-md=PATH ...to a specific CLAUDE.md

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$REPO/skills/dunning-kruger"
DEST_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
DEST="$DEST_DIR/dunning-kruger"

MODE="symlink"
CLAUDE_MD=""

while [ $# -gt 0 ]; do
  case "$1" in
    --copy) MODE="copy" ;;
    --symlink) MODE="symlink" ;;
    --claude-md) CLAUDE_MD="$HOME/.claude/CLAUDE.md" ;;
    --claude-md=*) CLAUDE_MD="${1#*=}" ;;
    -h|--help) sed -n '3,13p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
  shift
done

[ -d "$SRC" ] || { echo "error: skill not found at $SRC" >&2; exit 1; }
mkdir -p "$DEST_DIR"

if [ -L "$DEST" ]; then
  rm -f "$DEST"                       # our own old symlink — safe to replace
elif [ -d "$DEST" ]; then
  BK="$DEST.bak-$(date +%s)"          # a REAL dir the user may have edited — back it up, don't nuke it
  mv "$DEST" "$BK"
  echo "• backed up your existing $DEST -> $BK"
elif [ -e "$DEST" ]; then
  rm -f "$DEST"
fi
if [ "$MODE" = "symlink" ]; then
  ln -s "$SRC" "$DEST"
  echo "✓ symlinked $DEST -> $SRC"
else
  cp -R "$SRC" "$DEST"
  echo "✓ copied skill to $DEST"
fi

if [ -n "$CLAUDE_MD" ]; then
  MARKER="<!-- dunning-kruger:routing -->"
  if [ -f "$CLAUDE_MD" ] && grep -qF "$MARKER" "$CLAUDE_MD"; then
    echo "• $CLAUDE_MD already has the routing hint"
  else
    mkdir -p "$(dirname "$CLAUDE_MD")"
    {
      printf '\n%s\n' "$MARKER"
      printf '## dunning-kruger (proactive)\n'
      printf 'Before helping the user merge, ship, or push a pull request -- when they say things\n'
      printf 'like "merge this PR", "ship it", "merge to main", "gh pr merge" -- FIRST ask once,\n'
      printf 'non-blocking: "Want to run /dunning-kruger on this change before you merge? It checks\n'
      printf 'you actually understand the blast radius (~2 min)." If they decline, just proceed.\n'
      printf 'Also invoke /dunning-kruger directly whenever they want to test how well they\n'
      printf 'understand their own code or review their own PR. The skill reads the git context\n'
      printf 'and picks calibration vs. ownership mode itself.\n'
    } >> "$CLAUDE_MD"
    echo "✓ added routing hint to $CLAUDE_MD"
  fi
fi

echo
echo "Done. In a Claude Code session inside any repo, run:  /dunning-kruger"
echo "(it reads the room: a change in flight -> ownership review; clean repo -> the interview.)"
