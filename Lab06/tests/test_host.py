#!/usr/bin/env python3
"""Host checks for the real C client; these do not emulate a Linux module."""
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class ClientChecks(unittest.TestCase):
    def run_client(self, *args):
        return subprocess.run([str(ROOT / "test.o")] + list(args),
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              universal_newlines=True, timeout=5)

    def test_help(self):
        result = self.run_client("--help")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Usage:", result.stdout)

    def test_argument_count(self):
        result = self.run_client("one", "two", "three")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Usage:", result.stderr)

    def test_missing_device_does_not_create_file(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / "absent"
            result = self.run_client(str(path))
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(path.exists())

    def test_regular_file_is_not_modified(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / "sample"
            path.write_bytes(b"keep this data")
            result = self.run_client(str(path))
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("not a character device", result.stderr)
            self.assertEqual(path.read_bytes(), b"keep this data")

    def test_empty_message(self):
        result = self.run_client("/dev/demo", "")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("1..1024 bytes", result.stderr)

    def test_long_message(self):
        result = self.run_client("/dev/demo", "a" * 1025)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("1..1024 bytes", result.stderr)

    def test_character_device_with_no_readback_fails(self):
        # /dev/null is a real character device, but cannot echo a message.
        result = self.run_client("/dev/null", "check")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("readback differs", result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
