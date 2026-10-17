# The builder's sounds

Recorded samples rendered offline from Serum's factory presets on the sketch page (batch 8, 2026-10-16; the tick from batch 9 and the melodies' instruments from batch 10, 2026-10-17). Each is 16-bit stereo at 48 kHz.

| file | the sound | preset | rendered on | sha256 |
|---|---|---|---|---|
| `drag_tick.wav` | the tick of a dragged handle | Eiano tik (batch 9, the keeper's pick) | MIDI 84 | `0c63854e26167115886d2d0fc947362cdc72c82271b12e2bcb5a2cf8fe6cbfa8` |
| `place.wav` | a piece placed (batch 8; no longer played, kept) | SY Eiano [LT] | MIDI 60 | `feb0e8936def375353c4381a1b8eeb09cf7968a740e2c289bfb812c9daca18c2` |
| `undo.wav` | a step undone (batch 8; no longer played, kept) | SY Eiano [LT], softer | MIDI 60 | `7c630ede9b91662291a87f5c4ff0556d4d4cb55f6415fe0b1026bd55f33cd63f` |
| `loop_closed.wav` | the loop closed | SY Eiano and SY Vintage Bells | the whole gesture | `34fd8b2193a46a20add00efff7379c836b03795fb5bbd9e0531906e273852308` |
| `place_yearning.wav` | a piece placed, in the yearning melody | KY WurlyKeys [ASL] (batch 10) | MIDI 60 | `d2607f5facd0f209e916ac11e00e410cff807edbe091cc8202ac39d02f5fba81` |
| `undo_yearning.wav` | a step undone, in the yearning melody | KY WurlyKeys [ASL], softer | MIDI 60 | `2de01fc22e712b09d17254afbfe09de2ac9a7b77afc4ce12c93a476df15a4bd7` |
| `place_shoegaze.wav` | a piece placed, in the shoegaze melody | PL Pads Pluck [BR] (batch 10) | MIDI 60 | `0e56d383420db70ea9781af5f21abc7729fb16585ad8ef6b2fb0f7ad36b069c7` |
| `undo_shoegaze.wav` | a step undone, in the shoegaze melody | PL Pads Pluck [BR], softer | MIDI 60 | `c9eaec216cbc4092ed3de2a47a1f5f5d4d63118d7bd053784590b4454cfc950c` |
| `place_occult.wav` | a piece placed, in the occult melody | SY Vintage Bells [FP] (batch 10) | MIDI 60 | `3661d6f774d6cb34a38abc41dc6613d73b5d56d28b5b1ec5bcf39f89651ae4e6` |
| `undo_occult.wav` | a step undone, in the occult melody | SY Vintage Bells [FP], softer | MIDI 60 | `93f810f129174232d4d3c9c89ff185959ae51ef4618d850c22cd3f6ac416330c` |
| `place_afterglow.wav` | a piece placed, in the afterglow melody | PL D_Pluck [DU] (batch 10) | MIDI 60 | `79569a9369888d0484943049a951131afcf3d2d88ad7dc9606d61b6823a47be1` |
| `undo_afterglow.wav` | a step undone, in the afterglow melody | PL D_Pluck [DU], softer | MIDI 60 | `be672b7fad2fba009fd71986d14b868a234f50d00d38e4e98df786417b894d30` |

`app/sound.js` plays every note of a sound from its one sample, pitched by playback rate from the note it was rendered on, so the melodies and the rules for which note plays are the same as before. The loop close plays whole.

Place and undo play one of four melodies, picked at random each time the builder starts (`MELODIES` in `app/sound.js`). Each melody has its own two slots, `place_<name>` and `undo_<name>`, each playing that melody's own file above (`SAMPLES.file`, one line per melody, so one melody's instrument can be changed alone). Each file is levelled to play at the place or undo gain.

The samples load once, when audio starts (the first press or key). Until they are decoded, or if they fail to load, the builder plays its own synth voices, made live in code, so it is never silent. `app/test/sound-samples.test.js` checks every file here byte for byte against the hashes above, and that every slot names a file that is here.
