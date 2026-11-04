import importlib.util
import json
import plistlib
from pathlib import Path
import tempfile
import unittest


class NativeBuildTests(unittest.TestCase):
    def test_bundle_opens_the_existing_project_without_copying_its_data(self):
        builder_path = Path(__file__).resolve().parents[2] / "app" / "native" / "build.py"
        self.assertTrue(builder_path.is_file(), "The native app builder must exist")
        spec = importlib.util.spec_from_file_location("native_build", builder_path)
        builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(builder)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "project with spaces"
            source.mkdir()
            (source / "data").mkdir()
            (source / "data" / "private-video.mp4").write_bytes(b"private media")
            executable = root / "compiled-app"
            executable.write_bytes(b"native executable")
            executable.chmod(0o755)
            bundle = root / "Second Brain.app"

            builder.assemble_bundle(bundle, executable, source, Path("/opt/homebrew/bin/node"), "0.1.0")

            contents = bundle / "Contents"
            metadata = plistlib.loads((contents / "Info.plist").read_bytes())
            self.assertEqual(metadata["CFBundleIdentifier"], "io.subdev.secondbrain")
            self.assertEqual(metadata["CFBundleShortVersionString"], "0.1.0")
            self.assertEqual(metadata["CFBundlePackageType"], "APPL")
            self.assertEqual(metadata["CFBundleExecutable"], "SecondBrain")
            self.assertEqual(
                metadata["NSAppTransportSecurity"], {"NSAllowsLocalNetworking": True}
            )
            self.assertFalse(metadata.get("LSUIElement", False))
            self.assertTrue((contents / "MacOS" / "SecondBrain").stat().st_mode & 0o111)
            config = json.loads((contents / "Resources" / "config.json").read_text())
            self.assertEqual(config, {"sourceRoot": str(source.resolve()), "port": 5173, "node": "/opt/homebrew/bin/node"})
            resources = sorted(path.name for path in (contents / "Resources").iterdir())
            self.assertEqual(resources, ["config.json"])


if __name__ == "__main__":
    unittest.main()
