#!/bin/bash
# OHO API watchdog — run by cron every minute.
#
# pm2 already restarts a worker that crashes. This covers what it can't:
#   1. MongoDB has died            -> start it again
#   2. pm2 itself has died         -> resurrect it (and with it the API)
#   3. pm2 gave up on the API      -> after 10 fast crashes it stops for good
#   4. the API is "online" but not answering /health -> reload it
#
# Built to be safe rather than eager:
#   - one copy at a time (flock), so a slow run never overlaps the next
#   - PAUSE during deploys:  touch ~/.oho-watchdog-pause   (rm it after)
#   - acts only after /health fails 3 minutes running, never on one blip
#   - graceful `reload` first; one hard `restart` only if reload didn't help
#   - at most 3 actions an hour: if the code itself is broken, restarting it
#     forever only hides that, so it stops and logs "NEEDS A HUMAN" instead
#   - every decision is logged to ~/logs/oho-watchdog.log
#
# Install (crontab -e):
#   * * * * * /home/ohoridein/apps/oho/Backend/scripts/watchdog.sh >/dev/null 2>&1

set -u

HOME_DIR=/home/ohoridein
NODE=$HOME_DIR/.local/node20/bin/node
PM2="$NODE $HOME_DIR/.local/node20/lib/node_modules/pm2/bin/pm2"
APP_DIR=$HOME_DIR/apps/oho/Backend
APP_NAME=oho-api
HEALTH_URL=${OHO_WATCHDOG_HEALTH_URL:-http://127.0.0.1:5000/health}
# Test mode: OHO_WATCHDOG_DRY_RUN=1 logs what it WOULD do and changes nothing.
DRY_RUN=${OHO_WATCHDOG_DRY_RUN:-0}
MONGOD="$HOME_DIR/.local/mongodb/bin/mongod --config $HOME_DIR/.local/mongod.conf"

STATE_DIR=${OHO_WATCHDOG_STATE_DIR:-$HOME_DIR/.oho-watchdog}
LOG=$HOME_DIR/logs/oho-watchdog.log
PAUSE_FILE=$HOME_DIR/.oho-watchdog-pause
LOCK=$STATE_DIR/lock

FAILS_BEFORE_ACTION=3        # consecutive failed health checks (1 per minute)
MAX_ACTIONS_PER_HOUR=3       # reload/restart/resurrect, combined

mkdir -p "$STATE_DIR" "$(dirname "$LOG")"

# Keep the log from growing without bound: past 5 MB, keep the last 2,000 lines.
if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG")" -gt 5242880 ]; then
  tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

log() { echo "$(date '+%F %T') $([ "$DRY_RUN" = 1 ] && echo '[test] ')$*" >> "$LOG"; }

# Every command that changes something goes through here, so test mode can
# show the decision without touching pm2 or MongoDB.
run() {
  if [ "$DRY_RUN" = 1 ]; then log "would run: $*"; return 0; fi
  "$@" >> "$LOG" 2>&1
}

exec 9>"$LOCK"
flock -n 9 || exit 0

# Proof of life: how to tell the cron job is really running.
date '+%F %T' > "$STATE_DIR/last_run"

if [ -f "$PAUSE_FILE" ]; then
  # Say so once an hour, so a forgotten pause file is noticed in the log.
  [ "$(date +%M)" = "00" ] && log "paused (remove $PAUSE_FILE to resume)"
  exit 0
fi

# --- action budget ------------------------------------------------------
ACTIONS=$STATE_DIR/actions   # one unix timestamp per action taken
now=$(date +%s)
touch "$ACTIONS"
awk -v cutoff=$((now - 3600)) '$1 >= cutoff' "$ACTIONS" > "$ACTIONS.tmp" && mv "$ACTIONS.tmp" "$ACTIONS"

budget_left() { [ "$(wc -l < "$ACTIONS")" -lt "$MAX_ACTIONS_PER_HOUR" ]; }
spend() { echo "$now" >> "$ACTIONS"; }

gave_up() {
  # Log the give-up once, not every minute.
  if [ ! -f "$STATE_DIR/gave_up" ]; then
    log "NEEDS A HUMAN: $1 — not restarting again until it recovers or the hour passes. Check: tail -100 ~/.pm2/logs/oho-api-error.log"
    touch "$STATE_DIR/gave_up"
  fi
}

healthy() { [ "$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$HEALTH_URL")" = "200" ]; }

# --- 1. MongoDB ---------------------------------------------------------
if ! pgrep -u ohoridein -x mongod >/dev/null; then
  if budget_left; then
    log "MongoDB is not running — starting it"
    spend
    run $MONGOD || log "MongoDB failed to start (see ~/logs/mongodb/mongod.log)"
    [ "$DRY_RUN" = 1 ] || sleep 5
  else
    gave_up "MongoDB is down"
    exit 0
  fi
fi

# --- 2. pm2 daemon ------------------------------------------------------
if ! $PM2 ping >/dev/null 2>&1; then
  if budget_left; then
    log "pm2 is not responding — resurrecting it"
    spend
    run $PM2 resurrect
    [ "$DRY_RUN" = 1 ] || sleep 20
  else
    gave_up "pm2 is down"
    exit 0
  fi
fi

# --- 3. pm2 gave up on the app -----------------------------------------
# "<workers registered> <workers online>" for this app, read from pm2's JSON.
counts=$($PM2 jlist 2>/dev/null | $NODE -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    try {
      const apps = JSON.parse(s).filter((p) => p.name === process.argv[1]);
      console.log(apps.length + " " + apps.filter((p) => p.pm2_env && p.pm2_env.status === "online").length);
    } catch { console.log("unknown"); }
  });' "$APP_NAME")
if [ "$counts" = "unknown" ]; then
  log "could not read pm2 status — skipping this round"
  exit 0
fi
registered=${counts% *}
online=${counts#* }
if [ "$registered" -eq 0 ]; then
  if budget_left; then
    log "$APP_NAME is not registered with pm2 — starting it from ecosystem.config.cjs"
    spend
    cd "$APP_DIR" && run $PM2 start ecosystem.config.cjs && run $PM2 save
    exit 0
  fi
  gave_up "$APP_NAME is not registered with pm2"
  exit 0
fi
if [ "$online" -eq 0 ]; then
  if budget_left; then
    log "$APP_NAME has no online workers (pm2 stopped retrying) — restarting it"
    spend
    cd "$APP_DIR" && run $PM2 restart "$APP_NAME" --update-env
    exit 0
  fi
  gave_up "$APP_NAME has no online workers"
  exit 0
fi

# --- 4. answering? ------------------------------------------------------
FAILS=$STATE_DIR/health_fails
if healthy; then
  if [ -f "$FAILS" ] || [ -f "$STATE_DIR/gave_up" ]; then
    log "healthy again"
  fi
  rm -f "$FAILS" "$STATE_DIR/gave_up" "$STATE_DIR/reloaded_at" "$STATE_DIR/restarted_at"
  exit 0
fi

fails=$(( $(cat "$FAILS" 2>/dev/null || echo 0) + 1 ))
echo "$fails" > "$FAILS"
log "/health failed ($fails in a row)"
[ "$fails" -lt "$FAILS_BEFORE_ACTION" ] && exit 0

# One graceful reload and one hard restart per outage. If it still isn't
# answering after both, restarting again won't fix it — it needs a human.
if [ -f "$STATE_DIR/restarted_at" ] || ! budget_left; then
  gave_up "/health keeps failing after a reload and a restart"
  exit 0
fi

# A graceful reload first: new workers start before the old ones stop, so
# anything still working keeps answering. Only if that has already been tried
# in this outage, and it still isn't healthy, fall back to one hard restart.
spend
echo 0 > "$FAILS"
if [ ! -f "$STATE_DIR/reloaded_at" ]; then
  log "reloading $APP_NAME (graceful)"
  date +%s > "$STATE_DIR/reloaded_at"
  cd "$APP_DIR" && run $PM2 reload ecosystem.config.cjs --update-env
else
  log "reload did not fix it — restarting $APP_NAME (hard)"
  date +%s > "$STATE_DIR/restarted_at"
  cd "$APP_DIR" && run $PM2 restart "$APP_NAME" --update-env
fi
