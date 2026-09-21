// RTTTL parser plus a Web Audio preview that sounds roughly like the piezo on
// the node: a square wave at low gain, one note at a time.
//
// The parser is pure and runs in Node too, so the test file can exercise it.
// Nothing touches AudioContext until play() is called, because the constructor
// does not exist outside a browser.

// Semitone offset of each note letter inside an octave.
const SEMITONES = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/**
 * Parse an RTTTL string into a flat list of notes.
 *
 * @param {string} rtttl "name:d=4,o=5,b=63:8c,16d#,p,2a.6"
 * @returns {{ name: string, notes: { frequency: number, durationMs: number }[] }}
 *          frequency 0 means a rest. durationMs already accounts for dots.
 */
export function parseRtttl(rtttl) {
  const text = String(rtttl ?? '').trim();
  if (!text) {
    throw new Error('Ringtone is empty.');
  }

  // RTTTL is three colon-separated parts: name, defaults, notes. The notes
  // section itself contains no colons, so split on the first two only.
  const firstColon = text.indexOf(':');
  const secondColon = text.indexOf(':', firstColon + 1);
  if (firstColon === -1 || secondColon === -1) {
    throw new Error('Ringtone must look like name:d=4,o=5,b=100:notes');
  }

  const name = text.slice(0, firstColon).trim();
  const defaultsPart = text.slice(firstColon + 1, secondColon);
  const notesPart = text.slice(secondColon + 1);

  // Defaults: d = duration, o = octave, b = beats per minute. RTTTL spec values.
  let defaultDuration = 4;
  let defaultOctave = 6;
  let bpm = 63;
  for (const pair of defaultsPart.split(',')) {
    const [key, rawValue] = pair.split('=').map((part) => part.trim().toLowerCase());
    const value = Number.parseInt(rawValue, 10);
    if (Number.isNaN(value)) {
      continue;
    }
    if (key === 'd') {
      defaultDuration = value;
    } else if (key === 'o') {
      defaultOctave = value;
    } else if (key === 'b') {
      bpm = value;
    }
  }
  if (!bpm) {
    throw new Error('Ringtone has a zero tempo.');
  }

  // A duration of 4 is one beat, so a whole note is four beats.
  const wholeNoteMs = (60000 / bpm) * 4;

  const notes = [];
  for (const raw of notesPart.split(',')) {
    const token = raw.trim().toLowerCase();
    if (!token) {
      continue;
    }
    // [duration][note letter][#][.][octave][.]  -- the dot is legal either side
    // of the octave digit, both spellings turn up in the wild.
    const match = token.match(/^(\d*)([a-gp])(#?)(\.?)(\d*)(\.?)$/);
    if (!match) {
      throw new Error(`Cannot read the note "${raw.trim()}" in the ringtone.`);
    }
    const [, durationText, letter, sharp, dotBefore, octaveText, dotAfter] = match;

    const duration = durationText ? Number.parseInt(durationText, 10) : defaultDuration;
    if (!duration) {
      throw new Error(`Note "${raw.trim()}" has a zero duration.`);
    }
    const dotted = Boolean(dotBefore || dotAfter);
    // A dot adds half the note's own length.
    const durationMs = (wholeNoteMs / duration) * (dotted ? 1.5 : 1);

    if (letter === 'p') {
      notes.push({ frequency: 0, durationMs });
      continue;
    }

    const octave = octaveText ? Number.parseInt(octaveText, 10) : defaultOctave;
    // RTTTL octave 5 is the middle octave, where a5 is 440 Hz, which lines up
    // with MIDI note number = octave * 12 + semitone.
    const midi = octave * 12 + SEMITONES[letter] + (sharp ? 1 : 0);
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    notes.push({ frequency, durationMs });
  }

  if (notes.length === 0) {
    throw new Error('Ringtone has no notes.');
  }

  return { name, notes };
}

/** Total play time of a parsed ringtone, in milliseconds. */
export function totalDurationMs(parsed) {
  return parsed.notes.reduce((sum, note) => sum + note.durationMs, 0);
}

// One shared AudioContext, created on the first play so the browser sees it
// happen inside a click and does not block it.
let audioContext = null;
let current = null;

/** Stop whatever is playing. Safe to call when nothing is. */
export function stop() {
  if (!current) {
    return;
  }
  const { oscillator, gain, endTimer } = current;
  current = null;
  clearTimeout(endTimer);
  try {
    // Drop the gain first, so stopping the oscillator does not click.
    gain.gain.cancelScheduledValues(audioContext.currentTime);
    gain.gain.setValueAtTime(0, audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.01);
  } catch {
    // Already stopped, nothing to do.
  }
}

/**
 * Play an RTTTL string through the speakers.
 *
 * @param {string} rtttl the ringtone
 * @param {() => void} [onEnd] called when playback finishes on its own
 * @returns {number} play time in milliseconds
 */
export function play(rtttl, onEnd) {
  const parsed = parseRtttl(rtttl);

  if (typeof AudioContext === 'undefined' && typeof webkitAudioContext === 'undefined') {
    throw new Error('This browser has no Web Audio, so the preview cannot play.');
  }
  if (!audioContext) {
    const Ctor = typeof AudioContext !== 'undefined' ? AudioContext : webkitAudioContext;
    audioContext = new Ctor();
  }
  // Autoplay policy: a context created before any gesture starts suspended.
  // Calling this from a click handler is what lets it start.
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }

  // A new preview always replaces the running one.
  stop();

  const gain = audioContext.createGain();
  gain.gain.value = 0;
  gain.connect(audioContext.destination);

  const oscillator = audioContext.createOscillator();
  // Square wave is the closest simple match for a piezo buzzer.
  oscillator.type = 'square';
  oscillator.connect(gain);

  // Keep the level low, a square wave at full gain is painful.
  const level = 0.1;
  // Short ramps at each edge remove the clicks a hard gate produces.
  const ramp = 0.005;

  let at = audioContext.currentTime + 0.02;
  oscillator.frequency.setValueAtTime(parsed.notes[0].frequency || 440, at);

  for (const note of parsed.notes) {
    const seconds = note.durationMs / 1000;
    if (note.frequency > 0) {
      oscillator.frequency.setValueAtTime(note.frequency, at);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(level, at + ramp);
      // Leave a hair of silence before the next note so repeats stay distinct.
      gain.gain.setValueAtTime(level, Math.max(at + ramp, at + seconds - ramp * 2));
      gain.gain.linearRampToValueAtTime(0, at + seconds);
    } else {
      gain.gain.setValueAtTime(0, at);
    }
    at += seconds;
  }

  oscillator.start();
  oscillator.stop(at + 0.02);

  const totalMs = totalDurationMs(parsed);
  const endTimer = setTimeout(() => {
    current = null;
    if (onEnd) {
      onEnd();
    }
  }, totalMs + 60);

  current = { oscillator, gain, endTimer };
  return totalMs;
}

/** True while a preview is playing. */
export function isPlaying() {
  return current !== null;
}
