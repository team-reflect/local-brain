// Prevent an extra console window on Windows in release; does nothing elsewhere.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    local_brain_lib::run()
}
