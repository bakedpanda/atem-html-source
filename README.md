# ATEM HTML Source

Turns a Raspberry Pi into a fullscreen HDMI source for a Blackmagic ATEM switcher. Display webpages, HTML graphics, images, or solid key colours — all controlled from a web admin panel.

## Quick start

Flash **Raspberry Pi OS Desktop (32-bit, Trixie)** with Raspberry Pi Imager. Boot the Pi, SSH in, then:

```bash
git clone https://github.com/YOUR_USERNAME/atem-html-source.git
cd atem-html-source
chmod +x install.sh && ./install.sh
```

The installer configures everything and reboots. Full instructions: **[SETUP.md](SETUP.md)**

## Features

- **HTML mode** — write arbitrary HTML/CSS, live-push to output
- **URL mode** — display any webpage fullscreen (bypasses X-Frame-Options)
- **Image mode** — display an image with cover/contain/fill/actual-size fit
- **Colour mode** — solid fill for hold colour or key colour reference
- **Background colour** — global key colour shown behind all content; key it in the ATEM with Linear Key or Luma Key
- **Runtime resolution switching** — progressive modes (1080p, 720p, SD) switch instantly via xrandr; interlaced modes write config.txt and reboot (~45s)

## Requirements

- Raspberry Pi 3B+ (or newer with HDMI output)
- Raspberry Pi OS Desktop (32-bit, Trixie)
- HDMI cable to ATEM switcher input
- Network connection
