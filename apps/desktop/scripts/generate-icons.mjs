import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const sourcePath = path.resolve(appDir, "assets/app-icon-source.png");
const processedPath = path.resolve(appDir, "assets/app-icon-processed.png");
const tauriIconPath = path.resolve(appDir, "src-tauri/icons/icon.icns");
const ictoolPath = "/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool";
const iconutilPath = "/usr/bin/iconutil";
const sipsPath = "/usr/bin/sips";
const isMac = process.platform === "darwin";
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const macFillGradient = "extended-srgb:0.05490,0.01176,0.25882,1.00000";
const macShadowOpacity = 0;
const macTranslucencyValue = 0;

const macFinalSizes = [
  { finalSize: 16, renderSize: 14, names: ["icon_16x16.png"] },
  { finalSize: 32, renderSize: 26, names: ["icon_16x16@2x.png", "icon_32x32.png"] },
  { finalSize: 64, renderSize: 52, names: ["icon_32x32@2x.png"] },
  { finalSize: 128, renderSize: 104, names: ["icon_128x128.png"] },
  { finalSize: 256, renderSize: 206, names: ["icon_128x128@2x.png", "icon_256x256.png"] },
  { finalSize: 512, renderSize: 412, names: ["icon_256x256@2x.png", "icon_512x512.png"] },
  { finalSize: 1024, renderSize: 824, names: ["icon_512x512@2x.png"] },
];

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: appDir,
    stdio: "inherit",
    ...options,
  });
}

function runQuiet(command, args) {
  execFileSync(command, args, {
    cwd: appDir,
    stdio: "ignore",
  });
}

function requireFile(filePath, installHint) {
  if (!existsSync(filePath)) {
    throw new Error(`${filePath} was not found.${installHint ? ` ${installHint}` : ""}`);
  }
}

function renderMacIcon(iconPackagePath, outputPath, size) {
  runQuiet(ictoolPath, [
    iconPackagePath,
    "--export-image",
    "--output-file",
    outputPath,
    "--platform",
    "macOS",
    "--rendition",
    "Default",
    "--width",
    String(size),
    "--height",
    String(size),
    "--scale",
    "1",
    "--light-angle",
    "-45",
  ]);
}

if (!existsSync(sourcePath)) {
  throw new Error(`Missing app icon source: ${sourcePath}`);
}

// Tauri generates the cross-platform set. macOS is replaced below because the
// platform expects a smaller rendered icon with transparent margins.
run(pnpmCommand, ["tauri", "icon", sourcePath]);

if (!isMac) {
  process.exit(0);
}

requireFile(ictoolPath, "Install Xcode with Icon Composer.");
requireFile(iconutilPath);
requireFile(sipsPath);

const tempDir = mkdtempSync(path.join(os.tmpdir(), "local-brain-icon-"));
const iconPackagePath = path.join(tempDir, "LocalBrain.icon");
const iconAssetsPath = path.join(iconPackagePath, "Assets");
const iconSourceName = "app-icon-source.png";
const iconsetPath = path.join(tempDir, "LocalBrain.iconset");
const macIconPath = path.join(tempDir, "icon.icns");

try {
  mkdirSync(iconAssetsPath, { recursive: true });
  mkdirSync(iconsetPath, { recursive: true });
  cpSync(sourcePath, path.join(iconAssetsPath, iconSourceName));

  writeFileSync(
    path.join(iconPackagePath, "icon.json"),
    JSON.stringify(
      {
        fill: {
          "automatic-gradient": macFillGradient,
        },
        groups: [
          {
            layers: [
              {
                "image-name": iconSourceName,
                name: "Local Brain",
              },
            ],
            shadow: {
              kind: "neutral",
              opacity: macShadowOpacity,
            },
            translucency: {
              enabled: true,
              value: macTranslucencyValue,
            },
          },
        ],
        "supported-platforms": {
          circles: ["watchOS"],
          squares: "shared",
        },
      },
      null,
      2,
    ),
  );

  for (const { finalSize, renderSize, names } of macFinalSizes) {
    const renderedPath = path.join(tempDir, `mac-${finalSize}.png`);
    renderMacIcon(iconPackagePath, renderedPath, renderSize);
    runQuiet(sipsPath, ["--padToHeightWidth", String(finalSize), String(finalSize), renderedPath]);

    for (const name of names) {
      cpSync(renderedPath, path.join(iconsetPath, name));
    }

    if (finalSize === 1024) {
      cpSync(renderedPath, processedPath);
    }
  }

  run(iconutilPath, ["--convert", "icns", iconsetPath, "-o", macIconPath]);
  cpSync(macIconPath, tauriIconPath);
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}
