// src/texture: track textures (ARCHITECTURE §5b), part 1: slots, automatic mapping, bring-your-own PNG/JPG → DDS with
// mipmaps, the warnings, and the one texture set the preview and the export share. Dependency-free.
'use strict';
module.exports = {
  ...require('./errors.js'),
  slots: require('./slots.js'),
  mapping: require('./mapping.js'),
  ...require('./image.js'),
  png: require('./png.js'),
  jpeg: require('./jpeg.js'),
  dds: require('./dds.js'),
  ...require('./warnings.js'),
  ...require('./set.js'),
};
