// Browser entry point for the Configure section on index.html.
//
// Renders nothing of its own: it wires the form that is already in the page,
// remembers what was typed so the same settings can go to node after node, and
// drives applyConfig over Web Serial.

import { MeshDevice } from '@meshtastic/core';
import { TransportWebSerial } from '@meshtastic/transport-web-serial';

import {
  applyConfig,
  byteLength,
  CANNED_MESSAGES_MAX,
  joinCannedMessages,
  planSteps,
  RINGTONE_MAX,
} from './apply-config.js';
import { TUNES } from './tunes.js';
import { isPlaying, play as playRingtone, stop as stopRingtone } from './rtttl-player.js';

// Where the form model is kept between visits and between nodes.
const STORAGE_KEY = 'heltec-v3-updown-config';

const el = (id) => document.getElementById(id);

// Every control the section owns, looked up once.
const ui = {};

/** Grab the controls. Returns false when the section is not on the page. */
function collectUi() {
  const ids = {
    form: 'cfg-form',
    region: 'cfg-region',
    preset: 'cfg-preset',
    longName: 'cfg-long-name',
    shortName: 'cfg-short-name',
    channelKeep: 'cfg-channel-keep',
    channelUrlMode: 'cfg-channel-url-mode',
    channelUrl: 'cfg-channel-url',
    messages: 'cfg-messages',
    messagesCount: 'cfg-messages-count',
    tune: 'cfg-tune',
    ringtone: 'cfg-ringtone',
    ringtonePreview: 'cfg-ringtone-preview',
    ringtoneCount: 'cfg-ringtone-count',
    toggle: 'cfg-toggle',
    pinUp: 'cfg-pin-up',
    pinDown: 'cfg-pin-down',
    pinPress: 'cfg-pin-press',
    buzzer: 'cfg-buzzer',
    buzzerPin: 'cfg-buzzer-pin',
    sendBell: 'cfg-send-bell',
    tzdef: 'cfg-tzdef',
    apply: 'cfg-apply',
    status: 'cfg-status',
    result: 'cfg-result',
  };
  for (const [key, id] of Object.entries(ids)) {
    ui[key] = el(id);
    if (!ui[key]) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Form model
// ---------------------------------------------------------------------------

/** Read the whole form into one plain object. */
function readForm() {
  return {
    region: ui.region.value,
    modemPreset: ui.preset.value,
    longName: ui.longName.value.trim(),
    shortName: ui.shortName.value.trim(),
    channelMode: ui.channelUrlMode.checked ? 'url' : 'keep',
    channelUrl: ui.channelUrl.value.trim(),
    messagesText: ui.messages.value,
    ringtone: ui.ringtone.value.trim(),
    tune: ui.tune.value,
    toggleEnabled: ui.toggle.checked,
    pinUp: Number(ui.pinUp.value),
    pinDown: Number(ui.pinDown.value),
    pinPress: Number(ui.pinPress.value),
    buzzerEnabled: ui.buzzer.checked,
    buzzerPin: Number(ui.buzzerPin.value),
    sendBell: ui.sendBell.checked,
    tzdef: ui.tzdef.value.trim(),
  };
}

/** Put a saved model back into the form, ignoring anything unrecognised. */
function writeForm(model) {
  if (!model || typeof model !== 'object') {
    return;
  }
  const setValue = (node, value) => {
    if (typeof value === 'string' || typeof value === 'number') {
      node.value = String(value);
    }
  };
  const setChecked = (node, value) => {
    if (typeof value === 'boolean') {
      node.checked = value;
    }
  };

  // Only accept a select value the select actually offers.
  if (model.region && [...ui.region.options].some((o) => o.value === model.region)) {
    ui.region.value = model.region;
  }
  if (model.modemPreset && [...ui.preset.options].some((o) => o.value === model.modemPreset)) {
    ui.preset.value = model.modemPreset;
  }
  setValue(ui.longName, model.longName);
  setValue(ui.shortName, model.shortName);
  if (model.channelMode === 'url') {
    ui.channelUrlMode.checked = true;
  } else if (model.channelMode === 'keep') {
    ui.channelKeep.checked = true;
  }
  setValue(ui.channelUrl, model.channelUrl);
  if (typeof model.messagesText === 'string') {
    ui.messages.value = model.messagesText;
  }
  setValue(ui.ringtone, model.ringtone);
  if (model.tune && [...ui.tune.options].some((o) => o.value === model.tune)) {
    ui.tune.value = model.tune;
  }
  setChecked(ui.toggle, model.toggleEnabled);
  setValue(ui.pinUp, model.pinUp);
  setValue(ui.pinDown, model.pinDown);
  setValue(ui.pinPress, model.pinPress);
  setChecked(ui.buzzer, model.buzzerEnabled);
  setValue(ui.buzzerPin, model.buzzerPin);
  setChecked(ui.sendBell, model.sendBell);
  setValue(ui.tzdef, model.tzdef);
}

/** Turn the form model into the options object applyConfig expects. */
function toOptions(model) {
  const options = {
    region: model.region || undefined,
    modemPreset: model.modemPreset || undefined,
    longName: model.longName || undefined,
    shortName: model.shortName || undefined,
    sendBell: model.sendBell,
    tzdef: model.tzdef || undefined,
    toggle: {
      enabled: model.toggleEnabled,
      pinUp: model.pinUp,
      pinDown: model.pinDown,
      pinPress: model.pinPress,
    },
    buzzer: {
      enabled: model.buzzerEnabled,
      pin: model.buzzerPin,
    },
  };

  // Unset means leave the node alone, so an empty channel choice sends nothing.
  if (model.channelMode === 'url' && model.channelUrl) {
    options.channelUrl = model.channelUrl;
  }

  const messages = model.messagesText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (messages.length > 0) {
    options.cannedMessages = messages;
  }

  if (model.ringtone) {
    options.ringtone = model.ringtone;
  }

  return options;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(readForm()));
  } catch {
    // Private windows and blocked storage are fine, the form still works.
  }
}

function restore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      writeForm(JSON.parse(raw));
    }
  } catch {
    // Corrupt or unreadable, keep the markup defaults.
  }
}

// ---------------------------------------------------------------------------
// Live counters and small niceties
// ---------------------------------------------------------------------------

/** Show the joined length of the preset messages against the firmware limit. */
function updateMessagesCount() {
  const lines = ui.messages.value.split('\n');
  const joined = joinCannedMessages(lines);
  const length = byteLength(joined);
  const count = joined ? joined.split('|').length : 0;
  ui.messagesCount.textContent = `${length} / ${CANNED_MESSAGES_MAX} characters, ${count} message${count === 1 ? '' : 's'}`;
  ui.messagesCount.classList.toggle('over', length > CANNED_MESSAGES_MAX);
}

/** Show the ringtone length against the firmware limit. */
function updateRingtoneCount() {
  const length = byteLength(ui.ringtone.value.trim());
  ui.ringtoneCount.textContent = `${length} / ${RINGTONE_MAX} characters`;
  ui.ringtoneCount.classList.toggle('over', length > RINGTONE_MAX);
}

/** Grey out the channel URL input unless that radio is picked. */
function updateChannelMode() {
  ui.channelUrl.disabled = !ui.channelUrlMode.checked;
}

/** Grey out the pin inputs when their feature is off. */
function updateEnabledState() {
  for (const node of [ui.pinUp, ui.pinDown, ui.pinPress]) {
    node.disabled = !ui.toggle.checked;
  }
  ui.buzzerPin.disabled = !ui.buzzer.checked;
}

/** Fill the tune select from the shipped list. */
function fillTunes() {
  for (const tune of TUNES) {
    const option = document.createElement('option');
    option.value = tune.name;
    option.textContent = tune.name;
    ui.tune.append(option);
  }
}

/** Picking a tune fills the text input, which stays editable afterwards. */
function onTuneChange() {
  const picked = TUNES.find((tune) => tune.name === ui.tune.value);
  if (picked) {
    ui.ringtone.value = picked.rtttl;
    updateRingtoneCount();
    save();
  }
}

/** Play or stop whatever is currently in the ringtone input. */
function onPreview() {
  if (isPlaying()) {
    stopRingtone();
    ui.ringtonePreview.textContent = 'Preview';
    return;
  }
  const rtttl = ui.ringtone.value.trim();
  if (!rtttl) {
    setResult('Nothing to preview, pick a tune or paste an RTTTL string.', true);
    return;
  }
  try {
    // Called straight from the click, which is what lets the audio start.
    playRingtone(rtttl, () => {
      ui.ringtonePreview.textContent = 'Preview';
    });
    ui.ringtonePreview.textContent = 'Stop';
    setResult('');
  } catch (error) {
    setResult(error.message, true);
  }
}

// ---------------------------------------------------------------------------
// Status list
// ---------------------------------------------------------------------------

const STATUS_MARK = {
  pending: '·',
  running: '…',
  done: '✓',
  error: '✗',
};

/** Draw the whole step list as pending. */
function renderSteps(steps) {
  ui.status.replaceChildren();
  for (const step of steps) {
    const item = document.createElement('li');
    item.dataset.step = step.id;
    item.className = 'step pending';

    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.textContent = STATUS_MARK.pending;
    mark.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = step.label;

    const detail = document.createElement('span');
    detail.className = 'detail';

    item.append(mark, label, detail);
    ui.status.append(item);
  }
}

/** Move one step to a new status. */
function markStep(id, status, detail) {
  const item = ui.status.querySelector(`[data-step="${id}"]`);
  if (!item) {
    return;
  }
  item.className = `step ${status}`;
  item.querySelector('.mark').textContent = STATUS_MARK[status] ?? STATUS_MARK.pending;
  item.querySelector('.detail').textContent = detail ? ` ${detail}` : '';
}

function setResult(text, isError = false) {
  ui.result.textContent = text;
  ui.result.classList.toggle('warn', Boolean(text) && isError);
  ui.result.classList.toggle('ok', Boolean(text) && !isError);
}

// ---------------------------------------------------------------------------
// Connect and apply
// ---------------------------------------------------------------------------

async function onApply() {
  const options = toOptions(readForm());

  renderSteps(planSteps(options));
  setResult('');

  if (!('serial' in navigator)) {
    setResult('This browser has no Web Serial. Use Chrome or Edge on desktop.', true);
    return;
  }

  ui.apply.disabled = true;
  const originalLabel = ui.apply.textContent;
  ui.apply.textContent = 'Working...';

  let device;
  let transport;
  try {
    // Opens the browser port picker, then the port at 115200.
    transport = await TransportWebSerial.create();
    device = new MeshDevice(transport);

    // configure() asks the node for its whole settings set. It only settles
    // once the radio acks, and a wantConfigId is never acked, so it is fired
    // and not awaited. applyConfig waits for the settings that come back.
    device.configure().catch(() => {});

    await applyConfig(device, options, markStep);
    setResult('Rebooting, unplug and plug the next node.');
  } catch (error) {
    // A cancelled port picker is a choice, not a failure.
    const message = error?.name === 'NotFoundError'
      ? 'No port picked.'
      : error?.message || String(error);
    setResult(message, true);
  } finally {
    try {
      if (device) {
        await device.disconnect();
      } else if (transport) {
        await transport.disconnect();
      }
    } catch {
      // The node is rebooting, a failed close here does not matter.
    }
    ui.apply.disabled = false;
    ui.apply.textContent = originalLabel;
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function init() {
  if (!collectUi()) {
    return;
  }

  fillTunes();
  restore();
  updateChannelMode();
  updateEnabledState();
  updateMessagesCount();
  updateRingtoneCount();

  // The form never submits, it only feeds the apply button.
  ui.form.addEventListener('submit', (event) => event.preventDefault());

  // One handler keeps the saved model in step with every edit.
  ui.form.addEventListener('input', () => {
    updateChannelMode();
    updateEnabledState();
    updateMessagesCount();
    updateRingtoneCount();
    save();
  });
  ui.form.addEventListener('change', () => {
    updateChannelMode();
    updateEnabledState();
    save();
  });

  ui.tune.addEventListener('change', onTuneChange);
  ui.ringtonePreview.addEventListener('click', onPreview);
  ui.apply.addEventListener('click', onApply);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
