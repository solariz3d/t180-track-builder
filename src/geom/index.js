// src/geom: the geometry core (docs/ARCHITECTURE.md §3; the shapes are docs/INTERFACES.md §2).
'use strict';
const { buildPath, extendPath, rebuildPathFrom, buildHead, headCamera } = require('./path.js');
const { buildMesh, extendMesh, sculptMesh, reuseMesh } = require('./mesh.js');
const { selfCheck } = require('./bvh.js');
const profile = require('./profile.js');
module.exports = { buildPath, extendPath, rebuildPathFrom, buildHead, headCamera, buildMesh, extendMesh, sculptMesh, reuseMesh, selfCheck, profile };
