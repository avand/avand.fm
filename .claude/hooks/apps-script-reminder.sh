#!/usr/bin/env bash
#
# Say out loud that editing the endpoint has not changed the endpoint.
#
# apps-script/signup.gs is the one file in this repo whose edits do not reach
# anybody by merging. The site publishes from master; the script publishes when
# somebody runs bin/apps-script deploy, and nothing connects the two. So the
# failure is a familiar one here -- the change looks done, the diff is right,
# the PR merges, and the form keeps running last month's code.
#
# This does not deploy and does not check anything over the network. It is a
# reminder, printed at the moment the edit happens, which is the moment there
# is still something to remember.
#
# Reads a PostToolUse payload on stdin, writes to stderr, exits 2 so the note
# is fed back rather than swallowed. Exit 0 (silent) for anything else.

set -uo pipefail

payload=$(cat)
file=$(printf '%s' "$payload" | jq -r '.tool_response.filePath // .tool_input.file_path // empty' 2>/dev/null)
[ -n "$file" ] || exit 0

case "$file" in
  # Anything in here, not just the .gs -- appsscript.json carries the web app's
  # access settings and the timezone triggers fire on, and it needs deploying
  # exactly as much as the code does.
  */apps-script/*)
    printf '%s\n' \
      "apps-script/ edited. Nothing is live until: bin/apps-script deploy" \
      "Deploy before merging the page, not after -- bin/apps-script check confirms." >&2
    exit 2
    ;;
esac

# The other direction. index.html is edited constantly for reasons that have
# nothing to do with the form, so this looks at what was actually written
# rather than at the filename, and stays quiet unless the signup code is in it.
case "$file" in
  */headroom/index.html)
    if printf '%s' "$payload" | jq -r '.tool_input | (.new_string // "") + (.content // "")' 2>/dev/null \
         | grep -qE 'SIGNUP_ENDPOINT|signup-status|id="signup"'; then
      printf '%s\n' \
        "That edit touched the signup form. Does apps-script/signup.gs need a matching change?" \
        "If so: deploy it first, then merge this. bin/apps-script check" >&2
      exit 2
    fi
    ;;
esac

exit 0
