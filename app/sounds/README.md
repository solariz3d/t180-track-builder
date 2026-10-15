# The builder's sounds

There are no sound files here: the builder makes its sounds in code, live, with the window's own audio engine (`app/sound.js`). Nothing has to be installed for them, and they ship with the app like the rest of it.

What plays when, and the space they sit in (the "void" reverb, the stereo width, the echo), is described at the top of `app/sound.js`. The design is the first draft chosen on 2026-10-15: a Rhodes palette in C.

This folder is kept for sounds rendered from a synth later (for example, Serum patches made by the track builder's author), if any part of the draft is replaced by a recording.
