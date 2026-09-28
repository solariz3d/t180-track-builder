// errors.js: the texture maker's one error type. Every refusal names its reason in `code`, and says what and where in
// the message, so the panel can show it and a test can match it:
//   BAD_TEXT       the text is not JSON, or not a texture (no "texmaker" version)
//   BAD_VERSION    a texture from a newer maker (a higher "texmaker" number)
//   UNKNOWN_KEY    a key the schema does not have (at the top or in a layer)
//   UNKNOWN_LAYER  a layer type the maker does not know
//   BAD_PARAM      a value of the wrong kind or out of its range (the layer, the key, the range)
//   TOO_MANY_LAYERS more than MAX_LAYERS layers
//   BAD_SIZE       a render size that is not a whole number of pixels from 1 to 8192 (AC's DDS limit, §5b)
'use strict';

class TexmakerError extends Error {
  constructor(code, message) { super(message); this.name = 'TexmakerError'; this.code = code; }
}

module.exports = { TexmakerError };
