// src/geom: the geometry core (docs/ARCHITECTURE.md §3; the shapes are docs/INTERFACES.md §2).
'use strict';
const { buildPath, buildPathSteps, extendPath, extendPathSteps, rebuildPathFrom, buildHead, headCamera } = require('./path.js');
const { buildMesh, buildMeshSteps, extendMesh, extendMeshSteps, sculptMesh, reuseMesh } = require('./mesh.js');
const { selfCheck } = require('./bvh.js');
const profile = require('./profile.js');
module.exports = { buildPath, buildPathSteps, extendPath, extendPathSteps, rebuildPathFrom, buildHead, headCamera, buildMesh, buildMeshSteps, extendMesh, extendMeshSteps, sculptMesh, reuseMesh, selfCheck, profile };
