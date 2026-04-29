# ATEM HTML Source — Redesign Spec
**Date:** 2026-04-29  
**Status:** Approved

---

## Overview

A complete rebuild of the ATEM HTML Source project, focused on a clean single-command install from GitHub, a new URL/webpage display mode, proper background colour keying support across all modes, and runtime resolution switching without a reboot. The Pi acts as a dedicated HDMI source for a Blackmagic ATEM switcher, displaying web content in a fullscreen Chromium kiosk.

---

## OS

**Raspberry Pi OS Desktop (32-bit, Trixie)** — current stable release.

Flash with Raspberry Pi Imager. Pre-configure in imager OS customisation:
- Hostname (e.g. `atemhtml`)
- Username and password
- SSH enabled
- Wi-Fi (if not using ethernet)

---

## Install Flow

```bash
git clone https://github.com/YOUR_USERNAME/atem-html-source.git
cd atem-html-source
chmod +x install.sh && ./install.sh
```

`install.sh` prompts for two things at the start:
1. Confirm hostname (pre-filled from `hostname` command)
2. Choose default output resolution and framerate from a numbered list

Then non-interactively:
1. Installs Node.js (via NodeSource if apt version < 18)
2. Runs `npm install`
3. Configures LightDM for Openbox autologin (current user, no greeter timeout)
4. Writes `~/.config/openbox/autostart`
5. Substitutes current username into `atem-html-source.service`, installs and enables it
6. Writes `kiosk-launch.sh` with correct Chromium binary and flags
7. Updates `/boot/firmware/config.txt`: `hdmi_force_hotplug=1`, `disable_splash=1`, `disable_overscan=1`, selected `hdmi_group`/`hdmi_mode`
8. Updates `/boot/firmware/cmdline.txt`: removes `splash`, adds `quiet loglevel=0`
9. Disables Plymouth splash service
10. Installs `/usr/local/bin/atem-set-hdmi` wrapper script (owned root, 755)
11. Adds sudoers rules for `atem-set-hdmi` and `reboot` without password
12. Reboots

Boot sequence after install:
```
Pi powers on (no splash)
  └── systemd: atem-html-source.service (Node.js server)
  └── lightdm autologin → Openbox
        └── ~/.config/openbox/autostart
              └── kiosk-launch.sh
                    └── waits for server ready
                    └── Chromium kiosk → http://localhost:3000/display
```

---

## Display Modes

Four modes selectable from the admin panel. **Overlay feature removed entirely.**

### Global: Background Colour
A background colour picker is visible in all modes. This is the chroma/luma key colour — it fills the display behind all content. Default: `#000000`. Used as the key colour in the ATEM (Linear Key or Luma Key recommended over Chroma Key for digital sources).

### HTML Mode
Write arbitrary HTML/CSS. Use `background: transparent` in CSS to let the key colour show through. Pushed to output via WebSocket.

### URL Mode (new)
Paste any URL. The display page loads it in a full-screen iframe.

Chromium is launched with `--disable-web-security --user-data-dir=/tmp/chromekiosk`, which causes the browser to ignore `X-Frame-Options` and `Content-Security-Policy: frame-ancestors` headers. Any URL loads regardless of embedding restrictions.

The iframe uses `allowtransparency="true"` and `background: transparent` CSS. If the loaded page has a transparent background (e.g. a broadcast graphics tool), the configured background colour shows through and can be keyed in the ATEM.

### Image Mode
Full-screen image from a URL, with a **fit mode** selector:
- **Cover** (default) — fills frame, crops edges
- **Contain** — whole image visible, background colour fills letterbox/pillarbox areas
- **Fill** — stretches to frame, ignores aspect ratio
- **Actual size** — no scaling, centred

### Colour Mode
Solid background fill only — useful as a hold colour or key colour reference.

---

## Resolution and Framerate Control

Resolution and framerate are set from the admin panel with a single **Apply** button. Behaviour depends on whether the selected mode is progressive or interlaced.

### Progressive Modes — instant, no reboot

The server runs `xrandr` with `DISPLAY=:0` to switch the HDMI output at runtime. The server also calls `sudo atem-set-hdmi GROUP MODE` to write the matching `hdmi_group`/`hdmi_mode` to `/boot/firmware/config.txt` for persistence across reboots.

| Label | fps | hdmi_group | hdmi_mode |
|-------|-----|------------|-----------|
| 1080p23.98 | 23.98 | 1 | 32 |
| 1080p24 | 24 | 1 | 32 |
| 1080p25 | 25 | 1 | 33 |
| 1080p29.97 | 29.97 | 1 | 34 |
| 1080p30 | 30 | 1 | 34 |
| 1080p50 | 50 | 1 | 31 |
| 1080p59.94 | 59.94 | 1 | 16 |
| 1080p60 | 60 | 1 | 16 |
| 720p25 | 25 | 1 | 61 |
| 720p29.97 | 29.97 | 1 | 62 |
| 720p50 | 50 | 1 | 19 |
| 720p59.94 | 59.94 | 1 | 47 |
| 720p60 | 60 | 1 | 4 |
| 576p50 (PAL SD) | 50 | 1 | 18 |
| 480p59.94 (NTSC SD) | 59.94 | 1 | 3 |

### Interlaced Modes — writes config.txt, requires reboot

xrandr on the Pi's vc4 driver does not reliably support interlaced modes at runtime. Selecting an interlaced mode writes `config.txt` and the UI shows an **Apply & Reboot** button (not the instant Apply). The Pi reboots (~45 seconds) and returns to the kiosk automatically.

| Label | Field rate | hdmi_group | hdmi_mode |
|-------|-----------|------------|-----------|
| 1080i50 | 50 fields/sec | 1 | 20 |
| 1080i59.94 | 59.94 fields/sec | 1 | 5 |
| 1080i60 | 60 fields/sec | 1 | 5 |
| 576i50 (PAL SD) | 50 fields/sec | 1 | 17 |
| 480i59.94 (NTSC SD) | 59.94 fields/sec | 1 | 6 |

### Sudoers Rules (added by install.sh)
```
USERNAME ALL=(ALL) NOPASSWD: /usr/local/bin/atem-set-hdmi
USERNAME ALL=(ALL) NOPASSWD: /sbin/reboot
```

`atem-set-hdmi` edits `hdmi_group` and `hdmi_mode` lines in `/boot/firmware/config.txt` using `sed`.

---

## Server Changes

### New endpoints
- `POST /api/resolution` — body: `{ resolution, framerate, interlaced }`. Runs xrandr for progressive modes, calls `sudo atem-set-hdmi` in all cases. Returns `{ ok, requiresReboot }`.
- `POST /api/reboot` — runs `sudo reboot`.

### Config shape
```json
{
  "mode": "html | url | image | color",
  "html": "",
  "customCss": "",
  "url": "",
  "imageUrl": "",
  "imageFit": "cover | contain | fill | none",
  "backgroundColor": "#000000",
  "resolution": "1920x1080",
  "framerate": "25",
  "interlaced": false
}
```
Overlay fields removed entirely.

---

## File Structure

```
atem-html-source/
├── server.js                  # Express + WebSocket; adds /api/resolution, /api/reboot
├── package.json
├── config.json                # gitignored, generated at runtime
├── atem-html-source.service   # USERNAME placeholder substituted by install.sh
├── kiosk-launch.sh            # Chromium with --disable-web-security
├── install.sh                 # one-command setup
├── atem-set-hdmi.sh           # sudoers wrapper: edits config.txt hdmi_group/hdmi_mode
├── SETUP.md                   # rewritten to reflect new flow
├── .gitignore                 # node_modules/, config.json
└── public/
    ├── admin.html             # rewritten: URL mode, image fit, global bg colour, no overlay
    └── display.html           # rewritten: iframe support, image fit, no overlay
```

---

## No Splash Screens

- `disable_splash=1` in `/boot/firmware/config.txt`
- `quiet loglevel=0` in `/boot/firmware/cmdline.txt` (splash token removed if present)
- Plymouth service disabled (`sudo systemctl disable plymouth`)
- LightDM `autologin-user-timeout=0`, greeter bypassed directly to Openbox session

---

## What Is Removed

- Overlay / lower-third feature (admin UI, display.html, server config fields)
- Reference to `chromium-browser` binary (replaced with `chromium` throughout)
- Manual setup steps — everything is handled by `install.sh`
