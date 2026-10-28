#!/usr/bin/env python3
"""Integration tests against the loaded demo.ko. Requires Linux and /dev/demo.

This deliberately changes the lab device's message, but never loads/unloads a
module or creates a device node. Works with Python 3.6+ and the standard library.
"""
import contextlib
import ctypes
import errno
import fcntl
import os
import pathlib
import platform
import stat
import sys
import unittest

DEVICE = "/dev/demo"
CAPACITY = 1024


@contextlib.contextmanager
def opened():
    fd = os.open(DEVICE, os.O_RDWR)
    try:
        yield fd
    finally:
        os.close(fd)


class DriverChecks(unittest.TestCase):
    def expect_errno(self, expected, function, *args):
        with self.assertRaises(OSError) as error:
            function(*args)
        self.assertEqual(error.exception.errno, expected)

    def test_chunked_read_and_eof(self):
        message = "Lab6 字元裝置 readback".encode("utf-8")
        with opened() as fd:
            self.assertEqual(os.write(fd, message), len(message))
            chunks = []
            for _ in range(len(message) + 1):
                chunk = os.read(fd, 3)
                if not chunk:
                    break
                chunks.append(chunk)
            else:
                self.fail("read never reached EOF")
            self.assertEqual(b"".join(chunks), message)
            self.assertEqual(os.read(fd, 1), b"")

    def test_exact_capacity_and_binary_data(self):
        message = bytes(range(256)) * 4
        with opened() as fd:
            self.assertEqual(os.write(fd, message), CAPACITY)
            self.assertEqual(os.read(fd, CAPACITY + 1), message)
            self.assertEqual(os.read(fd, 1), b"")

    def test_oversized_write_preserves_message(self):
        with opened() as fd:
            os.write(fd, b"keep")
            self.expect_errno(errno.EMSGSIZE, os.write, fd, b"X" * (CAPACITY + 1))
            self.assertEqual(os.read(fd, 20), b"keep")

    def test_zero_length_does_not_erase_or_advance(self):
        with opened() as fd:
            os.write(fd, b"keep")
            self.assertEqual(os.write(fd, b""), 0)
            self.assertEqual(os.read(fd, 0), b"")
            self.assertEqual(os.read(fd, 20), b"keep")

    def test_write_after_eof_replaces_and_rewinds(self):
        with opened() as fd:
            os.write(fd, b"long initial message")
            os.read(fd, CAPACITY)
            self.assertEqual(os.read(fd, 1), b"")
            os.write(fd, b"new")
            self.assertEqual(os.read(fd, CAPACITY), b"new")
            self.assertEqual(os.read(fd, 1), b"")

    def test_close_open_preserves_message(self):
        with opened() as fd:
            os.write(fd, b"persists across open")
        with opened() as fd:
            self.assertEqual(os.read(fd, CAPACITY), b"persists across open")

    def test_second_open_is_busy_and_close_releases(self):
        with opened():
            # Close an unexpected successful second open before reporting failure.
            try:
                second = os.open(DEVICE, os.O_RDWR)
            except OSError as error:
                self.assertEqual(error.errno, errno.EBUSY)
            else:
                os.close(second)
                self.fail("second open should return EBUSY")
        with opened() as fd:
            self.assertGreaterEqual(fd, 0)

    def test_unknown_ioctl_and_seek(self):
        with opened() as fd:
            self.expect_errno(errno.ENOTTY, fcntl.ioctl, fd, 0x1234, 0)
            self.expect_errno(errno.ESPIPE, os.lseek, fd, 0, os.SEEK_SET)

    def test_bad_user_write_returns_efault_and_preserves_message(self):
        libc = ctypes.CDLL(None, use_errno=True)
        libc.write.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_size_t]
        libc.write.restype = ctypes.c_ssize_t
        with opened() as fd:
            os.write(fd, b"keep after EFAULT")
            ctypes.set_errno(0)
            self.assertEqual(libc.write(fd, None, 8), -1)
            self.assertEqual(ctypes.get_errno(), errno.EFAULT)
            self.assertEqual(os.read(fd, CAPACITY), b"keep after EFAULT")

    def test_bad_user_read_returns_efault_without_advancing(self):
        libc = ctypes.CDLL(None, use_errno=True)
        libc.read.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_size_t]
        libc.read.restype = ctypes.c_ssize_t
        with opened() as fd:
            os.write(fd, b"read after EFAULT")
            ctypes.set_errno(0)
            self.assertEqual(libc.read(fd, None, 8), -1)
            self.assertEqual(ctypes.get_errno(), errno.EFAULT)
            self.assertEqual(os.read(fd, CAPACITY), b"read after EFAULT")


def check_environment():
    if platform.system() != "Linux":
        sys.exit("NOT RUN: requires Linux VM with demo.ko loaded; no simulation performed.")
    try:
        major = int(pathlib.Path("/sys/module/demo/parameters/major").read_text())
        st = os.stat(DEVICE, follow_symlinks=False)
        registered = "{} demo".format(major)
        entries = [" ".join(line.split()) for line in
                   pathlib.Path("/proc/devices").read_text().splitlines()]
        if not (stat.S_ISCHR(st.st_mode) and os.major(st.st_rdev) == major
                and os.minor(st.st_rdev) == 0 and registered in entries):
            raise ValueError("/dev/demo does not match the loaded driver")
    except (OSError, ValueError) as error:
        sys.exit("NOT RUN: {}. Follow README: insmod + mknod first.".format(error))


if __name__ == "__main__":
    check_environment()
    unittest.main(verbosity=2)
