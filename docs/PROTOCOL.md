# Topic protocol for Pico and micro:bit (plain text lines)

One line = one message. The same lines are used over USB serial (Pico) and over
the micro:bit radio. No libraries are needed on the device: just `print()` and
string splitting.

| Prefix | Line | Direction | Meaning |
|---|---|---|---|
| `p:` publish | `p:temp,23.5` | device -> Mac | publish a value on channel `temp` |
| `s:` subscribe | `s:led` | device -> Mac | "send me messages for channel `led`" |
| `m:` message | `m:led,1` | Mac -> device | a value for channel `led` |

Rules
- Channel names: lower-case letters, digits and `_`, not starting with a digit
  (the Mac bridge cleans other names up, e.g. `Bad Name!` -> `bad_name_`).
- Value = everything after the **first** comma. Numbers and text only.
- Re-send `s:<name>` every few seconds so a bridge started later still learns it.
- Radio packets are 32 bytes max, so keep the whole line (`m:led,1`) short.

## ROS topics the bridge creates (`<ns>` = `pico` or `microbit`)
| Line | ROS topic | Type |
|---|---|---|
| `p:temp,23.5` | `/<ns>/temp` | `std_msgs/Float32` if the value is a number, else `std_msgs/String` |
| `s:led` | `/<ns>/in/led` | `std_msgs/String`; whatever is published there is sent to the device as `m:led,<text>` |

- A channel's type is fixed by its first message; later messages of the other type are dropped with a warning.
- The bridge creates at most 32 publishers and 32 subscribers, so stray packets cannot flood ROS.
- To send a number to a device, publish its text:
  `ros2 topic pub --once /pico/in/led std_msgs/msg/String "{data: '1'}"`
- Radio is a shared, unencrypted broadcast. Every micro:bit in the group hears
  every line, so a micro:bit "subscribes" by ignoring `m:` lines for other channels.
  Give boards distinct channel names (e.g. `team3_temp`) so topics do not collide.
