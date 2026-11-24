# pi/ — Raspberry Pi (Ubuntu Server 24.04, ROS 2 Jazzy)

Numbered setup scripts for the Pi 4 will live here, each commented like the
ones in `mac/`. Run them over SSH, in order. (Not written yet.)

SD card: Raspberry Pi Imager -> Ubuntu Server 24.04 LTS (64-bit). Before first
boot, edit `network-config` and `user-data` on the card's `system-boot` volume.
Those files can hold Wi-Fi keys, so **never commit them to this repo.**
