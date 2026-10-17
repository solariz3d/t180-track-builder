# The builder's sounds

Recorded samples rendered offline from Serum's factory presets on the sketch page (batch 8, 2026-10-16; the tick from batch 9 and the melodies' instruments from batches 11 and 12, 2026-10-17). Each is 16-bit stereo at 48 kHz.

| file | the sound | preset | rendered on | sha256 |
|---|---|---|---|---|
| `drag_tick.wav` | the tick of a dragged handle | Eiano tik (batch 9, the keeper's pick) | MIDI 84 | `0c63854e26167115886d2d0fc947362cdc72c82271b12e2bcb5a2cf8fe6cbfa8` |
| `loop_closed.wav` | the loop closed | SY Eiano and SY Vintage Bells | the whole gesture | `34fd8b2193a46a20add00efff7379c836b03795fb5bbd9e0531906e273852308` |
| `place_aqua.wav` | a piece placed, in the aqua melody | PL Big Bells [AS] (batch 11) | MIDI 60 | `5b8b211c557ff965f897d1c6e6c761b0e9cc0c370311c2459fcae71cd5c0e4b7` |
| `undo_aqua.wav` | a step undone, in the aqua melody | PL Big Bells [AS], softer | MIDI 60 | `d74353c720b0788d0917939dcbdb1114400f96336f7b3f77ec7ee40e79a622ef` |
| `place_skyline.wav` | a piece placed, in the skyline melody | SY Runtheharm [GS] (batch 11) | MIDI 60 | `33f7aac3cbabf4b86a400b6087b39f3ec3546fafe2b931b47b8b09a2e013be93` |
| `undo_skyline.wav` | a step undone, in the skyline melody | SY Runtheharm [GS], softer | MIDI 60 | `bbb4608845e8a373ff578b63090e2fcb861c7183276864ab7efd93db3caf9bec` |
| `place_glass.wav` | a piece placed, in the glass melody | SY VeloHarm [GS] (batch 11) | MIDI 60 | `96b5268d2ce972d05d9d625b52c86523500306f60411a64d6567d8bf26504b61` |
| `undo_glass.wav` | a step undone, in the glass melody | SY VeloHarm [GS], softer | MIDI 60 | `1a1971604311bdad48f02a33104cf7c8b7f075c940a94a2e1c8206a9708d93c5` |
| `place_aurora.wav` | a piece placed, in the aurora melody | SY Linear Arithmetic [FP] (batch 12) | MIDI 60 | `929e061648f00a5360db018742f35e0b33da43c506a579e2d6d4251d81e29cd7` |
| `undo_aurora.wav` | a step undone, in the aurora melody | SY Linear Arithmetic [FP], softer | MIDI 60 | `c91f9db343bfe20ed6ee453598fdf3637990b1ac4f918996cab7532797c3ff7b` |

`app/sound.js` plays every note of a sound from its one sample, pitched by playback rate from the note it was rendered on, so the melodies and the rules for which note plays are the same as before. The loop close plays whole.

Place and undo play one of four melodies, picked at random each time the builder starts (`MELODIES` in `app/sound.js`). Each melody has its own two slots, `place_<name>` and `undo_<name>`, each playing that melody's own file above (`SAMPLES.file`, one line per melody, so one melody's instrument can be changed alone). Each file is levelled to play at the place or undo gain. A place also swells with its step (`swellDb`): 1 dB under that gain at the first step, rising to 0.7 dB over it across steps 45 to 52, and easing back by step 64. An undo is not swelled.

The samples load once, when audio starts (the first press or key). Until they are decoded, or if they fail to load, the builder plays its own synth voices, made live in code, so it is never silent. `app/test/sound-samples.test.js` checks every file here byte for byte against the hashes above, and that every slot names a file that is here.
