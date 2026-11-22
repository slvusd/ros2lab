# macros2 — ROS 2 Jazzy ground station on a Mac

Goal: run the SLVROV ground-station (controller) side of the ROV on a Mac
instead of a Raspberry Pi, so more students can learn ROS 2.

- ROV: Raspberry Pi 4, Ubuntu 24.04, ROS 2 **Jazzy**, Fast DDS, `ROS_DOMAIN_ID=42`
- Mac: ROS 2 Jazzy from **RoboStack** (conda packages), inside an isolated
  micromamba environment named `ros_jazzy`.
- Baseline robot code: `slvusd/slvrov_ros` commit `d8f8746` (2026-04-23).

## Layout
| Path | What it is |
|---|---|
| `scripts/` | Shared setup, run in numeric order (micromamba, environment). |
| `nodes/<name>/install.sh` | One installer per ROS node/package, each with its own README. |
| `config/` | DDS (discovery) configuration. |
| `launch/` | Launch files. |
| `docs/STEPS.md` | Plain-English log of exactly what each step changes on your Mac. |
| `nodes/pico_bridge/`, `nodes/microbit_gateway/` | USB-serial bridges for Pico 2 and micro:bit (radio) boards. |
| `docs/NETWORKING.md` | Ports, VLAN/VPN options and SSH-tunnel notes (research, untested). |

## Quick start
```bash
./scripts/00_install_micromamba.sh   # installs the conda-style tool
./scripts/01_create_ros_env.sh       # creates the isolated ROS 2 Jazzy env
source scripts/env.sh                # activate it in THIS terminal
./nodes/demo_talker_listener/install.sh   # check ROS 2 works
```
Every script is safe to re-run, and says what it will do before it does it.
To remove everything: `micromamba env remove -n ros_jazzy`.
