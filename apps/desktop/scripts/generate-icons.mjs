import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const sourcePath = path.resolve(appDir, "assets/app-icon-source.png");
const processedPath = path.resolve(appDir, "assets/app-icon-processed.png");

const size = 1024;
const radius = 230;

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: appDir,
    stdio: "inherit",
    ...options,
  });
}

if (!existsSync(sourcePath)) {
  throw new Error(`Missing app icon source: ${sourcePath}`);
}

try {
  execFileSync("magick", ["-version"], { stdio: "ignore" });
} catch {
  throw new Error("ImageMagick is required to post-process the app icon. Install it with `brew install imagemagick`.");
}

run("magick", [
  sourcePath,
  "-resize",
  `${size}x${size}^`,
  "-gravity",
  "center",
  "-extent",
  `${size}x${size}`,
  "(",
  "-size",
  `${size}x${size}`,
  "xc:none",
  "-fill",
  "white",
  "-draw",
  `roundrectangle 0,0 ${size - 1},${size - 1} ${radius},${radius}`,
  ")",
  "-alpha",
  "off",
  "-compose",
  "CopyOpacity",
  "-composite",
  processedPath,
]);

run("pnpm", ["tauri", "icon", processedPath]);
