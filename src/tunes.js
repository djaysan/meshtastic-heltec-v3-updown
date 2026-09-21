/**
 * Ringtones for the buzzer, as RTTTL strings.
 *
 * Every entry here is machine checked against the grammar the firmware's
 * player (NonBlockingRTTTL) actually accepts, which is stricter than RTTTL
 * in general:
 *   - the header must be exactly d=, then o=, then b=, in that order, with
 *     no extra keys, because the parser walks it positionally
 *   - the default octave must be a single digit 3 to 7
 *   - a dotted note writes the dot before the octave digit, as in 16g.6
 *   - the whole string must fit 230 characters (char ringtone[231] in the
 *     firmware's rtttl.pb.h)
 * Longer melodies are cut at a note boundary rather than mid note.
 *
 * Sources: the Meshtastic stock ringtone; the examples shipped with
 * NonBlockingRTTTL (MIT), which is the same player the firmware uses;
 * the Meshtastic ringtone guide at mtnme.sh; and the Nokia era RTTTL
 * strings that have been in circulation for decades. Plain alert tones
 * were written for this repo.
 */

import { RINGTONE_MAX } from './apply-config.js';

export const TUNES = [
  { name: '24 CTU ring (Meshtastic default)', rtttl: '24CTUringMes:d=32,o=5,b=565:f6,p,f6,4p,p,f6,p,f6,2p,p,b6,p,b6,p,b6,p,b6,p,b,p,b,p,b,p,b,p,b,p,b,p,b,p,b,1p.,2p.,p' },
  { name: 'Arkanoid', rtttl: 'Arkanoid:d=4,o=5,b=140:8g6,16p,16g.6,2a#6,32p,8a6,8g6,8f6,8a6,2g6' },
  { name: 'Tetris', rtttl: 'Tetris:d=4,o=5,b=160:e6,8b,8c6,8d6,16e6,16d6,8c6,8b,a,8a,8c6,e6,8d6,8c6,b,8b,8c6,d6,e6,c6,a,2a' },
  { name: 'Mario theme', rtttl: 'Mariotheme:d=4,o=5,b=100:16e6,16e6,32p,8e6,16c6,8e6,8g6,8p,8g,8p,8c6,16p,8g,16p,8e,16p,8a,8b,16a#,8a,16g.,16e6,16g6,8a6,16f6,8g6,8e6,16c6,16d6,8b' },
  { name: 'Zelda get item', rtttl: 'Zeldagetitem:d=16,o=5,b=120:g,c6,d6,2g6' },
  { name: 'Mario coin', rtttl: 'Mariocoin:d=8,o=6,b=200:b,e7' },
  { name: 'Mario power up', rtttl: 'Mariopowerup:d=16,o=5,b=200:g,a,b,c6,d6,e6,f#6,g6,a6,b6,2c7' },
  { name: 'Nokia tune', rtttl: 'Nokiatune:d=4,o=5,b=180:8e6,8d6,f#,g#,8c#6,8b,d,e,8b,8a,c#,e,2a' },
  { name: 'Morse CQ', rtttl: 'MorseCQ:d=16,o=6,b=120:8c,p,c,p,8c,p,c,4p,8c,p,8c,p,c,p,8c,8p' },
  { name: 'Imperial march', rtttl: 'Imperialmarc:d=4,o=5,b=112:8d.,16p,8d.,16p,8d.,16p,8a#4,16p,16f,8d.,16p,16f,8d.,32p,2a' },
  { name: 'Star Wars theme', rtttl: 'StarWarsthem:d=4,o=5,b=180:8f,8f,8f,2a#,2f6,8d#6,8d6,8c6,2a#6,f6,8d#6,8d6,8c6,2a#6,f6,8d#6,8d6,8d#6,2c6' },
  { name: 'Indiana Jones', rtttl: 'IndianaJones:d=4,o=5,b=250:e,8p,8f,8g,8p,1c6,8p.,d,8p,8e,1f,p.,g,8p,8a,8b,8p,1f6,p,a,8p,8b,2c6,2d6,2e6' },
  { name: 'James Bond', rtttl: 'JamesBond:d=4,o=5,b=80:32p,16c#6,32d#6,32d#6,16d#6,8d#6,16c#6,16c#6,16c#6,16c#6,32e6,32e6,16e6,8e6,16d#6,16d#6,16d#6,16c#6' },
  { name: 'The A-Team', rtttl: 'TheATeam:d=8,o=5,b=125:4d#6,a#,2d#6,16p,g#,4a#,4d#.,p,16g,16a#,d#6,a#,f6,2d#6' },
  { name: 'Addams Family', rtttl: 'AddamsFamily:d=4,o=5,b=160:8c,f,8a,f,8c,b4,2g,8f,e,8g,e,8e4,a4,2f' },
  { name: 'The Simpsons', rtttl: 'TheSimpsons:d=4,o=5,b=160:c.6,e6,f#6,8a6,g.6,e6,c6,8a,8f#,8f#,8f#,2g' },
  { name: 'The X-Files', rtttl: 'TheXFiles:d=4,o=5,b=125:e,b,a,b,d6,2b.,1p,e,b,a,b,e6,2b.,1p,g6,f#6,e6,d6,e6,2b.' },
  { name: 'Pink Panther', rtttl: 'PinkPanther:d=4,o=5,b=160:8d#,8e,2p,8f#,8g,2p,8d#,8e,16p,8f#,8g,16p,8c6,8b,16p,8d#,8e,16p,8b,2a#,2p' },
  { name: 'Popcorn', rtttl: 'Popcorn:d=4,o=5,b=160:8c6,8a#,8c6,8g,8d#,8g,1c,8c6,8a#,8c6,8g,8d#,8g,1c' },
  { name: 'Mission Impossible', rtttl: 'MissionImpos:d=16,o=6,b=95:32d,32d#,32d,32d#,32d,32d#,32d,32d#,32d,32d,32d#,32e,32f,32f#,32g,g,8p,g,8p,a#,p,c7,p,g,8p,g,8p,f,p,f#,p,g,8p' },
  { name: 'Axel F', rtttl: 'AxelF:d=4,o=5,b=160:f#,8a#,8f#,16f#,8g#,8f#,8e,f#,8c#6,8f#,16f#,8d#6,8c#6,8a#,8f#,8c#6,8f#6,16f#,8e,8e,8c#,8g#,2f#' },
  { name: 'Entertainer', rtttl: 'Entertainer:d=4,o=5,b=140:8d,8d#,8e,c6,8e,c6,8e,2c.6,8c6,8d6,8d#6,8e6,8c6,8d6,e6,8b,d6,2c6' },
  { name: 'Fuer Elise', rtttl: 'FuerElise:d=8,o=5,b=125:e6,d#6,e6,d#6,e6,b,d6,c6,a,p,c,e,a,b,p,e,g#,b,c6,p,e,e6,d#6,e6,d#6,e6,b,d6,c6,a' },
  { name: 'Ode to Joy', rtttl: 'OdetoJoy:d=4,o=5,b=125:e,e,f,g,g,f,e,d,c,c,d,e,e.,8d,2d' },
  { name: 'Jingle Bells', rtttl: 'JingleBells:d=8,o=5,b=112:e,e,4e,e,e,4e,e,g,c,d,1e,f,f,f.,16f,f,e,e,16e,16e,e,d,d,e,2d,2g' },
  { name: 'Happy Birthday', rtttl: 'HappyBirthda:d=4,o=5,b=125:8c.,16c,d,c,f,2e,8c.,16c,d,c,g,2f,8c.,16c,c6,a,f,e,d' },
  { name: 'Beethoven 5th', rtttl: 'Beethoven5th:d=8,o=5,b=125:g,g,g,2d#,p,f,f,f,2d' },
  { name: 'Westminster chime', rtttl: 'Westminsterc:d=4,o=5,b=90:e,c,d,2g4,p,g4,d,e,2c' },
  { name: 'Charge', rtttl: 'Charge:d=4,o=5,b=140:8c,8e,8g,2c6,8p,8g,1c6' },
  { name: 'Close encounters', rtttl: 'Closeencount:d=4,o=5,b=125:d,e,c,c4,2g4' },
  { name: 'Single beep', rtttl: 'Singlebeep:d=16,o=6,b=200:c' },
  { name: 'Two beeps', rtttl: 'Twobeeps:d=16,o=6,b=200:c,p,c' },
  { name: 'Three beeps', rtttl: 'Threebeeps:d=16,o=6,b=200:c,p,c,p,c' },
  { name: 'Rising three', rtttl: 'Risingthree:d=16,o=5,b=180:c6,e6,g6' },
  { name: 'Falling three', rtttl: 'Fallingthree:d=16,o=5,b=180:g6,e6,c6' },
  { name: 'Chirp', rtttl: 'Chirp:d=32,o=7,b=220:c,e,c' },
  { name: 'Alarm', rtttl: 'Alarm:d=16,o=6,b=200:c,g,c,g,c,g,c,g' },
  { name: 'Siren', rtttl: 'Siren:d=8,o=5,b=110:a6,d6,a6,d6,a6,d6' },
  { name: 'SOS', rtttl: 'SOS:d=16,o=6,b=180:c,p,c,p,c,4p,4c,p,4c,p,4c,4p,c,p,c,p,c' },
];

/** The stock Meshtastic ringtone, used as the default in the form. */
export const DEFAULT_RINGTONE = TUNES[0].rtttl;

/** Cut an RTTTL string to the firmware limit at a note boundary. */
export function trimRtttl(rtttl, limit = RINGTONE_MAX) {
  if (rtttl.length <= limit) {
    return rtttl;
  }
  const colon = rtttl.indexOf(':', rtttl.indexOf(':') + 1);
  const head = rtttl.slice(0, colon + 1);
  const notes = rtttl.slice(colon + 1).split(',');
  while (notes.length > 1 && (head + notes.join(',')).length > limit) {
    notes.pop();
  }
  return head + notes.join(',');
}

/** Look a tune up by its display name. */
export function findTune(name) {
  return TUNES.find((tune) => tune.name === name);
}
