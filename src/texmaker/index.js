// src/texmaker: the procedural texture maker (ARCHITECTURE §5b "Make your own"), part 2 of the texture work. A generator
// on its own: it knows nothing of slots, mapping or DDS (A's src/texture/*). A's pipeline takes what makeTexture returns,
// { width, height, rgba }, exactly as it takes a decoded PNG (src/texture/image.js decodeImage), and makes the DDS.
//
//   makeTexture(params, width, height) -> { width, height, rgba, emissive }     params: a texture's text or object
//   parse(text) / serialize(texture) / normalize(object)                         the texture as canonical text
//   LAYERS (the parameter sets), PRESETS (starting textures), TexmakerError (every refusal, with a named `code`)
// Dependency-free.
'use strict';

module.exports = {
  ...require('./make.js'),
  ...require('./text.js'),
  ...require('./schema.js'),
  ...require('./presets.js'),
  ...require('./errors.js'),
};
