# ATEM HTML Source — Setup Guide

Turns a Raspberry Pi into a fullscreen HDMI source for a Blackmagic ATEM switcher.
Display webpages, HTML graphics, images, or solid key colours — all controlled from a web admin panel.

---

## Hardware

- Raspberry Pi 3B+ (or any Pi with desktop-capable GPU)
- HDMI cable to an ATEM switcher input
- Network connection (ethernet recommended)

---

## Step 1 — Image the SD card

Download and flash **Raspberry Pi OS Desktop (32-bit, Trixie)** using Raspberry Pi Imager.

In the imager's **OS Customisation** screen, set:
- Hostname (e.g. `atemhtml`)
- Username and password
- SSH enabled
- Wi-Fi (if not using ethernet)

---

## Step 2 — Install

Boot the Pi, SSH in, then run (`git` is pre-installed on Raspberry Pi OS Desktop):

```bash
git clone https://github.com/YOUR_USERNAME/atem-html-source.git
cd atem-html-source
chmod +x install.sh && ./install.sh
```

The script asks two questions:
1. Confirm or change the hostname (applies it to the Pi and uses it in the final URL)
2. Choose default HDMI output resolution/framerate

Then it configures everything and reboots. Allow ~5 minutes for the full run on a 3B+.

---

## Step 3 — Use it

After reboot, open the admin panel from any device on the same network:

```
http://atemhtml.local:3000
```

### Display modes

| Mode | Description |
|------|-------------|
| HTML | Write any HTML/CSS. Use `background: transparent` to key over video. |
| URL | Paste any webpage URL — loads in a fullscreen embedded browser. |
| Image | Display an image from a URL. Choose fit mode (cover/contain/fill/actual). |
| Colour | Solid fill — for hold colour or key colour reference. |

### Background colour

The **background colour** setting (visible in all modes) fills the display behind all content. Set this to your chroma or luma key colour. In the ATEM, use **Linear Key** or **Luma Key** — a flat digital colour from the Pi keys better than physical green screen.

For transparent HTML or URL content, the background colour shows through and can be keyed.

### Resolution and framerate

Select from the **HDMI output** dropdown in the right panel:

- **Progressive modes** (1080p, 720p, SD) — applied instantly, no reboot
- **Interlaced modes** (1080i, 576i, 480i) — click **Apply & Reboot**, Pi returns in ~45 seconds

### Ctrl+Enter

Keyboard shortcut to push current settings to the output instantly.

---

## Troubleshooting

**Server not starting:**
```bash
sudo systemctl status atem-html-source
sudo journalctl -u atem-html-source -n 50
```

**HDMI not outputting / ATEM not seeing signal:**
- Confirm `hdmi_force_hotplug=1` is in `/boot/firmware/config.txt`
- Try a different HDMI mode from the admin panel

**GPU errors in terminal (`GLES3 is unsupported`):**
Harmless on 3B+. Chromium falls back to software rendering automatically.

**Chromium not found:**
The binary is `chromium` on Trixie. Check with `which chromium`. If missing, install with:
```bash
sudo apt install chromium
```

**Pi 3B+ performance tips:**
- Stick to 1080p or 720p
- Avoid canvas-heavy animations
- If rendering is slow, add `--disable-gpu-compositing` to the Chromium flags in `kiosk-launch.sh`

---

## File structure

```
atem-html-source/
├── server.js                  # Node.js server
├── package.json
├── config.json                # Runtime config (gitignored)
├── atem-html-source.service   # systemd unit
├── kiosk-launch.sh            # Chromium kiosk launcher
├── atem-set-hdmi.sh           # Sudoers wrapper for HDMI mode changes
├── install.sh                 # One-command setup script
├── SETUP.md                   # This file
└── public/
    ├── admin.html             # Admin control panel
    └── display.html           # Fullscreen HDMI output page
```
