#!/bin/bash
xset s off
xset -dpms
xset s noblank

until curl -sf http://localhost:3000/api/config > /dev/null; do
  sleep 1
done

chromium \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --no-first-run \
  --password-store=basic \
  --disable-features=PasswordCheck,TranslateUI \
  --disable-component-update \
  --check-for-update-interval=31536000 \
  --overscroll-history-navigation=0 \
  --disable-web-security \
  --use-fake-ui-for-media-stream \
  --deny-permission-prompts \
  --user-data-dir=/tmp/chromekiosk \
  http://localhost:3000/display
