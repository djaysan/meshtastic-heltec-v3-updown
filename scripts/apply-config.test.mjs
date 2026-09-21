// Tests for the parts that can be checked without hardware: that every write
// carries a complete section with the node's untouched fields still in it, that
// the canned message limit is enforced before anything is sent, and that the
// RTTTL parser reads durations and rests correctly.
//
// Run with: npm test   (node --test 'scripts/*.test.mjs')

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { create, toBinary } from '@bufbuild/protobuf';
import * as Protobuf from '@meshtastic/protobufs';

import { applyConfig, CANNED_MESSAGES_MAX, decodeChannelUrl } from '../src/apply-config.js';
import { parseRtttl } from '../src/rtttl-player.js';
import { DEFAULT_RINGTONE, TUNES } from '../src/tunes.js';

// ---------------------------------------------------------------------------
// Fake device
// ---------------------------------------------------------------------------

/** The smallest thing that behaves like one of the MeshDevice event emitters. */
function makeDispatcher() {
  const handlers = new Set();
  return {
    subscribe(fn) {
      handlers.add(fn);
      return () => handlers.delete(fn);
    },
    dispatch(value) {
      for (const fn of [...handlers]) {
        fn(value);
      }
    },
  };
}

// Settings the fake node claims to have. Every field here that the options do
// not mention must still be present in whatever gets written back.
const CURRENT = {
  device: {
    role: Protobuf.Config.Config_DeviceConfig_Role.CLIENT,
    buttonGpio: 9,
    buzzerGpio: 0,
    nodeInfoBroadcastSecs: 900,
    disableTripleClick: true,
    ledHeartbeatDisabled: true,
    tzdef: 'UTC0',
  },
  lora: {
    usePreset: true,
    modemPreset: Protobuf.Config.Config_LoRaConfig_ModemPreset.SHORT_FAST,
    region: Protobuf.Config.Config_LoRaConfig_RegionCode.US,
    hopLimit: 7,
    txEnabled: true,
    txPower: 22,
    channelNum: 20,
    sx126xRxBoostedGain: true,
  },
  cannedMessage: {
    rotary1Enabled: true,
    inputbrokerPinA: 1,
    inputbrokerPinB: 2,
    inputbrokerPinPress: 3,
    inputbrokerEventPress: Protobuf.ModuleConfig.ModuleConfig_CannedMessageConfig_InputEventChar.SELECT,
    updown1Enabled: false,
    enabled: false,
    sendBell: false,
  },
  externalNotification: {
    enabled: false,
    outputMs: 1000,
    nagTimeout: 5,
    useI2sAsBuzzer: true,
  },
};

/**
 * A stand-in for a connected MeshDevice that records what was written and
 * replays CURRENT when configure() is called.
 */
function makeFakeDevice() {
  const events = {
    onConfigPacket: makeDispatcher(),
    onModuleConfigPacket: makeDispatcher(),
    onChannelPacket: makeDispatcher(),
    onMyNodeInfo: makeDispatcher(),
    onNodeInfoPacket: makeDispatcher(),
    onDeviceStatus: makeDispatcher(),
  };

  // Ordered record of every call, so ordering can be asserted as well.
  const order = [];
  const calls = {
    order,
    setConfig: [],
    setModuleConfig: [],
    setCannedMessages: [],
    setOwner: [],
    setChannel: [],
    sendPacket: [],
    beginEditSettings: 0,
    commitEditSettings: 0,
  };

  const device = {
    events,
    calls,
    configure() {
      // Async on purpose: the caller fires configure() and then hands the
      // device to applyConfig, which must be subscribed before anything lands.
      setTimeout(() => {
        for (const [section, value] of Object.entries({ device: CURRENT.device, lora: CURRENT.lora })) {
          events.onConfigPacket.dispatch(create(Protobuf.Config.ConfigSchema, {
            payloadVariant: {
              case: section,
              value: create(
                section === 'device'
                  ? Protobuf.Config.Config_DeviceConfigSchema
                  : Protobuf.Config.Config_LoRaConfigSchema,
                value,
              ),
            },
          }));
        }
        events.onModuleConfigPacket.dispatch(create(Protobuf.ModuleConfig.ModuleConfigSchema, {
          payloadVariant: {
            case: 'cannedMessage',
            value: create(Protobuf.ModuleConfig.ModuleConfig_CannedMessageConfigSchema, CURRENT.cannedMessage),
          },
        }));
        events.onModuleConfigPacket.dispatch(create(Protobuf.ModuleConfig.ModuleConfigSchema, {
          payloadVariant: {
            case: 'externalNotification',
            value: create(
              Protobuf.ModuleConfig.ModuleConfig_ExternalNotificationConfigSchema,
              CURRENT.externalNotification,
            ),
          },
        }));
        events.onChannelPacket.dispatch(create(Protobuf.Channel.ChannelSchema, {
          index: 0,
          role: Protobuf.Channel.Channel_Role.PRIMARY,
          settings: create(Protobuf.Channel.ChannelSettingsSchema, { name: '' }),
        }));
        events.onMyNodeInfo.dispatch(create(Protobuf.Mesh.MyNodeInfoSchema, { myNodeNum: 111 }));
        events.onNodeInfoPacket.dispatch(create(Protobuf.Mesh.NodeInfoSchema, {
          num: 111,
          user: create(Protobuf.Mesh.UserSchema, {
            id: '!0000006f',
            longName: 'Old name',
            shortName: 'OLD',
            hwModel: Protobuf.Mesh.HardwareModel.HELTEC_V3,
          }),
        }));
        events.onDeviceStatus.dispatch(7); // DeviceConfigured
      }, 0);
      return Promise.resolve(1);
    },
    beginEditSettings() {
      calls.beginEditSettings += 1;
      order.push('begin');
      return Promise.resolve(1);
    },
    commitEditSettings() {
      calls.commitEditSettings += 1;
      order.push('commit');
      return Promise.resolve(1);
    },
    setConfig(config) {
      calls.setConfig.push(config);
      order.push(`setConfig:${config.payloadVariant.case}`);
      return Promise.resolve(1);
    },
    setModuleConfig(moduleConfig) {
      calls.setModuleConfig.push(moduleConfig);
      order.push(`setModuleConfig:${moduleConfig.payloadVariant.case}`);
      return Promise.resolve(1);
    },
    setCannedMessages(cannedMessages) {
      calls.setCannedMessages.push(cannedMessages);
      order.push('setCannedMessages');
      return Promise.resolve(1);
    },
    setOwner(owner) {
      calls.setOwner.push(owner);
      order.push('setOwner');
      return Promise.resolve(1);
    },
    setChannel(channel) {
      calls.setChannel.push(channel);
      order.push(`setChannel:${channel.index}`);
      return Promise.resolve(1);
    },
    sendPacket(bytes, portNum, destination) {
      calls.sendPacket.push({ bytes, portNum, destination });
      order.push(`sendPacket:${portNum}`);
      return Promise.resolve(1);
    },
  };

  return device;
}

/** The options the example file ships with, which is what the form defaults to. */
const EXAMPLE_OPTIONS = {
  region: 'EU_868',
  modemPreset: 'LONG_FAST',
  toggle: { enabled: true, pinUp: 26, pinDown: 19, pinPress: 20 },
  buzzer: { enabled: true, pin: 47 },
  sendBell: true,
  tzdef: 'CET-1CEST,M3.5.0/2:00:00,M10.4.0/3:00:00',
  cannedMessages: ['Roger', 'Yes', 'No', 'Test', "I'm OK", 'Need help'],
};

/** Run applyConfig against a fresh fake device, the way the page does. */
async function run(options) {
  const device = makeFakeDevice();
  const steps = [];
  device.configure();
  await applyConfig(device, options, (step, status, detail) => steps.push({ step, status, detail }));
  return { device, steps };
}

/** Pull the section out of the recorded set_config / set_module_config call. */
function section(calls, name) {
  const match = calls.find((call) => call.payloadVariant.case === name);
  assert.ok(match, `no write recorded for the ${name} section`);
  return match.payloadVariant.value;
}

// ---------------------------------------------------------------------------
// Whole sections, not partial ones
// ---------------------------------------------------------------------------

test('device section keeps the fields the options never mention', async () => {
  const { device } = await run(EXAMPLE_OPTIONS);
  const written = section(device.calls.setConfig, 'device');

  // Untouched fields the node had must still be there.
  assert.equal(written.nodeInfoBroadcastSecs, 900, 'node info interval was wiped');
  assert.equal(written.disableTripleClick, true, 'triple click setting was wiped');
  assert.equal(written.ledHeartbeatDisabled, true, 'led heartbeat setting was wiped');
  assert.equal(written.role, Protobuf.Config.Config_DeviceConfig_Role.CLIENT, 'role was wiped');

  // And the chosen fields changed.
  assert.equal(written.tzdef, EXAMPLE_OPTIONS.tzdef);
  assert.equal(written.buzzerGpio, 47);
  assert.equal(written.buttonGpio, 0, 'the patched firmware needs button_gpio at 0');
});

test('lora section keeps the fields the options never mention', async () => {
  const { device } = await run(EXAMPLE_OPTIONS);
  const written = section(device.calls.setConfig, 'lora');

  assert.equal(written.hopLimit, 7, 'hop limit was wiped');
  assert.equal(written.txPower, 22, 'tx power was wiped');
  assert.equal(written.channelNum, 20, 'channel number was wiped');
  assert.equal(written.sx126xRxBoostedGain, true, 'boosted gain was wiped');
  assert.equal(written.txEnabled, true, 'tx enabled was wiped');

  assert.equal(written.region, Protobuf.Config.Config_LoRaConfig_RegionCode.EU_868);
  assert.equal(written.modemPreset, Protobuf.Config.Config_LoRaConfig_ModemPreset.LONG_FAST);
  assert.equal(written.usePreset, true, 'a named preset needs use_preset on');
});

test('canned message module section keeps its other fields', async () => {
  const { device } = await run(EXAMPLE_OPTIONS);
  const written = section(device.calls.setModuleConfig, 'cannedMessage');

  assert.equal(written.rotary1Enabled, true, 'rotary flag was wiped');
  assert.equal(
    written.inputbrokerEventPress,
    Protobuf.ModuleConfig.ModuleConfig_CannedMessageConfig_InputEventChar.SELECT,
    'press event was wiped',
  );

  assert.equal(written.updown1Enabled, true);
  assert.equal(written.enabled, true);
  assert.equal(written.inputbrokerPinA, 26);
  assert.equal(written.inputbrokerPinB, 19);
  assert.equal(written.inputbrokerPinPress, 20);
  assert.equal(written.allowInputSource, '_any');
  assert.equal(written.sendBell, true);
});

test('external notification section keeps its other fields', async () => {
  const { device } = await run(EXAMPLE_OPTIONS);
  const written = section(device.calls.setModuleConfig, 'externalNotification');

  assert.equal(written.outputMs, 1000, 'output duration was wiped');
  assert.equal(written.nagTimeout, 5, 'nag timeout was wiped');
  assert.equal(written.useI2sAsBuzzer, true, 'i2s flag was wiped');

  assert.equal(written.enabled, true);
  assert.equal(written.usePwm, true);
  assert.equal(written.output, 47);
  assert.equal(written.outputBuzzer, 47);
  assert.equal(written.active, true);
  assert.equal(written.alertMessage, true);
  assert.equal(written.alertBell, true);
  assert.equal(written.alertMessageBuzzer, true);
  assert.equal(written.alertBellBuzzer, true);
});

test('every write sits between beginEditSettings and commitEditSettings', async () => {
  const { device } = await run(EXAMPLE_OPTIONS);
  const order = device.calls.order;

  assert.equal(device.calls.beginEditSettings, 1);
  assert.equal(device.calls.commitEditSettings, 1);
  assert.equal(order[0], 'begin', 'the transaction must open first');
  assert.equal(order.at(-1), 'commit', 'the transaction must close last');
});

test('preset messages are joined with a pipe', async () => {
  const { device } = await run(EXAMPLE_OPTIONS);
  assert.equal(device.calls.setCannedMessages.length, 1);
  assert.equal(device.calls.setCannedMessages[0].messages, "Roger|Yes|No|Test|I'm OK|Need help");
});

test('a ringtone goes out as an admin message on the admin port', async () => {
  const { device } = await run({ ...EXAMPLE_OPTIONS, ringtone: DEFAULT_RINGTONE });
  assert.equal(device.calls.sendPacket.length, 1);
  const [sent] = device.calls.sendPacket;
  assert.equal(sent.portNum, Protobuf.Portnums.PortNum.ADMIN_APP);
  assert.equal(sent.destination, 'self');
  // Decode it back to prove the right field carried the right string.
  const decoded = Protobuf.Admin.AdminMessageSchema;
  const admin = (await import('@bufbuild/protobuf')).fromBinary(decoded, sent.bytes);
  assert.equal(admin.payloadVariant.case, 'setRingtoneMessage');
  assert.equal(admin.payloadVariant.value, DEFAULT_RINGTONE);
});

test('owner starts from the name the node already had', async () => {
  const { device } = await run({ ...EXAMPLE_OPTIONS, shortName: 'NEW' });
  assert.equal(device.calls.setOwner.length, 1);
  const owner = device.calls.setOwner[0];
  assert.equal(owner.shortName, 'NEW');
  assert.equal(owner.longName, 'Old name', 'the long name should be left alone');
  assert.equal(owner.id, '!0000006f', 'the node id must survive');
  assert.equal(owner.hwModel, Protobuf.Mesh.HardwareModel.HELTEC_V3, 'the hardware model must survive');
});

test('leaving everything unset writes nothing but the transaction', async () => {
  const { device } = await run({});
  assert.deepEqual(device.calls.order, ['begin', 'commit']);
  assert.equal(device.calls.setConfig.length, 0);
  assert.equal(device.calls.setModuleConfig.length, 0);
});

test('toggle off only clears updown1Enabled', async () => {
  const { device } = await run({ toggle: { enabled: false, pinUp: 26, pinDown: 19, pinPress: 20 } });
  const written = section(device.calls.setModuleConfig, 'cannedMessage');
  assert.equal(written.updown1Enabled, false);
  assert.equal(written.inputbrokerPinA, 1, 'the pins the node had must be left alone');
  assert.equal(written.rotary1Enabled, true);
  assert.equal(device.calls.setConfig.length, 0, 'nothing in the device section needed changing');
});

// ---------------------------------------------------------------------------
// Channel URL
// ---------------------------------------------------------------------------

/** Build a sharing link the way the phone app does, so the decoder is tested. */
function makeChannelUrl(channelNames, loraOverrides = {}) {
  const channelSet = create(Protobuf.AppOnly.ChannelSetSchema, {
    settings: channelNames.map((name) => create(Protobuf.Channel.ChannelSettingsSchema, {
      name,
      psk: new Uint8Array([1, 2, 3, 4]),
    })),
    loraConfig: create(Protobuf.Config.Config_LoRaConfigSchema, loraOverrides),
  });
  const bytes = toBinary(Protobuf.AppOnly.ChannelSetSchema, channelSet);
  return `https://meshtastic.org/e/#${Buffer.from(bytes).toString('base64url')}`;
}

test('a channel URL writes a primary and secondary channel', async () => {
  const url = makeChannelUrl(['Main', 'Spare']);
  const { device } = await run({ channelUrl: url });

  assert.equal(device.calls.setChannel.length, 2);
  assert.equal(device.calls.setChannel[0].index, 0);
  assert.equal(device.calls.setChannel[0].role, Protobuf.Channel.Channel_Role.PRIMARY);
  assert.equal(device.calls.setChannel[0].settings.name, 'Main');
  assert.equal(device.calls.setChannel[1].index, 1);
  assert.equal(device.calls.setChannel[1].role, Protobuf.Channel.Channel_Role.SECONDARY);
  assert.equal(device.calls.setChannel[1].settings.name, 'Spare');
});

test('lora fields in a channel URL merge into the current section', async () => {
  const url = makeChannelUrl(['Main'], { hopLimit: 4, region: Protobuf.Config.Config_LoRaConfig_RegionCode.EU_433 });
  const { device } = await run({ channelUrl: url });
  const written = section(device.calls.setConfig, 'lora');

  assert.equal(written.hopLimit, 4, 'the URL hop limit should win');
  assert.equal(written.region, Protobuf.Config.Config_LoRaConfig_RegionCode.EU_433, 'the URL region should win');
  assert.equal(written.txPower, 22, 'tx power the URL said nothing about must survive');
  assert.equal(written.channelNum, 20, 'channel number the URL said nothing about must survive');
});

test('a region picked in the form beats the one in the channel URL', async () => {
  const url = makeChannelUrl(['Main'], { region: Protobuf.Config.Config_LoRaConfig_RegionCode.US });
  const { device } = await run({ channelUrl: url, region: 'EU_868' });
  const written = section(device.calls.setConfig, 'lora');
  assert.equal(written.region, Protobuf.Config.Config_LoRaConfig_RegionCode.EU_868);
});

test('a broken channel URL is rejected before anything is sent', async () => {
  await assert.rejects(() => run({ channelUrl: 'https://meshtastic.org/e/' }), /no "#" part/);
  await assert.rejects(() => run({ channelUrl: 'https://meshtastic.org/e/#not-a-channel-set!!' }), /Channel URL/);
});

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

test('an over-long preset message list is refused before anything is sent', async () => {
  // 21 messages of 10 characters plus separators is comfortably over the limit.
  const tooMany = Array.from({ length: 21 }, (_, i) => `Message ${String(i).padStart(2, '0')}`);
  const device = makeFakeDevice();
  device.configure();

  await assert.rejects(
    () => applyConfig(device, { ...EXAMPLE_OPTIONS, cannedMessages: tooMany }, () => {}),
    (error) => {
      assert.match(error.message, /Preset messages are \d+ characters/);
      assert.match(error.message, new RegExp(`limit is ${CANNED_MESSAGES_MAX}`));
      return true;
    },
  );

  // Validation runs first, so the transaction never opened.
  assert.equal(device.calls.beginEditSettings, 0);
  assert.equal(device.calls.setConfig.length, 0);
  assert.equal(device.calls.setCannedMessages.length, 0);
});

test('a list that just fits is accepted', async () => {
  // Exactly at the limit: 20 blocks of 9 characters plus 19 separators is 199.
  const justFits = Array.from({ length: 20 }, (_, i) => `Msg-${String(i).padStart(4, '0')}`);
  const { device } = await run({ cannedMessages: justFits });
  assert.equal(device.calls.setCannedMessages.length, 1);
  assert.ok(device.calls.setCannedMessages[0].messages.length <= CANNED_MESSAGES_MAX);
});

test('an over-long ringtone and a too-long short name are refused', async () => {
  await assert.rejects(() => run({ ringtone: `x:d=4,o=5,b=100:${'c,'.repeat(200)}c` }), /limit is 230/);
  await assert.rejects(() => run({ shortName: 'TOOLONG' }), /4 characters or fewer/);
});

test('an unknown region or preset name is refused', async () => {
  await assert.rejects(() => run({ region: 'EU_869' }), /Unknown region/);
  await assert.rejects(() => run({ modemPreset: 'VERY_FAST' }), /Unknown modem preset/);
});

// ---------------------------------------------------------------------------
// RTTTL parser
// ---------------------------------------------------------------------------

test('the parser reads every note in a tune', () => {
  const { name, notes } = parseRtttl('Test:d=4,o=5,b=60:c,d,e,f');
  assert.equal(name, 'Test');
  assert.equal(notes.length, 4);
  // At 60 bpm a quarter note is exactly one second.
  assert.equal(notes[0].durationMs, 1000);
  // RTTTL octave 5 is the middle octave: a5 is the 440 Hz reference, so c5 is
  // middle C at 262 Hz, nine semitones below it.
  assert.equal(Math.round(notes[0].frequency), 262);
});

test('a dot makes a note half again as long', () => {
  const { notes } = parseRtttl('Dots:d=4,o=5,b=60:c,c.,8c,8c.');
  assert.equal(notes[0].durationMs, 1000);
  assert.equal(notes[1].durationMs, 1500, 'a dotted quarter is 1.5 quarters');
  assert.equal(notes[2].durationMs, 500);
  assert.equal(notes[3].durationMs, 750, 'a dotted eighth is 1.5 eighths');
});

test('a pause has no frequency but still takes time', () => {
  const { notes } = parseRtttl('Rest:d=8,o=6,b=120:c,p,4p,c');
  assert.equal(notes[1].frequency, 0, 'p must not sound');
  assert.equal(notes[1].durationMs, 250, 'an eighth at 120 bpm is 250ms');
  assert.equal(notes[2].durationMs, 500, 'an explicit quarter rest is 500ms');
  assert.ok(notes[3].frequency > 0);
});

test('sharps, octaves and a dot after the octave all parse', () => {
  const { notes } = parseRtttl('Mixed:d=16,o=5,b=120:a,a#,a4,a7,8a6.');
  assert.equal(Math.round(notes[0].frequency), 440, 'a5 is the 440 Hz reference');
  assert.equal(Math.round(notes[1].frequency), 466, 'a#5 is one semitone up');
  assert.equal(Math.round(notes[2].frequency), 220, 'a4 is an octave down');
  assert.equal(Math.round(notes[3].frequency), 1760, 'a7 is two octaves up');
  assert.equal(notes[4].durationMs, 375, 'a dotted eighth at 120 bpm is 375ms');
});

test('a malformed ringtone is rejected with a readable message', () => {
  assert.throws(() => parseRtttl('no colons here'), /name:d=4,o=5,b=100:notes/);
  assert.throws(() => parseRtttl('Bad:d=4,o=5,b=100:c,zz,e'), /Cannot read the note "zz"/);
  assert.throws(() => parseRtttl(''), /empty/);
});

test('every shipped tune parses and fits the firmware limit', () => {
  assert.ok(TUNES.length >= 12, 'the picker should offer a dozen or more tunes');
  for (const tune of TUNES) {
    assert.ok(tune.rtttl.length <= 230, `${tune.name} is ${tune.rtttl.length} characters, over the limit`);
    const parsed = parseRtttl(tune.rtttl);
    assert.ok(parsed.notes.length > 0, `${tune.name} parsed to no notes`);
  }
});

// ---------------------------------------------------------------------------
// Progress reporting
// ---------------------------------------------------------------------------

test('every step reports running then done', async () => {
  const { steps } = await run(EXAMPLE_OPTIONS);
  const ids = [...new Set(steps.map((entry) => entry.step))];
  for (const id of ids) {
    const forStep = steps.filter((entry) => entry.step === id).map((entry) => entry.status);
    assert.deepEqual(forStep, ['running', 'done'], `${id} did not report running then done`);
  }
  assert.ok(ids.includes('read'));
  assert.ok(ids.includes('commit'));
});

test('a failing write reports an error against its own step', async () => {
  const device = makeFakeDevice();
  device.setModuleConfig = () => Promise.reject(new Error('radio said no'));
  device.configure();

  const steps = [];
  await assert.rejects(
    () => applyConfig(device, EXAMPLE_OPTIONS, (step, status, detail) => steps.push({ step, status, detail })),
    /radio said no/,
  );
  const failed = steps.find((entry) => entry.status === 'error');
  assert.equal(failed.step, 'canned-module');
  assert.equal(failed.detail, 'radio said no');
});

// ---------------------------------------------------------------------------
// Channel URL decoding on its own
// ---------------------------------------------------------------------------

test('decodeChannelUrl reads a link with a query suffix', () => {
  const url = `${makeChannelUrl(['Main'])}?add=true`;
  const channelSet = decodeChannelUrl(url);
  assert.equal(channelSet.settings.length, 1);
  assert.equal(channelSet.settings[0].name, 'Main');
});
