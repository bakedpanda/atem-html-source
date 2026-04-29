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

if ! [[ "$GROUP" =~ ^[0-9]+$ ]] || ! [[ "$MODE" =~ ^[0-9]+$ ]]; then
  echo "Error: GROUP and MODE must be positive integers" >&2
  exit 1
fi

if [[ ! -f "$CONFIG" ]]; then
  echo "Error: $CONFIG not found" >&2
  exit 1
fi

if grep -q "^hdmi_group=" "$CONFIG"; then
  sed -i "s/^hdmi_group=.*/hdmi_group=${GROUP}/" "$CONFIG"
else
  echo "hdmi_group=${GROUP}" >> "$CONFIG"
fi

if grep -q "^hdmi_mode=" "$CONFIG"; then
  sed -i "s/^hdmi_mode=.*/hdmi_mode=${MODE}/" "$CONFIG"
else
  echo "hdmi_mode=${MODE}" >> "$CONFIG"
fi

echo "Set hdmi_group=${GROUP} hdmi_mode=${MODE}"
