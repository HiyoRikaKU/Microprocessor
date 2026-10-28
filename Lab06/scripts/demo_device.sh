#!/bin/sh
# Explicit VM operations: sh scripts/demo_device.sh load [major] / unload.
set -eu
if [ "$(uname -s)" != Linux ] || [ "$(id -u)" -ne 0 ]; then
    echo 'Run on the Linux VM as root: sudo sh scripts/demo_device.sh load [major] | unload' >&2
    exit 1
fi
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
device=/dev/demo
case "${1:-}" in
    load)
        [ "$#" -le 2 ] || { echo 'Usage: load [major]' >&2; exit 1; }
        major_arg=${2:-60}
        case "$major_arg" in ''|*[!0-9]*) echo 'major must be a nonnegative integer' >&2; exit 1;; esac
        if [ -e /sys/module/demo ]; then
            echo 'demo is already loaded; unload it explicitly first.' >&2
            exit 1
        fi
        if [ -e "$device" ] || [ -L "$device" ]; then
            echo '/dev/demo already exists. Inspect its owner/type/major; this helper will not replace it.' >&2
            exit 1
        fi
        owned_module=0
        owned_node=0
        rollback() {
            if [ "$owned_node" -eq 1 ]; then rm -f -- "$device"; fi
            if [ "$owned_module" -eq 1 ]; then rmmod demo; fi
        }
        trap rollback EXIT
        trap 'exit 130' INT
        trap 'exit 143' TERM
        insmod "$project_dir/demo.ko" major="$major_arg"
        owned_module=1
        actual_major=$(cat /sys/module/demo/parameters/major)
        mknod -m 600 "$device" c "$actual_major" 0
        owned_node=1
        ls -l "$device"
        echo "demo loaded: major=$actual_major minor=0; device permissions are root-only."
        owned_module=0
        owned_node=0
        trap - EXIT INT TERM
        ;;
    unload)
        [ "$#" -eq 1 ] || { echo 'Usage: unload' >&2; exit 1; }
        actual_major=$(cat /sys/module/demo/parameters/major)
        # Only remove a real char node with the same major/minor; refuse symlinks.
        remove_node=0
        if [ -c "$device" ] && [ ! -L "$device" ]; then
            actual_hex=$(stat -c '%t:%T' "$device")
            expected_hex=$(printf '%x:0' "$actual_major")
            if [ "$actual_hex" = "$expected_hex" ]; then remove_node=1; fi
        fi
        rmmod demo
        if [ "$remove_node" -eq 1 ]; then
            rm -- "$device"
        elif [ -e "$device" ] || [ -L "$device" ]; then
            echo 'Module unloaded; unmatched /dev/demo was left for manual inspection.'
        fi
        echo 'demo unloaded.'
        ;;
    *) echo 'Usage: sudo sh scripts/demo_device.sh load [major] | unload' >&2; exit 1;;
esac
