#!/usr/bin/env bash
# usbnet.sh - find a USB ethernet adapter on macOS and give it a static IP.
#
#   scripts/usbnet.sh                      interactive: pick adapter, enter IP
#   scripts/usbnet.sh list                 show candidate adapters
#   scripts/usbnet.sh set 10.0.3.50        static IP, /24, no router
#   scripts/usbnet.sh set 10.0.3.50 -s "AX88179B" -m 255.255.255.0 -r 10.0.3.1 -d 10.0.3.1
#   scripts/usbnet.sh dhcp [-s SERVICE]    switch adapter back to DHCP
#   scripts/usbnet.sh show [-s SERVICE]    show current settings
#   scripts/usbnet.sh help | --help | -h   this text
#
# Options (after the command):
#   -s, --service NAME   network service to change (default: auto-detect/ask)
#   -m, --mask MASK      subnet mask (default 255.255.255.0)
#   -r, --router IP      gateway (default none, so Wi-Fi keeps the internet)
#   -d, --dns "IP ..."   DNS servers (default unchanged)
#
# Only the ethernet adapter's own service is touched; Wi-Fi is never changed.
# Changing settings needs admin rights: the script calls sudo for you.
set -euo pipefail

SERVICE=""; MASK="255.255.255.0"; ROUTER=""; DNS=""

# Print "service|device" for every network service that looks like a wired
# adapter (has an enN device, not Wi-Fi / Thunderbolt Bridge / iPhone).
candidates() {
  local name dev
  networksetup -listnetworkserviceorder | awk '
    /^\([0-9]+\)/ { sub(/^\([0-9]+\) /, ""); name=$0; next }
    /Hardware Port:/ {
      if (match($0, /Device: [^)]+/)) {
        dev = substr($0, RSTART+8, RLENGTH-8)
        if (dev ~ /^en[0-9]+$/ && dev != "en0" && name !~ /Wi-?Fi|iPhone|Thunderbolt/)
          print name "|" dev
      }
    }' | while IFS='|' read -r name dev; do
    ifconfig "$dev" >/dev/null 2>&1 && echo "$name|$dev"
  done || true
}

link_status() { ifconfig "$1" 2>/dev/null | awk '/status:/ {print $2}' || true; }
cur_ip()      { ifconfig "$1" 2>/dev/null | awk '/inet / {print $2; exit}' || true; }

print_list() {
  local i=0 name dev st ip
  printf "%-3s %-28s %-7s %-9s %s\n" "#" "SERVICE" "DEVICE" "LINK" "IP"
  while IFS='|' read -r name dev; do
    i=$((i+1)); st=$(link_status "$dev"); ip=$(cur_ip "$dev")
    printf "%-3s %-28s %-7s %-9s %s\n" "$i" "$name" "$dev" "${st:-?}" "${ip:--}"
  done < <(candidates)
  [ "$i" -gt 0 ] || { echo "No wired network services found." >&2; return 1; }
}

# Choose a service: --service wins; else the only one with link "active";
# else ask.
pick_service() {
  [ -n "$SERVICE" ] && return 0
  local names=() devs=() active=() name dev
  while IFS='|' read -r name dev; do
    names+=("$name"); devs+=("$dev")
    [ "$(link_status "$dev")" = "active" ] && active+=("${#names[@]}")
  done < <(candidates)
  [ "${#names[@]}" -gt 0 ] || { echo "No wired network services found." >&2; exit 1; }
  if [ "${#names[@]}" -eq 1 ]; then
    SERVICE="${names[0]}"
    echo "Using the only wired adapter present: $SERVICE (${devs[0]})"
    return 0
  fi
  if [ "${#active[@]}" -eq 1 ]; then
    SERVICE="${names[$((active[0]-1))]}"
    echo "Using the only adapter with a live link: $SERVICE (${devs[$((active[0]-1))]})"
    return 0
  fi
  [ -t 0 ] || { echo "Several candidates; pass -s SERVICE (see: $0 list)" >&2; exit 1; }
  [ "${#active[@]}" -eq 0 ] && echo "(No adapter reports a live link - is the cable plugged in?)"
  print_list
  local n; read -rp "Which number? " n
  [[ "$n" =~ ^[0-9]+$ ]] && [ "$n" -ge 1 ] && [ "$n" -le "${#names[@]}" ] \
    || { echo "Invalid choice." >&2; exit 1; }
  SERVICE="${names[$((n-1))]}"
}

valid_ip() {
  [[ "$1" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]] || return 1
  local o; for o in "${BASH_REMATCH[@]:1}"; do [ "$o" -le 255 ] || return 1; done
}

cmd_set() {
  local ip="${1:-}"
  if [ -z "$ip" ]; then
    read -rp "Static IP (e.g. 10.0.3.50): " ip
  fi
  valid_ip "$ip" || { echo "Bad IP: $ip" >&2; exit 1; }
  pick_service
  echo "Setting '$SERVICE' -> $ip mask $MASK router ${ROUTER:-none}"
  # An empty router keeps the adapter from becoming a default route, which
  # would otherwise steal internet traffic from Wi-Fi.
  sudo networksetup -setmanual "$SERVICE" "$ip" "$MASK" ${ROUTER:+"$ROUTER"}
  if [ -n "$DNS" ]; then sudo networksetup -setdnsservers "$SERVICE" $DNS; fi
  cmd_show
}

cmd_dhcp() {
  pick_service
  sudo networksetup -setdhcp "$SERVICE"
  sudo networksetup -setdnsservers "$SERVICE" empty
  cmd_show
}

cmd_show() {
  pick_service
  networksetup -getinfo "$SERVICE"
}

usage() { sed -n '2,/^set -e/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

main() {
  local cmd="${1:-}"; [ $# -gt 0 ] && shift
  local pos=()
  while [ $# -gt 0 ]; do
    case "$1" in
      -s|--service) SERVICE="$2"; shift 2;;
      -m|--mask)    MASK="$2"; shift 2;;
      -r|--router)  ROUTER="$2"; shift 2;;
      -d|--dns)     DNS="$2"; shift 2;;
      -h|--help)    usage;;
      *)            pos+=("$1"); shift;;
    esac
  done
  case "$cmd" in
    ""|interactive) cmd_set "";;
    list)           print_list;;
    set)            cmd_set "${pos[0]:-}";;
    dhcp)           cmd_dhcp;;
    show)           cmd_show;;
    -h|--help|help) usage;;
    *)              usage 1;;
  esac
}
main "$@"
