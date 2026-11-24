# ros2lab — ROS 2 Jazzy for the classroom and the ROV

ROS 2 for students and the SLVROV vehicle, on two kinds of machine:
a **Mac** (ground station / learning station) and a **Raspberry Pi 4** (on the ROV
or a bench controller). The repo is meant to be cloned on both.

- Pi: Ubuntu 24.04 LTS, ROS 2 **Jazzy** (apt), Fast DDS, `ROS_DOMAIN_ID=42`
- Mac: ROS 2 Jazzy from **RoboStack** (conda packages), in an isolated
  micromamba environment named `ros_jazzy`.
- Baseline robot code: `slvusd/slvrov_ros` commit `d8f8746` (2026-04-23).

## Layout
| Path | What it is |
|---|---|
| `mac/` | Mac setup, run in numeric order (micromamba, environment). |
| `pi/` | Raspberry Pi setup scripts (to be written). |
| `nodes/<name>/install.sh` | One installer per ROS node/package, each with its own README. |
| `config/` | DDS (discovery) configuration. |
| `launch/` | Launch files. |
| `docs/STEPS.md` | Plain-English log of exactly what each step changes on your Mac. |
| `nodes/serial_bridge/`, `nodes/pico/`, `nodes/microbit/` | One generic USB-serial bridge, plus Pico 2 and micro:bit (radio) example programs. Protocol: `docs/PROTOCOL.md`. |
| `docs/NETWORKING.md` | Ports, VLAN/VPN options and SSH-tunnel notes (research, untested). |

## Quick start
```bash
./mac/00_install_micromamba.sh   # installs the conda-style tool
./mac/01_create_ros_env.sh       # creates the isolated ROS 2 Jazzy env
source mac/env.sh                # activate it in THIS terminal
./nodes/demo_talker_listener/install.sh   # check ROS 2 works
```
Every script is safe to re-run, and says what it will do before it does it.
To remove everything: `micromamba env remove -n ros_jazzy`.
