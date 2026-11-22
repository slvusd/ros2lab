# Networking notes: ports, VLANs, VPNs and SSH tunnels

Status: **research notes, not yet tested** with the real Pi. Anything marked
*(unverified)* is from general knowledge and should be checked before relying on it.

## 1. How ROS 2 talks (context)
ROS 2 has no central server or "backbone" to register a node with. Nodes find
each other through DDS (the middleware) and exchange data over **UDP**.
The ROV uses **Fast DDS** with `ROS_DOMAIN_ID=42` (from `slvrov_ros/start_rov.sh`).
Nodes on the same machine mostly use shared memory, with no network ports.

## 2. Ports used
Formula (UDP): with `domain` = `ROS_DOMAIN_ID` and `participant` = 0, 1, 2...
(one per ROS process on a machine):

| Purpose | Port | Domain 0 | Domain 42 (ROV) |
|---|---|---|---|
| Multicast discovery | 7400 + 250*domain | 7400 | 17900 |
| Unicast discovery | 7410 + 250*domain + 2*participant | 7410, 7412... | 17910, 17912... |
| Data | 7411 + 250*domain + 2*participant | 7411, 7413... | 17911, 17913... |

- Default discovery also uses multicast address `239.255.0.1`.
- Firewall rule for domain 42 between two devices: allow UDP ~17900-18100.
- macOS asks "allow incoming connections?" the first time a ROS program opens a
  port. Click Allow.
- Other ports: SSH is TCP 22 (`start_rov.sh` uses it). The repo also contains
  mediamtx, GStreamer and a web UI; their ports have **not** been reviewed.
- See what is open while ROS runs: `lsof -iUDP -P | grep -i ros`.

## 3. Goal: devices on different VLANs / Wi-Fi hotspots must talk
Constraints: stay inside the school network; the school blocks some traffic out
of caution and does not care about ROS 2 specifically.

**Simplest option: ask IT for a narrow firewall rule.** Allow UDP between your
specific device IPs on the DDS ports above (plus ICMP for testing). No tunnel needed.

**Direct cable for the ROV.** The Mac and Pi 4 can use a USB-ethernet cable with
static IPs and Fast DDS unicast peers. This never touches a VLAN. Overlay networks
are only needed for *other* devices (extra student Macs, monitoring).

### Overlay (VPN-like) options
| Option | Notes |
|---|---|
| **WireGuard hub** (recommended) | One always-on device on a segment everyone can reach. Each device connects out to it over one UDP port (e.g. 51820). You manage keys. Traffic stays inside the school. |
| Headscale | Self-hosted control server for Tailscale clients. More setup. |
| Nebula / self-hosted ZeroTier | Alternatives with their own lighthouse/controller. |
| Tailscale (hosted) | **Not preferred here:** login/coordination runs through Tailscale's cloud and some traffic may relay via internet servers. |

Requirements and cautions for any overlay:
- **Discovery must be unicast.** Multicast generally does not cross a VPN. List each
  peer's overlay IP in the Fast DDS XML.
- **MTU:** set the tunnel MTU to about 1280-1400 and keep the Fast DDS
  `maxMessageSize` below it, or discovery and data can silently fail.
- **Latency/jitter:** fine for monitoring and cameras; use the direct cable for the
  thruster control loop.
- **Hotspot client isolation** cannot be fixed by a VPN. Devices must still reach
  the hub, so put it on a wired segment both sides can reach.
- If the school blocks all UDP between VLANs, a tunnel cannot form either.

## 4. Only SSH (TCP 22) is open to a machine
DDS is UDP, and `ssh -L` forwards only TCP, so you cannot just forward DDS ports.
Options:

1. **Fast DDS over TCP, tunneled by SSH.** Configure a TCPv4 transport: the Pi as TCP
   server on a port (e.g. 5100), the Mac as client, then
   `ssh -L 5100:localhost:5100 user@pi`. Unicast discovery to a known peer required.
   Keeps `rmw_fastrtps_cpp`, so the robot's middleware is unchanged. Fiddly to configure.
2. **Zenoh** (`rmw_zenoh_cpp`, or `zenoh-bridge-ros2dds`). A router on the Pi, the
   Mac as a client over TCP (default 7447), tunneled with `ssh -L`. Built for
   firewalled links and simpler than raw DDS over TCP. Needs both ends to install
   it; availability in RoboStack for Jazzy *(unverified)*.
3. **`ssh -w` tunnel device** carries UDP so DDS works unchanged, but needs
   `PermitTunnel` and root on the Pi, and macOS OpenSSH does not support it, so it
   will not work from a Mac *(unverified)*.

Cautions: the SSH server must allow `AllowTcpForwarding`. TCP over SSH stalls on
packet loss, so it suits monitoring better than real-time driving.

## 5. Policy
Tunneling over an approved port, or running an overlay, can bypass network
filtering. The stated aim is only to let our own ROS devices communicate across
VLANs/hotspots. Tell district IT what you are doing and why; a narrow firewall
rule (section 3) is the cleanest fix.

## 6. Suggested next steps
- [ ] Get `fastdds_config.xml` from the Pi, then write the Mac-side unicast config in `config/`.
- [ ] Prototype Fast DDS TCP + `ssh -L` locally (two processes on the Mac) before the Pi arrives.
- [ ] If an overlay is wanted: add a `networking/` folder with a WireGuard hub script, client script and an overlay-IP Fast DDS file.
