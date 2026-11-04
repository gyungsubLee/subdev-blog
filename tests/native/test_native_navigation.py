import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class NativeNavigationTests(unittest.TestCase):
    def test_retry_stays_in_app_and_restarts_failed_oauth_callbacks(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            main = folder / "main.swift"
            main.write_text((ROOT / "app" / "native" / "SecondBrain.swift").read_text() + '''
import Foundation
let config = Configuration(sourceRoot: "/tmp/project", port: 5173, node: "/usr/bin/node")
let cases: [(String?, String)] = [
  (nil, "http://127.0.0.1:5173/"),
  ("http://127.0.0.1:5173/#/records", "http://127.0.0.1:5173/#/records"),
  ("http://127.0.0.1:5173/api/auth/github", "http://127.0.0.1:5173/api/auth/github"),
  ("http://127.0.0.1:5173/api/auth/callback?code=used&state=old", "http://127.0.0.1:5173/api/auth/github"),
  ("https://github.com/sessions/two-factor", "http://127.0.0.1:5173/"),
  ("https://github.com/login", "http://127.0.0.1:5173/"),
  ("https://github.com.evil.example/login", "http://127.0.0.1:5173/"),
  ("http://127.0.0.1:5174/", "http://127.0.0.1:5173/"),
  ("file:///tmp/secret", "http://127.0.0.1:5173/"),
]
for (index, item) in cases.enumerated() {
  let (input, expected) = item
  let actual = config.recoveryURL(for: input.flatMap(URL.init(string:)))
  precondition(actual.absoluteString == expected, "Recovery case \\(index) failed")
}
print("9 navigation recovery cases passed")
''')
            executable = folder / "navigation-check"
            compile_result = subprocess.run(
                ["/usr/bin/xcrun", "swiftc", "-D", "NATIVE_TESTS",
                 str(main),
                 "-o", str(executable), "-module-cache-path",
                 str(ROOT / ".tmp" / "app" / "native" / "module-cache"),
                 "-framework", "AppKit", "-framework", "WebKit"],
                capture_output=True, text=True, timeout=180,
            )
            self.assertEqual(compile_result.returncode, 0, compile_result.stderr[-3000:])
            result = subprocess.run([str(executable)], capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr[-1000:])
            self.assertIn("9 navigation recovery cases passed", result.stdout)


if __name__ == "__main__":
    unittest.main()
