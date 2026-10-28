#!/usr/bin/env python3
"""Lab 5 item 4: fixed-baseline alarm, alternating LEDs, continuous 3-shot bursts."""
import argparse
import sys
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path

from light_control import (add_io_arguments, adc_number, install_signal_handlers,
                           log, make_io, nonnegative_int, positive_seconds)


def gstreamer_pipeline(sensor_id=0, capture_width=1280, capture_height=720,
                       display_width=1280, display_height=720, framerate=30,
                       flip_method=0):
    """The seven parameters and defaults specified by Lab5 pages 32-34."""
    return (
        "nvarguscamerasrc sensor-id=%d ! "
        "video/x-raw(memory:NVMM), width=(int)%d, height=(int)%d, "
        "format=(string)NV12, framerate=(fraction)%d/1 ! "
        "nvvidconv flip-method=%d ! "
        "video/x-raw, width=(int)%d, height=(int)%d, format=(string)BGRx ! "
        "videoconvert ! video/x-raw, format=(string)BGR ! "
        "appsink max-buffers=1 drop=true sync=false"
    ) % (sensor_id, capture_width, capture_height, framerate, flip_method,
         display_width, display_height)


class AlarmState:
    """Trigger against previous sample; recover only against frozen pre-event baseline."""
    def __init__(self, threshold):
        self.threshold = threshold
        self.previous = None
        self.baseline = None

    @property
    def active(self):
        return self.baseline is not None

    def update(self, value, initial_burst_done=True):
        previous = self.previous
        delta = 0 if previous is None else abs(value - previous)
        transition = None
        if not self.active and previous is not None and delta > self.threshold:
            self.baseline = previous
            transition = "trigger"
        baseline_delta = None if not self.active else abs(value - self.baseline)
        # Equality keeps the current state, matching the assignment's > and < rules.
        if self.active and baseline_delta < self.threshold and initial_burst_done:
            self.baseline = None
            transition = "reset"
        self.previous = value
        return previous, delta, baseline_delta, transition


class OpenCVCamera:
    suffix = ".jpg"

    def __init__(self, args):
        self.args = args
        self.cap = None
        self.cv2 = None

    def open(self):
        import cv2
        self.cv2 = cv2
        if self.args.camera == "usb":
            self.cap = cv2.VideoCapture(self.args.usb_device, cv2.CAP_V4L2)
        else:
            pipeline_str = gstreamer_pipeline(sensor_id=self.args.sensor_id,
                                             flip_method=self.args.flip_method)
            if self.args.camera == "csi-legacy":
                pipeline_str = pipeline_str.replace(
                    "nvarguscamerasrc sensor-id=%d" % self.args.sensor_id,
                    "nvcamerasrc sensor-id=%d" % self.args.sensor_id)
            log("CAMERA_PIPELINE {}".format(pipeline_str))
            self.cap = cv2.VideoCapture(pipeline_str, cv2.CAP_GSTREAMER)
        if not self.cap.isOpened():
            raise RuntimeError("camera open failed; check gst-inspect, camera connection and OpenCV GStreamer support")
        log("CAMERA_OPEN {}".format(self.args.camera))

    def read(self):
        ok, frame = self.cap.read()
        if not ok or frame is None:
            raise RuntimeError("camera read failed")
        return frame

    def save(self, path, frame):
        if not self.cv2.imwrite(str(path), frame):
            raise RuntimeError("image write failed: {}".format(path))

    def close(self):
        if self.cap is not None:
            self.cap.release()
            self.cap = None
            log("CAMERA_CLOSE")


class SimulatedCamera:
    suffix = ".simulated.txt"

    def open(self):
        log("SIM_CAMERA_OPEN: only text records will be written, no real photos")

    def read(self):
        # A simulated 30 fps camera, preventing a busy loop.
        time.sleep(1.0 / 30)
        return "SIMULATION ONLY - this is not a photograph\n"

    def save(self, path, frame):
        path.write_text(frame, encoding="utf-8")

    def close(self):
        log("SIM_CAMERA_CLOSE")


class CaptureSession:
    """Camera I/O runs separately so acquisition does not block ADC or LED timing.

    Only this thread touches the camera. On recovery stop() waits for release;
    a stuck driver is an error, never a successful reset.
    """
    def __init__(self, camera, output, shot_interval, burst_pause, warmup):
        self.camera = camera
        self.output = Path(output)
        self.shot_interval = shot_interval
        self.burst_pause = burst_pause
        self.warmup = warmup
        self.cancel = threading.Event()
        self.first_burst_done = threading.Event()
        self.failed = threading.Event()
        self.error = None
        self.bursts = 0
        self.photos = 0
        self.directory = None
        self.thread = threading.Thread(target=self._run, name="lab5-camera", daemon=True)

    def start(self):
        self.thread.start()

    def _run(self):
        try:
            now = datetime.now().astimezone()
            self.directory = self.output / now.strftime("%Y-%m-%d") / (
                now.strftime("event_%H%M%S_%f_") + uuid.uuid4().hex[:8])
            self.directory.mkdir(parents=True, exist_ok=False)
            self.camera.open()
            next_shot = time.monotonic() + self.warmup
            shot = 0
            while not self.cancel.is_set():
                frame = self.camera.read()  # Drain live frames between captures.
                now_mono = time.monotonic()
                if self.cancel.is_set() or now_mono < next_shot:
                    continue
                shot += 1
                stamp = datetime.now().astimezone().strftime("%Y%m%d_%H%M%S_%f")
                path = self.directory / ("{}_burst{:04d}_shot{}{}".format(
                    stamp, self.bursts + 1, shot, self.camera.suffix))
                self.camera.save(path, frame)
                self.photos += 1
                log("SNAPSHOT saved={}".format(path))
                if shot == 3:
                    self.bursts += 1
                    shot = 0
                    self.first_burst_done.set()
                    log("BURST_COMPLETE count={} total_shots={}".format(self.bursts, self.photos))
                    next_shot = now_mono + self.burst_pause
                else:
                    next_shot = now_mono + self.shot_interval
        except Exception as error:
            self.error = error
            self.failed.set()
            log("CAMERA_ERROR: {}".format(error))
        finally:
            try:
                self.camera.close()
            except Exception as error:
                self.error = error
                self.failed.set()
                log("CAMERA_CLOSE_ERROR: {}".format(error))

    def check(self):
        if self.failed.is_set():
            raise RuntimeError("capture session failed: {}".format(self.error))

    def stop(self):
        self.cancel.set()
        self.thread.join(timeout=5.0)
        if self.thread.is_alive():
            raise RuntimeError("camera driver did not stop within 5s; reset is unconfirmed")
        self.check()


def run_monitor(args, io, camera_factory=None):
    if camera_factory is None:
        camera_factory = (lambda: OpenCVCamera(args)) if args.hardware else SimulatedCamera
    state = AlarmState(args.change_threshold)
    session = None
    count = 0
    next_sample = time.monotonic()
    next_blink = next_sample
    phase = False
    try:
        while not args.max_samples or count < args.max_samples:
            now = time.monotonic()
            if session is not None:
                session.check()
            if now >= next_sample:
                value = io.read_adc()
                done = session is None or session.first_burst_done.is_set()
                previous, delta, baseline_delta, transition = state.update(value, done)
                log("ADC current={} previous={} delta={} baseline={} baseline_delta={} state={}".format(
                    value, previous, delta, state.baseline, baseline_delta,
                    "ALARM" if state.active else "NORMAL"))
                if transition == "trigger":
                    log("ABNORMAL baseline={} threshold={}".format(state.baseline, args.change_threshold))
                    session = CaptureSession(camera_factory(), args.output, args.shot_interval,
                                             args.burst_pause, args.camera_warmup)
                    session.start()
                    phase = True
                    io.set_leds(True, False)
                    next_blink = now + args.blink_interval
                elif transition == "reset":
                    session.stop()  # Do not announce reset before camera release succeeds.
                    session = None
                    io.set_leds(False, False)
                    log("SYSTEM_RESET: camera closed, both LEDs OFF; monitoring continues")
                count += 1
                next_sample = time.monotonic() + args.interval
            now = time.monotonic()
            if state.active and now >= next_blink:
                phase = not phase
                io.set_leds(phase, not phase)
                log("ALARM_LED LED1={} LED2={}".format("ON" if phase else "OFF", "OFF" if phase else "ON"))
                next_blink = now + args.blink_interval
            if not args.max_samples or count < args.max_samples:
                due = min(next_sample, next_blink) if state.active else next_sample
                time.sleep(max(0, min(0.02, due - time.monotonic())))
    finally:
        try:
            if session is not None:
                session.stop()
        finally:
            io.set_leds(False, False)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Lab5 item 4: intrusion snapshot system")
    add_io_arguments(parser)
    parser.add_argument("--change-threshold", type=adc_number, default=150)
    parser.add_argument("--blink-interval", type=positive_seconds, default=0.25)
    parser.add_argument("--shot-interval", type=positive_seconds, default=0.3)
    parser.add_argument("--burst-pause", type=positive_seconds, default=1.0)
    parser.add_argument("--camera-warmup", type=positive_seconds, default=0.5)
    parser.add_argument("--camera", choices=["csi", "csi-legacy", "usb"], default="csi")
    parser.add_argument("--sensor-id", type=nonnegative_int, default=0)
    parser.add_argument("--flip-method", type=int, choices=range(8), default=0)
    parser.add_argument("--usb-device", type=nonnegative_int, default=0)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parent / "snapshots")
    args = parser.parse_args(argv)
    if args.change_threshold == 0:
        parser.error("change-threshold must be 1..1023")
    install_signal_handlers()
    try:
        with make_io(args) as io:
            run_monitor(args, io)
    except KeyboardInterrupt:
        log("STOP: shutdown requested")
    except Exception as error:
        log("ERROR: {}".format(error))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
