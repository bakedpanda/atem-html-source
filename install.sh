#!/bin/bash
set -e
set -o pipefail

if [[ "$EUID" -eq 0 ]]; then
  echo "Error: do not run this script as root. Run as the kiosk user." >&2
  exit 1
fi

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CURRENT_USER="$(whoami)"
CURRENT_HOST="$(hostname)"

echo ""
echo "=============================="
echo " ATEM HTML Source — Installer"
echo "=============================="
echo ""
echo "Running as user: $CURRENT_USER"
echo ""

# ── Prompt 1: Hostname ─────────────────────────────────────
read -p "Hostname [$CURRENT_HOST]: " INPUT_HOST
CHOSEN_HOST="${INPUT_HOST:-$CURRENT_HOST}"
if [[ "$CHOSEN_HOST" != "$CURRENT_HOST" ]]; then
  sudo hostnamectl set-hostname "$CHOSEN_HOST"
  sudo sed -i "s/127\.0\.1\.1.*/127.0.1.1\t$CHOSEN_HOST/" /etc/hosts
fi

# ── Prompt 2: Default resolution ──────────────────────────
echo ""
echo "Default HDMI output:"
echo "  1) 1080p25  (PAL)  [default]"
echo "  2) 1080p50  (PAL)"
echo "  3) 1080p29.97 (NTSC)"
echo "  4) 1080p59.94 (NTSC)"
echo "  5) 1080p60"
echo "  6) 720p50"
echo "  7) 720p59.94"
echo ""
read -p "Choice [1]: " RES_CHOICE

case "${RES_CHOICE:-1}" in
  2) HDMI_GROUP=1; HDMI_MODE=31; DEFAULT_RES="1920x1080"; DEFAULT_FPS="50"   ;;
  3) HDMI_GROUP=1; HDMI_MODE=34; DEFAULT_RES="1920x1080"; DEFAULT_FPS="29.97";;
  4) HDMI_GROUP=1; HDMI_MODE=16; DEFAULT_RES="1920x1080"; DEFAULT_FPS="59.94";;
  5) HDMI_GROUP=1; HDMI_MODE=16; DEFAULT_RES="1920x1080"; DEFAULT_FPS="60"   ;;
  6) HDMI_GROUP=1; HDMI_MODE=19; DEFAULT_RES="1280x720";  DEFAULT_FPS="50"   ;;
  7) HDMI_GROUP=1; HDMI_MODE=47; DEFAULT_RES="1280x720";  DEFAULT_FPS="59.94";;
  *) HDMI_GROUP=1; HDMI_MODE=33; DEFAULT_RES="1920x1080"; DEFAULT_FPS="25"   ;;
esac

echo ""
echo "Starting installation..."
echo ""

# ── 1. System update ───────────────────────────────────────
echo "[1/11] Updating system packages..."
sudo apt-get update -qq
sudo apt-get upgrade -y -qq

# ── 2. Node.js ─────────────────────────────────────────────
echo "[2/11] Checking Node.js..."
NODE_OK=false
if command -v node &>/dev/null; then
  NODE_VER=$(node -e "console.log(parseInt(process.version.slice(1)))" 2>/dev/null || echo 0)
  [[ "$NODE_VER" -ge 18 ]] && NODE_OK=true
fi
if [[ "$NODE_OK" == false ]]; then
  echo "       Installing Node.js 20 via NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs -qq
fi
echo "       Node $(node -v) ready."

# ── 3. npm install ─────────────────────────────────────────
echo "[3/11] Installing Node.js dependencies..."
cd "$REPO_DIR"
npm install --production --silent

# ── 4. LightDM ─────────────────────────────────────────────
echo "[4/11] Configuring LightDM autologin..."
sudo tee /etc/lightdm/lightdm.conf > /dev/null <<EOF
[LightDM]

[Seat:*]
autologin-user=${CURRENT_USER}
autologin-user-timeout=0
user-session=openbox
autologin-session=openbox
xserver-command=X -nocursor

[XDMCPServer]

[VNCServer]
EOF

# ── 5. Openbox autostart ───────────────────────────────────
echo "[5/11] Configuring Openbox autostart..."
mkdir -p "$HOME/.config/openbox"
tee "$HOME/.config/openbox/autostart" > /dev/null <<EOF
xsetroot -solid black &
xset s off &
xset -dpms &
xset s noblank &
bash "${REPO_DIR}/kiosk-launch.sh" &
EOF

# ── 6. systemd service ─────────────────────────────────────
echo "[6/11] Installing systemd service..."
sed \
  -e "s|USERNAME|${CURRENT_USER}|g" \
  -e "s|REPO_DIR|${REPO_DIR}|g" \
  "${REPO_DIR}/atem-html-source.service" \
  | sudo tee /etc/systemd/system/atem-html-source.service > /dev/null
sudo systemctl daemon-reload
sudo systemctl enable atem-html-source

# ── 7. /boot/firmware/config.txt ──────────────────────────
echo "[7/11] Configuring /boot/firmware/config.txt..."
CONFIG_TXT="/boot/firmware/config.txt"
# Remove lines we'll set ourselves (avoid duplicates)
sudo sed -i '/^hdmi_force_hotplug/d' "$CONFIG_TXT"
sudo sed -i '/^disable_overscan/d' "$CONFIG_TXT"
sudo sed -i '/^disable_splash/d' "$CONFIG_TXT"
sudo sed -i '/^hdmi_group/d' "$CONFIG_TXT"
sudo sed -i '/^hdmi_mode/d' "$CONFIG_TXT"
sudo tee -a "$CONFIG_TXT" > /dev/null <<EOF

# ATEM HTML Source
hdmi_force_hotplug=1
disable_overscan=1
disable_splash=1
hdmi_group=${HDMI_GROUP}
hdmi_mode=${HDMI_MODE}
EOF

# ── 8. /boot/firmware/cmdline.txt ─────────────────────────
echo "[8/11] Configuring /boot/firmware/cmdline.txt..."
CMDLINE_TXT="/boot/firmware/cmdline.txt"
sudo sed -i 's/ splash\b//g' "$CMDLINE_TXT"
sudo sed -i 's/ quiet\b//g' "$CMDLINE_TXT"
sudo sed -i 's/ loglevel=[0-9]\+//g' "$CMDLINE_TXT"
sudo sed -i 's/$/ quiet loglevel=0/' "$CMDLINE_TXT"

# ── 9. Plymouth ────────────────────────────────────────────
echo "[9/11] Disabling Plymouth splash..."
sudo systemctl disable plymouth.service 2>/dev/null || true
sudo systemctl disable plymouth-start.service 2>/dev/null || true

# ── 10. atem-set-hdmi + sudoers ───────────────────────────
echo "[10/11] Installing atem-set-hdmi and sudoers rules..."
sudo cp "${REPO_DIR}/atem-set-hdmi.sh" /usr/local/bin/atem-set-hdmi
sudo chmod 755 /usr/local/bin/atem-set-hdmi
sudo chown root:root /usr/local/bin/atem-set-hdmi

echo "${CURRENT_USER} ALL=(ALL) NOPASSWD: /usr/local/bin/atem-set-hdmi" \
  | sudo tee /etc/sudoers.d/atem-hdmi > /dev/null
echo "${CURRENT_USER} ALL=(ALL) NOPASSWD: /sbin/reboot" \
  | sudo tee /etc/sudoers.d/atem-reboot > /dev/null
sudo visudo -c -f /etc/sudoers.d/atem-hdmi
sudo visudo -c -f /etc/sudoers.d/atem-reboot
sudo chmod 440 /etc/sudoers.d/atem-hdmi /etc/sudoers.d/atem-reboot

# ── 11. Initial config.json ────────────────────────────────
echo "[11/11] Writing initial config..."
if [[ -f "${REPO_DIR}/config.json" ]]; then
  echo "       Existing config.json preserved."
else
tee "${REPO_DIR}/config.json" > /dev/null <<EOF
{
  "mode": "color",
  "html": "",
  "customCss": "",
  "url": "",
  "imageUrl": "",
  "imageFit": "cover",
  "backgroundColor": "#000000",
  "resolution": "${DEFAULT_RES}",
  "framerate": "${DEFAULT_FPS}",
  "interlaced": false
}
EOF
fi

echo ""
echo "=============================="
echo " Installation complete!"
echo "=============================="
echo ""
echo " Admin panel (after reboot):"
echo "   http://${CHOSEN_HOST}.local:3000"
echo ""
echo " Rebooting in 5 seconds... (Ctrl+C to cancel)"
sleep 5
sudo reboot
