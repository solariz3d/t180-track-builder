# blender_fbx.py: run by the user's own Blender, headless, to turn the builder's .glb into the FBX ksEditor takes.
#   blender.exe --background --factory-startup --python blender_fbx.py -- <in.glb> <out.fbx>
# Prints one line "T180FBX ok <objects>" or "T180FBX error <message>" and exits; nothing is opened in a window and nothing is saved but <out.fbx>.
#
# THE SETTINGS, measured on the builder's own export (test/export_blender_fbx.test.js reads the FBX back with test/fbx_read.js):
#   axis_up 'Y', axis_forward '-Z': the exact inverse of the glTF importer's turn (x, y, z) -> (x, -z, y), so the FBX holds the kn5's own frame (Y up,
#     right-handed: on real AC tracks the left timing gate lies on cross(up, race direction), src/export/markers.js), not a mirror and not a rotation;
#   bake_space_transform: that turn goes into the vertex data, every object keeps an identity transform (a mesh's vertices are the kn5's, to the float);
#   apply_unit_scale with Apply Scalings 'FBX All': the vertices stay in metres and the file says so (UnitScaleFactor 100: FBX counts in centimetres);
#     the other choice ('All Local') writes centimetre transforms of 100 on every group, which other tools read at the wrong scale;
#   mesh and empties only (the AC_ markers are empties), no animation, no leaf bones; the textures copied into the file.
import bpy, sys, traceback

def main():
    args = sys.argv[sys.argv.index('--') + 1:]
    if len(args) != 2:
        raise SystemExit('usage: blender --background --factory-startup --python blender_fbx.py -- <in.glb> <out.fbx>')
    glb, fbx = args
    bpy.ops.import_scene.gltf(filepath=glb, merge_vertices=False)
    bpy.ops.export_scene.fbx(
        filepath=fbx, use_selection=False, object_types={'MESH', 'EMPTY'},
        axis_up='Y', axis_forward='-Z', bake_space_transform=True,
        global_scale=1.0, apply_unit_scale=True, apply_scale_options='FBX_SCALE_ALL',
        bake_anim=False, add_leaf_bones=False, mesh_smooth_type='OFF',
        path_mode='COPY', embed_textures=True)
    print('T180FBX ok %d' % len(bpy.data.objects))

try:
    main()
except SystemExit:
    raise
except Exception as e:
    print('T180FBX error %s' % str(e).replace('\n', ' '))
    traceback.print_exc()
    sys.exit(1)
