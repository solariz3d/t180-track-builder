# The builder's sounds

Four recorded samples, one per sound, rendered offline from Serum's factory presets (the sketch page's batch 8, 2026-10-16). Each is 16-bit stereo at 48 kHz.

| file | the sound | preset | rendered on | sha256 |
|---|---|---|---|---|
| `drag_tick.wav` | the tick of a dragged handle | PL Mallety [SD] | MIDI 84 | `6e059b3bf456d731d375ccf89b374fb89d70146f8159737fc39bf2827517d7bd` |
| `place.wav` | a piece placed | SY Eiano [LT] | MIDI 60 | `feb0e8936def375353c4381a1b8eeb09cf7968a740e2c289bfb812c9daca18c2` |
| `undo.wav` | a step undone | SY Eiano [LT], softer | MIDI 60 | `7c630ede9b91662291a87f5c4ff0556d4d4cb55f6415fe0b1026bd55f33cd63f` |
| `loop_closed.wav` | the loop closed | SY Eiano and SY Vintage Bells | the whole gesture | `34fd8b2193a46a20add00efff7379c836b03795fb5bbd9e0531906e273852308` |

`app/sound.js` plays every note of a sound from its one sample, pitched by playback rate from the note it was rendered on, so the melodies and the rules for which note plays are the same as before. The loop close plays whole.

The samples load once, when audio starts (the first press or key). Until they are decoded, or if they fail to load, the builder plays its own synth voices, made live in code, so it is never silent. `app/test/sound-samples.test.js` checks these four files byte for byte against the hashes above.
