// Prevents an extra console window on Windows in release, does nothing on other OSes.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    t180_track_builder_lib::run()
}
