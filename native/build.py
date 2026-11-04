#!/usr/bin/env python3
"""Build the local AppKit client using the installed Apple command-line tools."""

import argparse
import json
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]


def assemble_bundle(bundle, executable, source_root, node, version):
    contents = bundle / "Contents"
    (contents / "MacOS").mkdir(parents=True)
    resources = contents / "Resources"
    resources.mkdir()
    shutil.copy2(executable, contents / "MacOS" / "SecondBrain")
    metadata = {
        "CFBundleName": "Second Brain",
        "CFBundleDisplayName": "Second Brain",
        "CFBundleIdentifier": "io.subdev.secondbrain",
        "CFBundleExecutable": "SecondBrain",
        "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": version,
        "CFBundleVersion": "1",
        "CFBundleIconFile": "SecondBrain",
        "LSMinimumSystemVersion": "14.0",
        "NSHighResolutionCapable": True,
        "NSPrincipalClass": "NSApplication",
        "NSAppTransportSecurity": {"NSAllowsLocalNetworking": True},
    }
    with (contents / "Info.plist").open("wb") as output:
        plistlib.dump(metadata, output)
    (resources / "config.json").write_text(
        json.dumps({"sourceRoot": str(source_root.resolve()), "port": 5173, "node": str(node)}, indent=2) + "\n"
    )


def run(arguments):
    subprocess.run(arguments, check=True, timeout=180, stdout=subprocess.DEVNULL)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-web-build", action="store_true", help="Reuse an already verified dist build")
    options = parser.parse_args()
    node = Path(shutil.which("node") or "")
    if not node.is_file():
        raise RuntimeError("Node.js is required")
    version = json.loads((ROOT / "package.json").read_text())["version"]
    if not options.skip_web_build:
        subprocess.run([shutil.which("npm"), "run", "build"], cwd=ROOT, check=True, timeout=180)
    if not (ROOT / "dist" / "build-info.json").is_file():
        raise RuntimeError("Build the web app first")
    destination = ROOT / "native" / "dist"
    destination.mkdir(exist_ok=True)
    module_cache = ROOT / ".tmp" / "native" / "module-cache"
    module_cache.mkdir(parents=True, exist_ok=True)
    # ponytail: reuse this Mac's Node and project; rebuild after moving either.
    with tempfile.TemporaryDirectory(prefix="secondbrain-native-") as directory:
        temporary = Path(directory)
        executable = temporary / "SecondBrain"
        run([
            "/usr/bin/xcrun", "swiftc", str(ROOT / "native" / "SecondBrain.swift"),
            "-o", str(executable), "-target", "arm64-apple-macos14.0",
            "-module-cache-path", str(module_cache),
            "-framework", "AppKit", "-framework", "WebKit", "-O",
        ])
        bundle = temporary / "Second Brain.app"
        assemble_bundle(bundle, executable, ROOT, node, version)
        icon = temporary / "icon.png"
        run([str(executable), "--render-icon", str(icon)])
        iconset = temporary / "SecondBrain.iconset"
        iconset.mkdir()
        for size in (16, 32, 128, 256, 512):
            for scale in (1, 2):
                suffix = "@2x" if scale == 2 else ""
                run([
                    "/usr/bin/sips", "-z", str(size * scale), str(size * scale),
                    str(icon), "--out", str(iconset / f"icon_{size}x{size}{suffix}.png"),
                ])
        run([
            "/usr/bin/iconutil", "-c", "icns", str(iconset), "-o",
            str(bundle / "Contents" / "Resources" / "SecondBrain.icns"),
        ])
        run(["/usr/bin/codesign", "--force", "--sign", "-", str(bundle)])
        run(["/usr/bin/codesign", "--verify", "--deep", "--strict", str(bundle)])
        output = destination / "Second Brain.app"
        if output.exists():
            shutil.rmtree(output)
        shutil.copytree(bundle, output, copy_function=shutil.copy2)
    run(["/usr/bin/codesign", "--verify", "--deep", "--strict", str(output)])
    print(f"Built {output}")


if __name__ == "__main__":
    main()
