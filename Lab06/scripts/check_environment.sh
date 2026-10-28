#!/bin/sh
# Read-only diagnostics; does not install packages, load modules or make nodes.
set -eu
printf 'System: '; uname -a
if [ "$(uname -s)" != Linux ]; then
    echo 'Kernel module build/load requires Ubuntu VM or TX2. Host-only: make userspace host-test'
    exit 1
fi
kernel_dir=${KDIR:-/lib/modules/$(uname -r)/build}
printf 'Kernel build tree: %s\n' "$kernel_dir"
if [ ! -f "$kernel_dir/Makefile" ]; then
    echo 'Missing matching kernel headers/build tree. See README for Ubuntu / TX2 instructions.' >&2
    exit 1
fi
for tool in make cc insmod rmmod lsmod modinfo mknod python3; do
    command -v "$tool" || { printf 'Missing tool: %s\n' "$tool" >&2; exit 1; }
done
built_release=$(make -s --no-print-directory -C "$kernel_dir" kernelrelease)
printf 'Build-tree release: %s\n' "$built_release"
if [ "$built_release" != "$(uname -r)" ]; then
    echo 'Kernel build-tree release does not match the running kernel.' >&2
    exit 1
fi
modules_disabled=$(cat /proc/sys/kernel/modules_disabled)
printf 'modules_disabled: %s\n' "$modules_disabled"
if [ "$modules_disabled" != 0 ]; then
    echo 'This kernel has disabled module loading; use the course Linux environment.' >&2
    exit 1
fi
printf 'Existing demo registration (empty means none):\n'
awk '$2 == "demo" { print }' /proc/devices
echo 'Environment inspection complete; compilation/load are still separate checks.'
