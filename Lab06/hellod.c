// SPDX-License-Identifier: GPL-2.0
/* Lab 6, item 1: build this module separately on the VM and on the TX2. */
#include <linux/init.h>
#include <linux/kernel.h>
#include <linux/module.h>

static int __init tx2_hello_module_init(void)
{
	pr_info("hellod: Hello, TX2 module is installed !\n");
	return 0;
}

static void __exit tx2_hello_module_cleanup(void)
{
	pr_info("hellod: Good-bye, TX2 module was removed!\n");
}

module_init(tx2_hello_module_init);
module_exit(tx2_hello_module_cleanup);

MODULE_LICENSE("GPL");
MODULE_AUTHOR("Microprocessor Lab06");
MODULE_DESCRIPTION("Lab06 load/unload example for Linux VM and Jetson TX2");
