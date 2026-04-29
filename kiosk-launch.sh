#!/bin/bash
# kiosk-launch.sh
# Launch Chromium in kiosk mode pointing at the display page
# Add this to your Pi's autostart or run via systemd/cron

# Disable screen blanking
xset s off
xset -dpms
xset s noblank

# Wait for the server to be ready
until curl -sf http://localhost:3000/api/config > /dev/null; do
  echo "Waiting for server..."
  sleep 1
done

# Launch Chromium in kiosk mode
chromium-browser \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --no-first-run \
  --disable-restore-session-state \
  --disable-features=TranslateUI \
  --disable-component-update \
  --check-for-update-interval=31536000 \
  --overscroll-history-navigation=0 \
  http://localhost:3000/display
