// image.js: bytes → { width, height, rgba }, whichever of the two formats §5b takes ("Drop in PNG or JPG images").
// The format is sniffed from the bytes, never from a file name. Anything else is refused as NOT_AN_IMAGE, by name.
'use strict';
const { decodePng, isPng } = require('./png.js');
const { decodeJpeg, isJpeg } = require('./jpeg.js');
const { TextureError } = require('./errors.js');

function sniff(bytes) { return isPng(bytes) ? 'png' : isJpeg(bytes) ? 'jpeg' : null; }

function decodeImage(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const kind = sniff(b);
  if (kind === 'png') return { format: 'png', ...decodePng(b) };
  if (kind === 'jpeg') return { format: 'jpeg', ...decodeJpeg(b) };
  const dds = b.length >= 4 && b[0] === 0x44 && b[1] === 0x44 && b[2] === 0x53 && b[3] === 0x20;
  throw new TextureError('NOT_AN_IMAGE', dds ? 'this is already a DDS; bring the PNG or JPG it was made from' : 'not a PNG or a JPEG (the first bytes are neither signature)');
}

module.exports = { sniff, decodeImage };
