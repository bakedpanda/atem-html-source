#!/bin/bash
# Usage: sudo atem-set-hdmi GROUP MODE
# Edits hdmi_group and hdmi_mode in /boot/firmware/config.txt
set -e
GROUP=$1
MODE=$2
CONFIG=/boot/firmware/config.txt

if [[ -z "$GROUP" || -z "$MODE" ]]; then
  echo "Usage: atem-set-hdmi GROUP MODE" >&2
  exit 1
fi

sed -i "s/^hdmi_group=.*/hdmi_group=${GROUP}/" "$CONFIG"
sed -i "s/^hdmi_mode=.*/hdmi_mode=${MODE}/" "$CONFIG"
echo "Set hdmi_group=${GROUP} hdmi_mode=${MODE}"
