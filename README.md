# ATEM HTML Source — Raspberry Pi Setup

A Node.js server that drives a fullscreen HTML page via HDMI into a Blackmagic ATEM switcher.

## Requirements
- Raspberry Pi 4 or 5 (Pi 4 with 4GB+ recommended for smooth rendering)
- Raspberry Pi OS with Desktop (for Chromium kiosk)
- Node.js 18+ (`sudo apt install nodejs npm`)
- HDMI cable to your ATEM input

---

## Quick start

```bash
# Copy project to Pi
scp -r atem-html-source pi@raspberrypi.local:~/

# SSH in and install
ssh pi@raspberrypi.local
cd ~/atem-html-source
npm install

# Start the server
node server.js
```

Then open `http://raspberrypi.local:3000` from any device on your network.

---

## Set HDMI resolution on the Pi

Edit `/boot/config.txt` (Raspberry Pi OS Bullseye) or `/boot/firmware/config.txt` (Bookworm):

```ini
# Example: 1080p25 for PAL production
hdmi_group=1
hdmi_mode=33

# Disable overscan
disable_overscan=1

# Force HDMI output even without display connected
hdmi_force_hotplug=1
```

The admin panel shows you the correct `hdmi_group` and `hdmi_mode` values for your selected resolution and framerate.

Common modes:
| Resolution | FPS   | hdmi_group | hdmi_mode |
|------------|-------|-----------|-----------|
| 1920×1080  | 25    | 1         | 33        |
| 1920×1080  | 50    | 1         | 31        |
| 1920×1080  | 29.97 | 1         | 34        |
| 1280×720   | 50    | 1         | 19        |
| 1280×720   | 25    | 1         | 61        |

---

## Auto-start on boot

### 1. Install the systemd service

```bash
sudo cp ~/atem-html-source/atem-html-source.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable atem-html-source
sudo systemctl start atem-html-source
```

### 2. Auto-launch Chromium kiosk

Add to `/etc/xdg/lxsession/LXDE-pi/autostart`:

```
@bash /home/pi/atem-html-source/kiosk-launch.sh
```

Or for Wayland (Pi 5 / Bookworm), add to `~/.config/wayfire.ini`:

```ini
[autostart]
server = bash /home/pi/atem-html-source/kiosk-launch.sh
```

---

## Admin panel tips

- **Ctrl+Enter** — push changes to output instantly
- **HTML mode** — write any HTML/CSS; use `<style>` blocks inside the HTML editor for scoped styles
- **Image mode** — point to a local file served by the Pi, a network URL, or even another Pi on the same LAN
- **Colour mode** — solid colour fill (useful for test patterns, black, chroma key green, etc.)
- **Overlay** — adds a lower-third or corner text overlay; style it with inline CSS
- Changes push live over WebSocket — the display page updates within ~50ms

---

## Framerate note

The Pi's HDMI output framerate is set in `/boot/config.txt` and controlled by the OS — the browser runs at whatever the display refresh rate is. The framerate selector in the admin UI updates the `hdmi_mode` hint so you know which value to set in config.txt. It does not dynamically change the output framerate at runtime (that requires a reboot).

---

## Network access

The server binds to `0.0.0.0:3000`. Access the admin from any device on your LAN:

```
http://<pi-ip-address>:3000
```

Find the Pi's IP with: `hostname -I`
