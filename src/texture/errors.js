// errors.js: the texture side's one error type. `code` names the reason, so the app can say it and the tests can pin it:
//   BAD_IMAGE            the file is not a valid image of the kind it claims to be
//   TEXTURE_UNSUPPORTED  a valid image in a form this builder does not read (progressive JPEG, interlaced PNG, …)
//   TEXTURE_TOO_LARGE    larger than the game's limit on a side
//   NOT_AN_IMAGE         neither a PNG nor a JPEG
//   BAD_TEXTURE_NAME     a name the document would refuse (src/doc/textures.js NAME_RE)
//   NO_SUCH_TEXTURE      a slot names a texture the set was not given
//   COMPRESSED_NORMAL    a normal map asked to be block-compressed (§5b: "no compressed normal maps")
'use strict';
class TextureError extends Error { constructor(code, message) { super(message); this.name = 'TextureError'; this.code = code; } }
module.exports = { TextureError };
