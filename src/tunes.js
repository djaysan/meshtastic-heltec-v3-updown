// Ready-made ringtones for the buzzer, as RTTTL strings.
//
// The firmware stores the ringtone in AdminMessage.set_ringtone_message, which
// nanopb caps at max_size:231, so 230 usable characters. Every tune below is
// kept under that by ending the melody early rather than being rejected at
// write time. trimRtttl() enforces it on anything that slips through.

import { RINGTONE_MAX } from './apply-config.js';

// The stock Meshtastic ringtone, as shipped in the firmware.
export const DEFAULT_RINGTONE = '24:d=32,o=5,b=565:f6,p,f6,4p,p,f6,p,f6,2p,p,b6,p,b6,p,b6,p,b6,p,b,p,b,p,b,p,b,p,b,p,b,p,b,p,b,1p.,2p.,p';

const RAW_TUNES = [
  // Whatever the node already plays out of the box.
  { name: 'Meshtastic default', rtttl: DEFAULT_RINGTONE },

  // Short classics, all widely circulated as RTTTL ringtones.
  { name: 'Nokia style', rtttl: 'Nokia:d=4,o=5,b=225:8e6,8d6,f#,g#,8c#6,8b,d,e,8b,8a,c#,e,2a' },
  { name: 'Mario style', rtttl: 'Mario:d=4,o=5,b=100:16e6,16e6,32p,8e6,16c6,8e6,8g6,8p,8g,8p,16c6,16p,16g,16p,16e,8p,16a,16b,16a#,16a,16g' },
  { name: 'Star Wars style', rtttl: 'StarWars:d=4,o=5,b=100:8d.,16p,8d.,16p,8d.,16p,8a#4,16p,16f,8d.,16p,16a#4,16p,16f,2d.' },
  { name: 'Tetris style', rtttl: 'Tetris:d=4,o=5,b=160:e6,8b,8c6,8d6,16e6,16d6,8c6,8b,a,8a,8c6,e6,8d6,8c6,b,8b,8c6,d6,e6,c6,a,2a' },
  { name: 'Mission Impossible', rtttl: 'Mission:d=16,o=6,b=95:32d,32d#,32d,32d#,32d,32d#,32d,32d#,32d,32d,32d#,32e,32f,32f#,32g,g,8p,g,8p,a#,p,c7,p,g,8p,g,8p,f,p,f#,p,2g' },
  { name: 'Axel F style', rtttl: 'AxelF:d=4,o=5,b=125:32p,8g,8p,16a#.,8p,16g,16p,16g,8c6,8g,8f,8g,8p,16d.6,8p,16g,16p,16f,16p,16f,8d,8g#,8g' },
  { name: 'Jingle Bells', rtttl: 'Jingle:d=8,o=5,b=112:e,e,4e,e,e,4e,e,g,c,d,1e,f,f,f.,16f,f,e,e,16e,16e,e,d,d,e,2d' },
  { name: 'Beethoven 5th', rtttl: 'Beethoven:d=8,o=5,b=125:g,g,g,2d#,p,f,f,f,2d' },
  { name: 'Westminster chime', rtttl: 'Westminster:d=4,o=5,b=100:e,d,c,2g4,p,e4,g4,c,2d,p,e,c,d,2g4,p,g4,d,e,2c' },
  { name: 'Close encounters', rtttl: 'Encounters:d=4,o=5,b=125:8d,8e,8c,8c4,2g4' },

  // Plain alerts, for when a melody is too much.
  { name: 'Two beeps', rtttl: 'Two beeps:d=16,o=6,b=200:c,8p,c' },
  { name: 'Three rising notes', rtttl: 'Three notes:d=16,o=6,b=180:c,e,g' },
  { name: 'SOS', rtttl: 'SOS:d=16,o=6,b=180:c,p,c,p,c,4p,8c.,p,8c.,p,8c.,4p,c,p,c,p,c' },
];

/**
 * Cut an RTTTL string down to the firmware limit by dropping notes off the end,
 * so a long melody plays a shorter section instead of failing to write.
 *
 * @param {string} rtttl the ringtone
 * @param {number} [limit] maximum characters, defaults to the firmware limit
 */
export function trimRtttl(rtttl, limit = RINGTONE_MAX) {
  if (rtttl.length <= limit) {
    return rtttl;
  }
  const secondColon = rtttl.indexOf(':', rtttl.indexOf(':') + 1);
  const header = rtttl.slice(0, secondColon + 1);
  const notes = rtttl.slice(secondColon + 1).split(',');
  // Add notes back one at a time until the next one would not fit.
  const kept = [];
  for (const note of notes) {
    const candidate = kept.length === 0 ? note : `${kept.join(',')},${note}`;
    if (header.length + candidate.length > limit) {
      break;
    }
    kept.push(note);
  }
  return header + kept.join(',');
}

/** The tune list, every entry guaranteed to fit the firmware limit. */
export const TUNES = RAW_TUNES.map((tune) => ({
  name: tune.name,
  rtttl: trimRtttl(tune.rtttl),
}));

/** Look a tune up by its display name. */
export function findTune(name) {
  return TUNES.find((tune) => tune.name === name);
}
