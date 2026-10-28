// SPDX-License-Identifier: GPL-2.0
/*
 * Lab 6, item 2: /dev/demo is a memory-backed character device, not a GPIO.
 * Each nonempty write replaces the message and resets that file's read offset.
 * The message and iCount survive close/open, and reset when the module reloads.
 */
#include <linux/atomic.h>
#include <linux/errno.h>
#include <linux/fs.h>
#include <linux/init.h>
#include <linux/kernel.h>
#include <linux/module.h>
#include <linux/mutex.h>
#include <linux/slab.h>
#include <linux/string.h>
#include <linux/uaccess.h>

#define DEVICE_NAME "demo"
#define MESSAGE_CAPACITY 1024

/* Keep the lecture's major 60; major=0 requests a dynamically allocated one. */
static unsigned int major = 60;
module_param(major, uint, 0444);
MODULE_PARM_DESC(major, "Character-device major (default 60; 0 = dynamic)");

static atomic_t device_opened = ATOMIC_INIT(0);
static DEFINE_MUTEX(message_lock);
static char userChar[MESSAGE_CAPACITY];
static size_t message_length;
static unsigned long iCount;

static int drv_open(struct inode *inode, struct file *file)
{
	int ret;

	/* register_chrdev reserves minors 0..255, but this lab exposes only 0. */
	if (iminor(inode) != 0)
		return -ENODEV;
	if (atomic_cmpxchg(&device_opened, 0, 1) != 0)
		return -EBUSY;
	ret = nonseekable_open(inode, file);
	if (ret) {
		atomic_set(&device_opened, 0);
		return ret;
	}
	pr_info("demo: device open\n");
	return 0;
}

static int drv_release(struct inode *inode, struct file *file)
{
	pr_info("demo: device close\n");
	atomic_set(&device_opened, 0);
	return 0;
}

static ssize_t drv_read(struct file *file, char __user *buf, size_t count,
			loff_t *ppos)
{
	ssize_t ret;

	if (mutex_lock_interruptible(&message_lock))
		return -ERESTARTSYS;
	/* Copies into user space, advances *ppos, and returns 0 at EOF. */
	ret = simple_read_from_buffer(buf, count, ppos, userChar, message_length);
	mutex_unlock(&message_lock);
	pr_info("demo: device read result=%zd\n", ret);
	return ret;
}

static ssize_t drv_write(struct file *file, const char __user *buf,
			size_t count, loff_t *ppos)
{
	char *incoming;

	if (!count)
		return 0;
	if (count > MESSAGE_CAPACITY)
		return -EMSGSIZE;
	incoming = kmalloc(count, GFP_KERNEL);
	if (!incoming)
		return -ENOMEM;
	/* Never dereference a user pointer, or publish a partially copied write. */
	if (copy_from_user(incoming, buf, count)) {
		kfree(incoming);
		return -EFAULT;
	}
	if (mutex_lock_interruptible(&message_lock)) {
		kfree(incoming);
		return -ERESTARTSYS;
	}
	memcpy(userChar, incoming, count);
	message_length = count;
	*ppos = 0;
	pr_info("demo: device write iCount=%lu bytes=%zu\n", iCount, count);
	/* Length bounded: a message need not have a terminating NUL byte. */
	pr_info("demo: buf: %.*s\n", (int)count, userChar);
	iCount++;
	mutex_unlock(&message_lock);
	kfree(incoming);
	return count;
}

static long drv_ioctl(struct file *file, unsigned int cmd, unsigned long arg)
{
	/* The lab's user program uses read/write; no private ioctl ABI is needed. */
	pr_info("demo: device ioctl unsupported cmd=%u\n", cmd);
	return -ENOTTY;
}

static const struct file_operations drv_fops = {
	.owner = THIS_MODULE,
	.open = drv_open,
	.release = drv_release,
	.read = drv_read,
	.write = drv_write,
	.unlocked_ioctl = drv_ioctl,
	/* nonseekable_open rejects seeking, without the removed no_llseek API. */
};

static int __init demo_init(void)
{
	int ret = register_chrdev(major, DEVICE_NAME, &drv_fops);

	if (ret < 0) {
		pr_err("demo: cannot register major %u: %d\n", major, ret);
		return ret;
	}
	if (!major)
		major = ret;
	pr_info("demo: started major=%u minor=0 capacity=%d\n",
		major, MESSAGE_CAPACITY);
	return 0;
}

static void __exit demo_exit(void)
{
	unregister_chrdev(major, DEVICE_NAME);
	pr_info("demo: removed writes=%lu\n", iCount);
}

module_init(demo_init);
module_exit(demo_exit);

MODULE_LICENSE("GPL");
MODULE_AUTHOR("Microprocessor Lab06");
MODULE_DESCRIPTION("Lab06 bounded read/write character device");
