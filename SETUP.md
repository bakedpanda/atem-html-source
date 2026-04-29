# ATEM HTML Source — Pi Kiosk Setup Guide

> **GitHub note:** This repo is designed to be cloned onto a fresh Pi and set up with a single script.
> See [One-command setup](#one-command-setup) at the bottom.
>
> **TODO:** Write `install.sh` to automate steps 2–8. The script should substitute the correct username dynamically into the service file and prompt for resolution/framerate to write config.txt.

---

## Hardware

- Raspberry Pi 3B+ (or any Pi with desktop-capable GPU)
- HDMI cable to an ATEM switcher input
- Network connection (ethernet recommended for broadcast use)

---

## OS

**Raspberry Pi OS with Desktop (32-bit, Debian 13 Trixie)**

- Do **not** use the Lite image — you need X and Chromium
- Do **not** use the Full image — LibreOffice etc. is wasted space
- Do **not** use 64-bit on a 3B+ — 1GB RAM is tight, 32-bit uses less per process
- Download from: https://www.raspberrypi.com/software/operating-systems/

Flash with Raspberry Pi Imager. In the imager's advanced settings, pre-configure:
- Hostname (e.g. `atemhtml`)
- Username and password
- SSH enabled
- WiFi (if not using ethernet)

---

## Overview

The setup replaces the full RPD (Raspberry Pi Desktop) session with **Openbox**, a minimal window manager. On boot, Openbox launches directly into Chromium kiosk mode pointing at the local Node.js server. The ATEM sees a clean fullscreen HTML page with no desktop, taskbar, or cursor visible.

Boot sequence:
```
Pi powers on
  └── systemd starts Node.js server (atem-html-source.service)
  └── lightdm autologin → Openbox session
        └── kiosk-launch.sh
              └── waits for server to be ready
              └── Chromium kiosk → http://localhost:3000/display
```

---

## Step-by-step setup

### 1. Update the system

```bash
sudo apt update && sudo apt upgrade -y
```

### 2. Install dependencies

```bash
sudo apt install -y nodejs npm
```

Verify Node is installed:

```bash
node -v
npm -v
```

> **Note:** If `node -v` returns below v18, install via NodeSource:
> ```bash
> curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
> sudo apt install -y nodejs
> ```

> **Note:** Openbox is already installed on Trixie — no need to install it manually.

### 3. Clone the repo

```bash
cd ~
git clone https://github.com/YOUR_USERNAME/atem-html-source.git
cd atem-html-source
npm install
```

> **Note:** The `public/` folder must exist with `admin.html` and `display.html` inside it. If cloning from GitHub and the folder structure is wrong, fix it with:
> ```bash
> mkdir -p public
> mv admin.html display.html public/
> ```

### 4. Install the systemd service

This starts the Node.js server automatically on boot.

Open the service file and confirm the username and path are correct:

```bash
nano ~/atem-html-source/atem-html-source.service
```

Make sure these lines match your setup:

```ini
User=atemhtml
WorkingDirectory=/home/atemhtml/atem-html-source
```

Replace `atemhtml` with your actual username if different. Then install it:

```bash
sudo cp ~/atem-html-source/atem-html-source.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable atem-html-source
sudo systemctl start atem-html-source
```

Verify it started:

```bash
sudo systemctl status atem-html-source
```

If you see `Failed at step USER` it means the username in the service file doesn't match — edit `/etc/systemd/system/atem-html-source.service` directly, then run:

```bash
sudo systemctl daemon-reload && sudo systemctl restart atem-html-source
```

### 5. Configure lightdm for Openbox autologin

```bash
sudo nano /etc/lightdm/lightdm.conf
```

Find the `[Seat:*]` section. Delete everything between `[Seat:*]` and `[XDMCPServer]` and replace with:

```ini
[Seat:*]
autologin-user=atemhtml
autologin-user-timeout=0
user-session=openbox
autologin-session=openbox
xserver-command=X -nocursor
greeter-session=pi-greeter-labwc
greeter-hide-users=false
display-setup-script=/usr/share/dispsetup.sh
```

> Replace `atemhtml` with your actual username. Leave `[LightDM]`, `[XDMCPServer]` and `[VNCServer]` sections untouched.

### 6. Create the Openbox autostart

```bash
mkdir -p ~/.config/openbox
nano ~/.config/openbox/autostart
```

Add:

```bash
xsetroot -solid black &
xset s off &
xset -dpms &
xset s noblank &
bash ~/atem-html-source/kiosk-launch.sh &
```

### 7. Update the kiosk launch script

The correct Chromium binary on Trixie is `chromium`, not `chromium-browser`. The script also needs flags to suppress the keyring prompt.

```bash
nano ~/atem-html-source/kiosk-launch.sh
```

The file should look like this:

```bash
#!/bin/bash
# kiosk-launch.sh

xset s off
xset -dpms
xset s noblank

until curl -sf http://localhost:3000/api/config > /dev/null; do
  echo "Waiting for server..."
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
  http://localhost:3000/display
```

Make it executable:

```bash
chmod +x ~/atem-html-source/kiosk-launch.sh
```

### 8. Set HDMI resolution

Edit the Pi firmware config:

```bash
sudo nano /boot/firmware/config.txt
```

Add or update:

```ini
# Force HDMI output even with no display connected at boot
hdmi_force_hotplug=1

# Disable overscan (black borders)
disable_overscan=1

# Resolution and framerate
# The admin panel shows the correct values for your chosen output format
hdmi_group=1
hdmi_mode=33
```

Common values:

| Resolution | FPS   | hdmi_group | hdmi_mode |
|------------|-------|------------|-----------|
| 1920×1080  | 25    | 1          | 33        |
| 1920×1080  | 29.97 | 1          | 34        |
| 1920×1080  | 50    | 1          | 31        |
| 1920×1080  | 60    | 1          | 16        |
| 1280×720   | 25    | 1          | 61        |
| 1280×720   | 50    | 1          | 19        |

> **TODO:** Add an "Apply & Reboot" button to the admin panel that writes the correct `hdmi_group`/`hdmi_mode` to `/boot/firmware/config.txt` and triggers a reboot — eliminating the need to SSH in to change resolution. Requires a sudoers entry to allow Node to write config.txt and run reboot without a password.

### 9. Reboot

```bash
sudo reboot
```

The Pi should boot directly into Chromium fullscreen with no desktop visible. Allow 40–50 seconds on a 3B+.

---

## Admin panel

Access from any device on the same network:

```
http://atemhtml.local:3000
```

| Feature | Notes |
|---|---|
| HTML mode | Write any HTML/CSS; use `<style>` blocks inside the editor |
| Image mode | URL to any image accessible from the Pi |
| Colour mode | Solid fill — useful for black, chroma key green, holding slates |
| Overlay | Lower third / corner text with configurable position and inline CSS |
| Resolution selector | Shows correct `hdmi_group`/`hdmi_mode` hint for config.txt |
| Ctrl+Enter | Push changes to output instantly |

Config is saved to `config.json` and survives server restarts.

### Chroma key / luma key note

For keying over video in the ATEM:
- Set the page background to your key colour in **Colour mode** (e.g. `#00FF00` for chroma green, `#000000` for luma key on black)
- Use **HTML mode** with `background: transparent` in your CSS for the graphic layer
- On the ATEM, use **Linear Key** or **Luma Key** rather than Chroma Key — a flat digital colour from the Pi is cleaner than physical green screen and keys better with a luma or linear approach

---

## Troubleshooting

**Server not starting / `Failed at step USER`:**
```bash
sudo nano /etc/systemd/system/atem-html-source.service
# Fix User= and WorkingDirectory= to match your username
sudo systemctl daemon-reload && sudo systemctl restart atem-html-source
sudo systemctl status atem-html-source
```

**Chromium keyring password prompt on launch:**
Make sure `--password-store=basic` and `--no-first-run` are in `kiosk-launch.sh`.

**GPU errors in terminal:**
```
ERROR: ui/gl/gl_context_egl.cc GLES3 is unsupported
```
Harmless on the Pi 3B+. Chromium falls back to software rendering automatically. Display output is unaffected.

**Chromium not found:**
The binary is `chromium` on Trixie, not `chromium-browser`. Check with `which chromium`.

**Desktop or welcome screen showing instead of kiosk:**
- Check lightdm config has `user-session=openbox` and `autologin-session=openbox` with no duplicate lines overriding them below
- Check `~/.config/openbox/autostart` exists and paths are correct
- Check `kiosk-launch.sh` is executable: `chmod +x ~/atem-html-source/kiosk-launch.sh`

**HDMI not outputting / ATEM not seeing signal:**
- Confirm `hdmi_force_hotplug=1` is in `/boot/firmware/config.txt`
- Try a different `hdmi_mode` — some ATEM inputs are fussy about exact timing

**Pi 3B+ performance tips:**
- Stick to 1080p or 720p
- Avoid Canvas-heavy animations
- If rendering is slow, add `--disable-gpu-compositing` to the Chromium flags in `kiosk-launch.sh`

---

## One-command setup

> **For GitHub use:** Once the repo is public, a fresh Pi can be set up by running the install script after cloning.

```bash
git clone https://github.com/YOUR_USERNAME/atem-html-source.git
cd atem-html-source
chmod +x install.sh
./install.sh
```

> **TODO:** `install.sh` does not exist yet — this is the next thing to build. It should:
> 1. Install Node.js and npm
> 2. Run `npm install`
> 3. Substitute the current username into `atem-html-source.service`
> 4. Install and enable the systemd service
> 5. Write the Openbox autostart config
> 6. Update `kiosk-launch.sh` with correct Chromium binary (`chromium` not `chromium-browser`)
> 7. Prompt for resolution/framerate and write correct `hdmi_group`/`hdmi_mode` to `/boot/firmware/config.txt`
> 8. Add sudoers entry for Node to write config.txt and reboot (for web UI resolution control)
> 9. Reboot

---

## File structure

```
atem-html-source/
├── server.js                   # Express + WebSocket server
├── package.json
├── config.json                 # Runtime config (gitignore this)
├── atem-html-source.service    # systemd unit file
├── kiosk-launch.sh             # Chromium kiosk launcher
├── install.sh                  # One-command setup script (TODO)
├── SETUP.md                    # This file
└── public/
    ├── admin.html              # Admin control panel
    └── display.html            # Fullscreen HDMI output page
```

---

## .gitignore

```
node_modules/
config.json
```

`config.json` should not be in the repo — it is generated at runtime and will contain content specific to a particular device or production.
