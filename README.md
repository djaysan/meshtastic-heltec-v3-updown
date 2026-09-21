# Meshtastic Heltec V3 up/down toggle build

Meshtastic firmware **v2.7.26** for the Heltec WiFi LoRa 32 V3 with two small patches:

1. The config-driven up/down/select input (`canned_message.updown1_enabled` plus the three `inputbroker_pin_*` GPIOs) is compiled back in. Stock builds since 2.7.16 only include it for boards that define `INPUTDRIVER_ENCODER_TYPE 2` at build time, so on a plain Heltec V3 the setting is silently ignored. See upstream issue [meshtastic/firmware#9707](https://github.com/meshtastic/firmware/issues/9707), closed as stale.
2. The side (PRG) button is remapped, since the toggle already handles screen navigation and menus.

Built for the [Muzi H1 remix case](https://www.printables.com/model/853651-meshtastic-muzi-h1-remix-1100mah-version-no-brandi) with a 3-way toggle and a PWM buzzer, but it works with any up/down/select wiring.

## Flash

Browser flasher (Chrome or Edge, USB): **https://djaysan.github.io/meshtastic-heltec-v3-updown/**

- **Update** writes only the app partition at `0x10000`. Config survives.
- **Factory install** writes bootloader, partitions and app from address 0. Use on a blank board and reconfigure afterwards.

Command line equivalent of Update:

```
esptool --port /dev/cu.usbserial-0001 --baud 921600 write-flash 0x10000 firmware-heltec-v3-2.7.26-updown-update.bin
```

Never accept an over-the-air update from the phone app on a patched node. It reinstalls stock firmware and the toggle goes dead again.

## Node config

| Setting | Value |
|---|---|
| `canned_message.enabled` | true |
| `canned_message.updown1_enabled` | true |
| `canned_message.inputbroker_pin_a` | up GPIO (26 on the Muzi H1 remix) |
| `canned_message.inputbroker_pin_b` | down GPIO (19) |
| `canned_message.inputbroker_pin_press` | push GPIO (20) |
| `device.button_gpio` | 0 (leave default, side button is GPIO 0) |

The `inputbroker_event_*` values are ignored by 2.7.15 and later. Events are fixed in firmware.

## Buttons

| Input | Action |
|---|---|
| Toggle down / up | Next / previous screen. In a menu: next / previous item. |
| Toggle push | Open the menu for the current screen, or select. |
| Side button, short press | Open the preset list, broadcast on the primary channel. Press again to close. |
| Side button, hold 0.5 s | Back. Closes any menu or list. |
| Side button, hold 4 s | Shutdown. |

## Rebuild

```
git clone --depth 1 --branch v2.7.26.54e0d8d --recurse-submodules --shallow-submodules https://github.com/meshtastic/firmware.git
cd firmware
git apply ../heltec-v3-updown.patch
pio run -e heltec-v3
# .pio/build/heltec-v3/firmware-heltec-v3-2.7.26.54e0d8d.bin          -> update image (0x10000)
# .pio/build/heltec-v3/firmware-heltec-v3-2.7.26.54e0d8d.factory.bin  -> factory image (0x0)
```

The patch touches `variants/esp32s3/heltec_v3/platformio.ini` (one build flag) and `src/input/InputBroker.cpp` (side button mapping, guarded by `HELTEC_V3`). It should apply to nearby releases with little or no change.

## License

Derived from [meshtastic/firmware](https://github.com/meshtastic/firmware), GPL-3.0. The patch and binaries here are under the same license.
