ifneq ($(KERNELRELEASE),)
obj-m := hellod.o demo.o
else
KDIR ?= /lib/modules/$(shell uname -r)/build
CC ?= cc
CFLAGS ?= -O2 -Wall -Wextra -Wpedantic
MODULE_DIR := $(CURDIR)

.PHONY: all modules hello char userspace check-kernel clean host-test kernel-test
all: modules userspace

check-kernel:
	@test "$$(uname -s)" = Linux || { echo "Linux kernel modules must be built in Ubuntu VM / TX2. On macOS use: make userspace host-test" >&2; exit 1; }
	@test -f "$(KDIR)/Makefile" || { echo "Missing kernel build tree: $(KDIR). See README for matching headers / KDIR." >&2; exit 1; }

modules: check-kernel
	$(MAKE) -C "$(KDIR)" M="$(MODULE_DIR)" modules

# Build only the requested item, useful for item 1 on TX2.
hello: check-kernel
	$(MAKE) -C "$(KDIR)" M="$(MODULE_DIR)" hellod.ko

char: check-kernel
	$(MAKE) -C "$(KDIR)" M="$(MODULE_DIR)" demo.ko

userspace: test.o

# Despite its suffix, test.o is a linked user-space executable, as in Lecture6.
test.o: test.c
	$(CC) $(CPPFLAGS) $(CFLAGS) -std=c99 -o $@ $< $(LDFLAGS)

host-test: userspace
	python3 tests/test_host.py

# Run after insmod + mknod, usually as sudo make kernel-test.
kernel-test:
	python3 tests/test_kernel.py

clean:
	rm -f test.o *.o *.ko *.mod *.mod.c *.symvers modules.order Module.symvers .*.cmd .*.d
	rm -rf .tmp_versions
endif
