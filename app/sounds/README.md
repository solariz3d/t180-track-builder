# The builder's sounds

Four WAVs, read by `app/sound.js`. A missing file is a silent slot.

| file | when it plays | length |
|---|---|---|
| `drag_tick.wav` | a dragged handle's value moves one step | 30 to 60 ms |
| `place.wav` | a piece is placed | 150 to 300 ms |
| `undo.wav` | a step is undone (ideally `place.wav` mirrored) | 150 to 300 ms |
| `loop_closed.wav` | the loop is closed | 1.5 to 4 s |

WAV, 48 kHz, peaking around −3 dB, leading silence trimmed.

Sounds by solariz3d, made in Serum (Xfer Records), from his own patches with no third-party samples or wavetables.
