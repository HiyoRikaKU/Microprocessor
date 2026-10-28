#!/usr/bin/env python3
"""Lab 5 items 1/2, plus shared ADC/LED adapters for security_snapshot.py.

Python 3.6+; hardware modules are imported only with --hardware.
All CLI pin numbers use Jetson.GPIO BOARD (physical J21 pins).
"""
import argparse
import math
import signal
import sys
import time
from datetime import datetime


def log(message):
    print("{} {}".format(datetime.now().astimezone().isoformat(timespec="milliseconds"),
                          message), flush=True)


def adc_number(text):
    value = int(text)
    if not 0 <= value <= 1023:
        raise argparse.ArgumentTypeError("ADC must be 0..1023")
    return value


def positive_seconds(text):
    value = float(text)
    if not math.isfinite(value) or value <= 0:
        raise argparse.ArgumentTypeError("seconds must be finite and > 0")
    return value


def nonnegative_int(text):
    value = int(text)
    if value < 0:
        raise argparse.ArgumentTypeError("must be >= 0")
    return value


def spi_frequency(text):
    value = int(text)
    if not 10000 <= value <= 500000:
        raise argparse.ArgumentTypeError("SPI frequency must be 10000..500000 Hz")
    return value


def sample_values(text):
    try:
        values = [adc_number(part.strip()) for part in text.split(",")]
    except (ValueError, argparse.ArgumentTypeError):
        raise argparse.ArgumentTypeError("use comma-separated ADC values, each 0..1023")
    return values


def add_io_arguments(parser):
    parser.add_argument("--hardware", action="store_true", help="use real TX2 GPIO/ADC")
    parser.add_argument("--channel", type=int, choices=range(8), default=0)
    parser.add_argument("--led-pins", type=int, nargs=2, default=[15, 29],
                        metavar=("LED1", "LED2"), help="physical BOARD pins (default 15 29)")
    parser.add_argument("--active-low", action="store_true", help="LEDs light at LOW")
    parser.add_argument("--spi-backend", choices=["spidev", "bitbang"], default="spidev")
    parser.add_argument("--spi-bus", type=nonnegative_int, default=0)
    parser.add_argument("--spi-device", type=nonnegative_int, default=0)
    parser.add_argument("--spi-hz", type=spi_frequency,
                        default=500000, metavar="10000..500000")
    parser.add_argument("--interval", type=positive_seconds, default=0.2,
                        help="ADC sample interval in seconds")
    parser.add_argument("--samples", type=sample_values, default=sample_values("300,310,700,710,300"),
                        help="simulation input sequence; final value is held")
    parser.add_argument("--max-samples", type=nonnegative_int, default=0,
                        help="stop after N samples; 0 means run until Ctrl+C")


def install_signal_handlers():
    def stop(signum, frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)


def decode_adc(rx):
    if len(rx) != 3:
        raise RuntimeError("MCP3008 returned an incomplete SPI response")
    return ((rx[1] & 3) << 8) | rx[2]


def adc_command(channel):
    if not 0 <= channel <= 7:
        raise ValueError("MCP3008 channel must be 0..7")
    return [1, (8 + channel) << 4, 0]


class SimulatedIO:
    def __init__(self, values):
        self.values = values
        self.index = 0
        self.states = (False, False)

    def __enter__(self):
        log("MODE=SIMULATION: ADC is scripted; no physical GPIO is accessed")
        return self

    def read_adc(self):
        value = self.values[min(self.index, len(self.values) - 1)]
        self.index += 1
        return value

    def set_leds(self, first, second):
        states = (bool(first), bool(second))
        if states != self.states:
            log("SIM_LED LED1={} LED2={}".format(*("ON" if x else "OFF" for x in states)))
        self.states = states

    def __exit__(self, *exc):
        self.set_leds(False, False)


class HardwareIO:
    # J21 physical pins, not Linux sysfs GPIO IDs or BCM numbers.
    CLK, MISO, MOSI, CS = 23, 21, 19, 24

    def __init__(self, args):
        self.args = args
        self.gpio = None
        self.spi = None
        self.owned_pins = []

    def __enter__(self):
        pins = self.args.led_pins
        # TX2 pin 16 is input-only; pin 36 depends on the debug-card configuration.
        # Reserve SPI and exclude power/GND and the dedicated I2C/UART pins.
        available = {7, 11, 12, 13, 15, 18, 22, 29, 31, 32, 33, 35, 37, 38, 40}
        if len(set(pins)) != 2 or not set(pins) <= available:
            raise ValueError("choose two distinct GPIO BOARD pins; SPI pins 19/21/23/24 are reserved")
        try:
            import Jetson.GPIO as GPIO
            self.gpio = GPIO
            GPIO.setmode(GPIO.BOARD)
            for pin in pins:
                self.owned_pins.append(pin)
                GPIO.setup(pin, GPIO.OUT, initial=self._level(False))
            if self.args.spi_backend == "spidev":
                import spidev
                self.spi = spidev.SpiDev()
                self.spi.open(self.args.spi_bus, self.args.spi_device)
                self.spi.mode = 0
                self.spi.bits_per_word = 8
                self.spi.max_speed_hz = self.args.spi_hz
            else:
                log("BITBANG: GPIO pinmux must be configured for GPIO; timing needs target validation")
                for pin, mode, initial in [(self.CS, GPIO.OUT, GPIO.HIGH),
                                           (self.CLK, GPIO.OUT, GPIO.LOW),
                                           (self.MOSI, GPIO.OUT, GPIO.LOW),
                                           (self.MISO, GPIO.IN, None)]:
                    self.owned_pins.append(pin)
                    if initial is None:
                        GPIO.setup(pin, mode)
                    else:
                        GPIO.setup(pin, mode, initial=initial)
            log("MODE=HARDWARE backend={} BOARD_LED={}".format(self.args.spi_backend, pins))
            return self
        except BaseException:
            self.close()
            raise

    def _level(self, on):
        return int(bool(on) != self.args.active_low)

    def set_leds(self, first, second):
        for pin, state in zip(self.args.led_pins, (first, second)):
            self.gpio.output(pin, self._level(state))

    def read_adc(self):
        command = adc_command(self.args.channel)
        if self.spi is not None:
            # One transaction: CS remains asserted across all three bytes.
            return decode_adc(self.spi.xfer2(command))
        gpio = self.gpio
        rx = []
        gpio.output(self.CLK, gpio.LOW)
        gpio.output(self.CS, gpio.LOW)
        try:
            for byte in command:
                received = 0
                for shift in range(7, -1, -1):
                    gpio.output(self.MOSI, (byte >> shift) & 1)
                    gpio.output(self.CLK, gpio.HIGH)
                    received = (received << 1) | int(bool(gpio.input(self.MISO)))
                    gpio.output(self.CLK, gpio.LOW)
                rx.append(received)
        finally:
            gpio.output(self.CS, gpio.HIGH)
        return decode_adc(rx)

    def close(self):
        # Attempt every cleanup even if one operation fails. Never hide failures.
        operations = []
        if self.spi is not None:
            operations.append(self.spi.close)
            self.spi = None
        if self.gpio is not None:
            gpio = self.gpio
            for pin in self.args.led_pins:
                if pin in self.owned_pins:
                    operations.append(lambda pin=pin: gpio.output(pin, self._level(False)))
            if self.CS in self.owned_pins:
                operations.append(lambda: gpio.output(self.CS, gpio.HIGH))
            if self.owned_pins:
                operations.append(lambda: gpio.cleanup(self.owned_pins))
        for operation in operations:
            try:
                operation()
            except Exception as error:
                log("CLEANUP_ERROR: {}".format(error))
        self.owned_pins = []
        self.gpio = None

    def __exit__(self, *exc):
        self.close()


def make_io(args):
    return HardwareIO(args) if args.hardware else SimulatedIO(args.samples)


def threshold_state(value, on_threshold, off_threshold, was_on):
    if value >= on_threshold:
        return True
    if value <= off_threshold:
        return False
    return was_on


def main(argv=None):
    parser = argparse.ArgumentParser(description="Lab5 items 1/2: MCP3008 + two LEDs")
    add_io_arguments(parser)
    parser.add_argument("--on-threshold", type=adc_number, default=600)
    parser.add_argument("--off-threshold", type=adc_number, default=450)
    args = parser.parse_args(argv)
    if args.off_threshold > args.on_threshold:
        parser.error("off-threshold must be <= on-threshold")
    install_signal_handlers()
    try:
        with make_io(args) as io:
            on = False
            count = 0
            while not args.max_samples or count < args.max_samples:
                value = io.read_adc()
                on = threshold_state(value, args.on_threshold, args.off_threshold, on)
                io.set_leds(on, on)
                log("ADC={} LED1={} LED2={}".format(value, "ON" if on else "OFF", "ON" if on else "OFF"))
                count += 1
                if not args.max_samples or count < args.max_samples:
                    time.sleep(args.interval)
    except KeyboardInterrupt:
        log("STOP: LEDs off, resources released")
    except Exception as error:
        log("ERROR: {}".format(error))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
