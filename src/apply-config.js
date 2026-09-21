// Transport-agnostic node configuration for the Heltec V3 up/down toggle build.
//
// Works against any connected MeshDevice from @meshtastic/core, so the exact same
// logic drives the browser page (Web Serial) and the Node CLI (node serial port).
//
// The one rule that matters here: AdminMessage.set_config and set_module_config
// REPLACE a whole section. Sending {region: 'EU_868'} as the lora section would
// zero tx power, hop limit, channel number and everything else. So every write
// starts from the section the device just sent us, changes only the chosen
// fields, and sends the complete section back.

import { clone, create, fromBinary, toBinary } from '@bufbuild/protobuf';
import * as Protobuf from '@meshtastic/protobufs';
import { Types } from '@meshtastic/core';

// Firmware string limits, from the nanopb options in meshtastic/protobufs:
//   meshtastic/cannedmessages.options -> CannedMessageModuleConfig.messages max_size:201
//   meshtastic/admin.options          -> AdminMessage.set_ringtone_message   max_size:231
// max_size counts the trailing NUL, so the usable payload is one byte less.
export const CANNED_MESSAGES_MAX = 200;
export const RINGTONE_MAX = 230;

// Short name is four bytes in the firmware UI and node list.
export const SHORT_NAME_MAX = 4;

// How long to wait for the settings a configure() request pulls down.
const CONFIG_READ_TIMEOUT_MS = 20000;

// The caller may already have a configure() in flight when applyConfig starts.
// Give that one this long to land before asking again ourselves.
const INITIAL_CONFIG_WAIT_MS = 2500;

// The device reboots on commit, so its ack for that packet often never arrives.
// Stop waiting after this and treat it as success.
const COMMIT_ACK_TIMEOUT_MS = 8000;

const encoder = new TextEncoder();

/** Byte length of a string as the firmware counts it. */
export function byteLength(text) {
  return encoder.encode(text ?? '').length;
}

/** Join preset messages the way the canned message module expects them. */
export function joinCannedMessages(messages) {
  return (messages ?? [])
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('|');
}

/** Every RegionCode name the protobufs know about, minus the placeholder UNSET. */
export function regionNames() {
  return Object.keys(Protobuf.Config.Config_LoRaConfig_RegionCode)
    .filter((key) => Number.isNaN(Number(key)) && key !== 'UNSET');
}

/** Every ModemPreset name the protobufs know about. */
export function modemPresetNames() {
  return Object.keys(Protobuf.Config.Config_LoRaConfig_ModemPreset)
    .filter((key) => Number.isNaN(Number(key)));
}

/**
 * The steps applyConfig will run for a given options model, so a caller can
 * render the whole list as "pending" before anything is sent.
 */
export function planSteps(options = {}) {
  const steps = [{ id: 'read', label: 'Read current settings from the node' }];
  if (options.longName || options.shortName) {
    steps.push({ id: 'owner', label: 'Set node name' });
  }
  if (options.region || options.modemPreset || options.channelUrl) {
    steps.push({ id: 'lora', label: 'Set region and modem preset' });
  }
  if (options.channelUrl) {
    steps.push({ id: 'channels', label: 'Apply channels from the URL' });
  }
  if (hasDeviceChanges(options)) {
    steps.push({ id: 'device', label: 'Set device options (button, buzzer pin, timezone)' });
  }
  if (options.toggle || typeof options.sendBell === 'boolean') {
    steps.push({ id: 'canned-module', label: 'Set canned message module (toggle input)' });
  }
  if (options.buzzer) {
    steps.push({ id: 'ext-notification', label: 'Set external notification (buzzer)' });
  }
  if (options.cannedMessages?.length) {
    steps.push({ id: 'messages', label: 'Write preset messages' });
  }
  if (options.ringtone) {
    steps.push({ id: 'ringtone', label: 'Write ringtone' });
  }
  steps.push({ id: 'commit', label: 'Save and reboot' });
  return steps;
}

/** True when anything in config.device needs touching. */
function hasDeviceChanges(options) {
  return Boolean(options.toggle?.enabled || options.buzzer || options.tzdef);
}

/**
 * Push settings to a connected, configured MeshDevice.
 *
 * @param {import('@meshtastic/core').MeshDevice} device connected device
 * @param {object} options form model, every field optional
 * @param {(step: string, status: 'running'|'done'|'error', detail?: string) => void} log progress sink
 */
export async function applyConfig(device, options = {}, log = () => {}) {
  validateOptions(options);

  // Subscribe before asking, so nothing is missed.
  const current = watchDevice(device);
  const configured = waitForConfigured(device);

  log('read', 'running');
  try {
    // If the caller just called configure(), the config set is already on its
    // way, so wait for that first.
    let arrived = await resolvesWithin(configured.promise, INITIAL_CONFIG_WAIT_MS);
    if (!arrived) {
      // Nothing came, so request it ourselves. The device replays config,
      // module config, channels and my node info, which is the snapshot every
      // write below starts from. Safe to call on an already configured device.
      //
      // configure() only settles when the radio acks, and it never acks a
      // wantConfigId, so it is fired and not awaited. The DeviceConfigured
      // status event is what tells us the replay finished.
      ignoreRejection(device.configure());
      arrived = await resolvesWithin(configured.promise, CONFIG_READ_TIMEOUT_MS);
    }
    if (!arrived) {
      throw new Error(`no settings received within ${Math.round(CONFIG_READ_TIMEOUT_MS / 1000)}s`);
    }
  } catch (error) {
    current.stop();
    log('read', 'error', error.message);
    throw new Error(`Could not read the current settings from the node: ${error.message}`);
  } finally {
    configured.cancel();
  }
  log('read', 'done', describeSnapshot(current.state));

  try {
    // Everything from here is one edit transaction. The device applies it all
    // at commit time and reboots once, instead of rebooting per section.
    await device.beginEditSettings();

    if (options.longName || options.shortName) {
      await runStep(log, 'owner', () => setOwner(device, options, current.state));
    }

    const channelSet = options.channelUrl ? decodeChannelUrl(options.channelUrl) : null;

    if (options.region || options.modemPreset || channelSet) {
      await runStep(log, 'lora', () => setLora(device, options, current.state, channelSet));
    }

    if (channelSet) {
      await runStep(log, 'channels', () => setChannels(device, channelSet));
    }

    if (hasDeviceChanges(options)) {
      await runStep(log, 'device', () => setDevice(device, options, current.state));
    }

    if (options.toggle || typeof options.sendBell === 'boolean') {
      await runStep(log, 'canned-module', () => setCannedModule(device, options, current.state));
    }

    if (options.buzzer) {
      await runStep(log, 'ext-notification', () => setExternalNotification(device, options, current.state));
    }

    if (options.cannedMessages?.length) {
      await runStep(log, 'messages', () => setMessages(device, options));
    }

    if (options.ringtone) {
      await runStep(log, 'ringtone', () => setRingtone(device, options.ringtone));
    }

    await runStep(log, 'commit', () => commit(device));
  } finally {
    current.stop();
  }
}

/** Run one step, reporting running / done / error around it. */
async function runStep(log, id, work) {
  log(id, 'running');
  try {
    const detail = await work();
    log(id, 'done', detail);
  } catch (error) {
    log(id, 'error', error.message);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Reading the current state
// ---------------------------------------------------------------------------

/**
 * Subscribe to every event that carries current settings and keep the latest of
 * each. Returns the live snapshot plus a stop() that drops the subscriptions.
 */
function watchDevice(device) {
  const state = {
    config: {},
    moduleConfig: {},
    channels: new Map(),
    nodes: new Map(),
    myNodeInfo: null,
  };

  const unsubscribe = [
    // Config arrives one oneof variant at a time: device, lora, display, ...
    device.events.onConfigPacket.subscribe((config) => {
      if (config.payloadVariant?.case) {
        state.config[config.payloadVariant.case] = config.payloadVariant.value;
      }
    }),
    // Same shape for module config: cannedMessage, externalNotification, ...
    device.events.onModuleConfigPacket.subscribe((moduleConfig) => {
      if (moduleConfig.payloadVariant?.case) {
        state.moduleConfig[moduleConfig.payloadVariant.case] = moduleConfig.payloadVariant.value;
      }
    }),
    // One Channel message per slot, 0 to 7.
    device.events.onChannelPacket.subscribe((channel) => {
      state.channels.set(channel.index, channel);
    }),
    // Tells us our own node number, which identifies our NodeInfo below.
    device.events.onMyNodeInfo.subscribe((myNodeInfo) => {
      state.myNodeInfo = myNodeInfo;
    }),
    // NodeInfo for every known node, ours included, and ours carries the owner.
    device.events.onNodeInfoPacket.subscribe((nodeInfo) => {
      state.nodes.set(nodeInfo.num, nodeInfo);
    }),
  ];

  return {
    state,
    stop: () => unsubscribe.forEach((off) => off()),
  };
}

/**
 * Watch for the DeviceConfigured status, which the device reports once it has
 * finished replaying its settings. Never rejects, so the caller controls timing.
 */
function waitForConfigured(device) {
  let off = () => {};
  const promise = new Promise((resolve) => {
    off = device.events.onDeviceStatus.subscribe((status) => {
      if (status === Types.DeviceStatusEnum.DeviceConfigured) {
        resolve();
      }
    });
  });
  return { promise, cancel: () => off() };
}

/**
 * True if the promise resolves inside the window. False if the window wins or
 * the promise rejects, so a missing ack never becomes a thrown error here.
 */
function resolvesWithin(promise, ms) {
  let timer;
  return Promise.race([
    promise.then(() => true, () => false),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Keep a promise we deliberately do not await from surfacing as an unhandled
 * rejection later.
 */
function ignoreRejection(maybePromise) {
  if (maybePromise && typeof maybePromise.catch === 'function') {
    maybePromise.catch(() => {});
  }
  return maybePromise;
}

/** One line summary of what the node sent, for the step detail text. */
function describeSnapshot(state) {
  const sections = Object.keys(state.config).length + Object.keys(state.moduleConfig).length;
  return `${sections} sections, ${state.channels.size} channels`;
}

/**
 * Fetch a section the device sent, or fail loudly. Never guess: writing a
 * section we did not receive would wipe whatever the node had in it.
 */
function requireSection(state, group, name) {
  const section = state[group]?.[name];
  if (!section) {
    throw new Error(`The node did not send its ${name} settings, so they cannot be changed safely. Unplug, plug back in and try again.`);
  }
  return section;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateOptions(options) {
  if (options.region && !regionNames().includes(options.region)) {
    throw new Error(`Unknown region "${options.region}".`);
  }
  if (options.modemPreset && !modemPresetNames().includes(options.modemPreset)) {
    throw new Error(`Unknown modem preset "${options.modemPreset}".`);
  }
  if (options.shortName && byteLength(options.shortName) > SHORT_NAME_MAX) {
    throw new Error(`Short name must be ${SHORT_NAME_MAX} characters or fewer, got "${options.shortName}".`);
  }
  if (options.cannedMessages?.length) {
    const joined = joinCannedMessages(options.cannedMessages);
    const length = byteLength(joined);
    if (length > CANNED_MESSAGES_MAX) {
      throw new Error(`Preset messages are ${length} characters joined with "|", the firmware limit is ${CANNED_MESSAGES_MAX}. Remove ${length - CANNED_MESSAGES_MAX} characters.`);
    }
  }
  if (options.ringtone) {
    const length = byteLength(options.ringtone);
    if (length > RINGTONE_MAX) {
      throw new Error(`Ringtone is ${length} characters, the firmware limit is ${RINGTONE_MAX}. Remove ${length - RINGTONE_MAX} characters.`);
    }
  }
  if (options.channelUrl) {
    // Throws early with a clear message rather than mid-transaction.
    decodeChannelUrl(options.channelUrl);
  }
}

// ---------------------------------------------------------------------------
// Channel URL
// ---------------------------------------------------------------------------

/**
 * Decode a https://meshtastic.org/e/#<base64url> sharing link into a ChannelSet.
 * The fragment may carry a query suffix such as "?add=true", which is dropped.
 */
export function decodeChannelUrl(url) {
  const hash = String(url).split('#')[1];
  if (!hash) {
    throw new Error('Channel URL has no "#" part. Paste the whole https://meshtastic.org/e/#... link.');
  }
  const payload = hash.split('?')[0];
  // base64url uses - and _ instead of + and / and drops the = padding.
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  let bytes;
  try {
    bytes = decodeBase64(padded);
  } catch {
    throw new Error('Channel URL is not valid base64. Copy it again from the app.');
  }
  let channelSet;
  try {
    channelSet = fromBinary(Protobuf.AppOnly.ChannelSetSchema, bytes);
  } catch {
    throw new Error('Channel URL does not decode to a Meshtastic channel set.');
  }
  if (!channelSet.settings?.length) {
    throw new Error('Channel URL contains no channels.');
  }
  return channelSet;
}

/** base64 to bytes, in whichever runtime we happen to be. */
function decodeBase64(base64) {
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

// ---------------------------------------------------------------------------
// Individual writes, each one a complete section
// ---------------------------------------------------------------------------

/** Owner (long and short name). Starts from the node's own current User record. */
async function setOwner(device, options, state) {
  const myNum = state.myNodeInfo?.myNodeNum;
  const myNode = myNum === undefined ? undefined : state.nodes.get(myNum);
  // Keep id, hardware model, public key and role by starting from what we have.
  const owner = myNode?.user
    ? clone(Protobuf.Mesh.UserSchema, myNode.user)
    : create(Protobuf.Mesh.UserSchema);
  if (options.longName) {
    owner.longName = options.longName;
  }
  if (options.shortName) {
    owner.shortName = options.shortName;
  }
  await device.setOwner(owner);
  return `${owner.longName || '(unchanged)'} / ${owner.shortName || '(unchanged)'}`;
}

/**
 * LoRa section: current lora, then any non-default fields carried by the channel
 * URL, then the region and preset the user picked. Sent as one full section.
 */
async function setLora(device, options, state, channelSet) {
  const lora = clone(Protobuf.Config.Config_LoRaConfigSchema, requireSection(state, 'config', 'lora'));

  if (channelSet?.loraConfig) {
    // Protobuf scalars carry no presence, so a shared URL cannot tell us which
    // lora fields it meant to set. Copy only the ones that are not at their
    // default, which is what the phone and web clients effectively do.
    mergeTruthy(lora, channelSet.loraConfig, [
      'usePreset', 'modemPreset', 'bandwidth', 'spreadFactor', 'codingRate',
      'frequencyOffset', 'region', 'hopLimit', 'txEnabled', 'txPower',
      'channelNum', 'overrideDutyCycle', 'sx126xRxBoostedGain',
      'overrideFrequency', 'ignoreMqtt', 'configOkToMqtt',
    ]);
  }

  // An explicit pick in the form wins over whatever the URL carried.
  if (options.region) {
    lora.region = Protobuf.Config.Config_LoRaConfig_RegionCode[options.region];
  }
  if (options.modemPreset) {
    lora.modemPreset = Protobuf.Config.Config_LoRaConfig_ModemPreset[options.modemPreset];
    // A named preset only takes effect with use_preset on.
    lora.usePreset = true;
  }

  await device.setConfig(create(Protobuf.Config.ConfigSchema, {
    payloadVariant: { case: 'lora', value: lora },
  }));

  const region = Protobuf.Config.Config_LoRaConfig_RegionCode[lora.region];
  const preset = Protobuf.Config.Config_LoRaConfig_ModemPreset[lora.modemPreset];
  return `${region} / ${preset}`;
}

/** Copy the listed fields from source to target when they are not at default. */
function mergeTruthy(target, source, fields) {
  for (const field of fields) {
    const value = source[field];
    if (value !== undefined && value !== null && value !== 0 && value !== false && value !== '') {
      target[field] = value;
    }
  }
}

/**
 * Channels from the URL. A Channel is written whole by design, and the URL is
 * the authoritative definition of the channels it carries. Index 0 is the
 * primary, the rest are secondary.
 */
async function setChannels(device, channelSet) {
  let written = 0;
  for (let index = 0; index < channelSet.settings.length; index += 1) {
    const settings = channelSet.settings[index];
    const channel = create(Protobuf.Channel.ChannelSchema, {
      index,
      settings,
      role: index === 0
        ? Protobuf.Channel.Channel_Role.PRIMARY
        : Protobuf.Channel.Channel_Role.SECONDARY,
    });
    await device.setChannel(channel);
    written += 1;
  }
  return `${written} channel${written === 1 ? '' : 's'}`;
}

/** Device section: side button pin, buzzer pin, timezone. */
async function setDevice(device, options, state) {
  const deviceConfig = clone(Protobuf.Config.Config_DeviceConfigSchema, requireSection(state, 'config', 'device'));

  if (options.toggle?.enabled) {
    // The patched firmware maps the side button itself, so button_gpio stays 0.
    deviceConfig.buttonGpio = 0;
  }
  if (options.buzzer) {
    // Without buzzer_gpio the 2.7 sound path stays silent even with the
    // notification module fully configured.
    deviceConfig.buzzerGpio = options.buzzer.enabled ? options.buzzer.pin : 0;
  }
  if (options.tzdef) {
    deviceConfig.tzdef = options.tzdef;
  }

  await device.setConfig(create(Protobuf.Config.ConfigSchema, {
    payloadVariant: { case: 'device', value: deviceConfig },
  }));

  return `buzzer GPIO ${deviceConfig.buzzerGpio}, button GPIO ${deviceConfig.buttonGpio}`;
}

/** Canned message module section: the up/down/press input and the bell flag. */
async function setCannedModule(device, options, state) {
  const canned = clone(
    Protobuf.ModuleConfig.ModuleConfig_CannedMessageConfigSchema,
    requireSection(state, 'moduleConfig', 'cannedMessage'),
  );

  if (options.toggle) {
    if (options.toggle.enabled) {
      canned.enabled = true;
      canned.updown1Enabled = true;
      canned.inputbrokerPinA = options.toggle.pinUp;
      canned.inputbrokerPinB = options.toggle.pinDown;
      canned.inputbrokerPinPress = options.toggle.pinPress;
      // Accept input events from any source, so the up/down driver is not filtered out.
      canned.allowInputSource = '_any';
    } else {
      // Leave the module and its pins alone, just stop driving it from the toggle.
      canned.updown1Enabled = false;
    }
  }

  if (typeof options.sendBell === 'boolean') {
    canned.sendBell = options.sendBell;
  }

  await device.setModuleConfig(create(Protobuf.ModuleConfig.ModuleConfigSchema, {
    payloadVariant: { case: 'cannedMessage', value: canned },
  }));

  return canned.updown1Enabled
    ? `up ${canned.inputbrokerPinA}, down ${canned.inputbrokerPinB}, press ${canned.inputbrokerPinPress}`
    : 'toggle input off';
}

/** External notification section: the PWM buzzer and which events sound it. */
async function setExternalNotification(device, options, state) {
  const extNotif = clone(
    Protobuf.ModuleConfig.ModuleConfig_ExternalNotificationConfigSchema,
    requireSection(state, 'moduleConfig', 'externalNotification'),
  );

  if (options.buzzer.enabled) {
    extNotif.enabled = true;
    // PWM drives a passive piezo, which is what this build uses.
    extNotif.usePwm = true;
    extNotif.output = options.buzzer.pin;
    extNotif.outputBuzzer = options.buzzer.pin;
    extNotif.active = true;
    extNotif.alertMessage = true;
    extNotif.alertBell = true;
    extNotif.alertMessageBuzzer = true;
    extNotif.alertBellBuzzer = true;
  } else {
    extNotif.enabled = false;
  }

  await device.setModuleConfig(create(Protobuf.ModuleConfig.ModuleConfigSchema, {
    payloadVariant: { case: 'externalNotification', value: extNotif },
  }));

  return options.buzzer.enabled ? `GPIO ${options.buzzer.pin}, PWM` : 'buzzer off';
}

/** Preset messages, joined with "|" as the module expects. */
async function setMessages(device, options) {
  const joined = joinCannedMessages(options.cannedMessages);
  await device.setCannedMessages(create(Protobuf.CannedMessages.CannedMessageModuleConfigSchema, {
    messages: joined,
  }));
  return `${options.cannedMessages.length} messages, ${byteLength(joined)}/${CANNED_MESSAGES_MAX} characters`;
}

/**
 * Ringtone. @meshtastic/core 2.6.7 has no setRingtone helper, so send the
 * AdminMessage set_ringtone_message ourselves over the admin port.
 */
async function setRingtone(device, ringtone) {
  const message = create(Protobuf.Admin.AdminMessageSchema, {
    payloadVariant: { case: 'setRingtoneMessage', value: ringtone },
  });
  await device.sendPacket(
    toBinary(Protobuf.Admin.AdminMessageSchema, message),
    Protobuf.Portnums.PortNum.ADMIN_APP,
    'self',
  );
  return `${byteLength(ringtone)}/${RINGTONE_MAX} characters`;
}

/**
 * Commit the transaction. The node saves and reboots, so its ack for this
 * packet usually never arrives. Stop waiting and call it done.
 */
async function commit(device) {
  // Swallow the queue timeout that follows the reboot, so it never surfaces as
  // an unhandled rejection after we have already moved on.
  const pending = ignoreRejection(device.commitEditSettings());
  const acked = await resolvesWithin(pending, COMMIT_ACK_TIMEOUT_MS);
  return acked ? 'saved' : 'saved, node rebooting';
}
