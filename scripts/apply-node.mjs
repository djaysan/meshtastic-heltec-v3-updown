#!/usr/bin/env node
// Command line twin of the Configure section on index.html.
//
// Same applyConfig, same options model, same step log. Only the transport
// differs: a Node serial port instead of Web Serial, so the exact logic the
// page runs can be exercised against a node plugged into this machine.
//
//   node scripts/apply-node.mjs --port /dev/cu.usbserial-0001 --options options.json

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MeshDevice } from '@meshtastic/core';
import { TransportNodeSerial } from '@meshtastic/transport-node-serial';

import { applyConfig, planSteps } from '../src/apply-config.js';

const USAGE = `
Push Meshtastic node settings over a USB serial port.

Usage:
  node scripts/apply-node.mjs --port <device> [--options <file.json>] [--dry-run]

Options:
  --port, -p <device>    Serial port, e.g. /dev/cu.usbserial-0001 or COM3
  --options, -o <file>   JSON file with the settings to apply
                         (default: scripts/options-example.json)
  --baud, -b <rate>      Serial baud rate (default: 115200)
  --dry-run              Read and print the planned steps, connect to nothing
  --help, -h             Show this text

The options file uses the same model as the browser form. Every field is
optional, and anything left out is left alone on the node:

  region          RegionCode name, e.g. "EU_868"
  modemPreset     ModemPreset name, e.g. "LONG_FAST"
  longName        node long name
  shortName       node short name, 4 characters
  channelUrl      https://meshtastic.org/e/#... sharing link
  cannedMessages  array of strings, joined with "|", 200 characters total
  ringtone        RTTTL string, 230 characters
  toggle          { "enabled": true, "pinUp": 26, "pinDown": 19, "pinPress": 20 }
  buzzer          { "enabled": true, "pin": 47 }
  sendBell        true or false
  tzdef           POSIX TZ string

Example:
  node scripts/apply-node.mjs --port /dev/cu.usbserial-0001 \\
    --options scripts/options-example.json
`.trim();

/** Turn argv into a flags object. Unknown flags stop the run. */
function parseArgs(argv) {
  const args = { baud: 115200, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new Error(`${flag} needs a value.`);
      }
      i += 1;
      return value;
    };
    switch (flag) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--port':
      case '-p':
        args.port = next();
        break;
      case '--options':
      case '-o':
        args.options = next();
        break;
      case '--baud':
      case '-b':
        args.baud = Number.parseInt(next(), 10);
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      default:
        throw new Error(`Unknown option "${flag}". Run with --help.`);
    }
  }
  return args;
}

// Symbols matching the browser status list.
const MARK = { running: '...', done: ' ok', error: 'ERR' };

/** Print one step transition. */
function logStep(step, status, detail) {
  const mark = MARK[status] ?? '   ';
  const suffix = detail ? `  ${detail}` : '';
  console.log(`[${mark}] ${step}${suffix}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  // fileURLToPath, not URL.pathname: a path with a space would arrive as %20.
  const defaultOptions = fileURLToPath(new URL('options-example.json', import.meta.url));
  const optionsPath = args.options ? resolve(args.options) : defaultOptions;
  let options;
  try {
    options = JSON.parse(await readFile(optionsPath, 'utf8'));
  } catch (error) {
    console.error(`Could not read the options file ${optionsPath}: ${error.message}`);
    return 1;
  }

  console.log(`Options: ${optionsPath}`);
  console.log('Planned steps:');
  for (const step of planSteps(options)) {
    console.log(`  - ${step.id}: ${step.label}`);
  }

  if (args.dryRun) {
    console.log('\nDry run, nothing was sent.');
    return 0;
  }

  if (!args.port) {
    console.error('\nNo --port given. Run with --help, or list ports with: ls /dev/cu.*');
    return 1;
  }

  console.log(`\nOpening ${args.port} at ${args.baud} baud`);
  let device;
  let transport;
  try {
    transport = await TransportNodeSerial.create(args.port, args.baud);
    device = new MeshDevice(transport);

    // configure() asks the node for its whole settings set. It only settles
    // once the radio acks, and a wantConfigId is never acked, so it is fired
    // and not awaited. applyConfig waits for the settings that come back.
    device.configure().catch(() => {});

    await applyConfig(device, options, logStep);
    console.log('\nRebooting, unplug and plug the next node.');
    return 0;
  } catch (error) {
    console.error(`\nFailed: ${error.message}`);
    return 1;
  } finally {
    try {
      // The node reboots right after commit, so the library's disconnect can
      // wait forever for an ack that never comes. Give it three seconds, then move on.
      const closing = device ? device.disconnect() : transport ? transport.disconnect() : null;
      if (closing) {
        await Promise.race([closing, new Promise((resolve) => setTimeout(resolve, 3000))]);
      }
    } catch {
      // The node is rebooting, a failed close here does not matter.
    }
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error?.message ?? error);
    process.exit(1);
  });
