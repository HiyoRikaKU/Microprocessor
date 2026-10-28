/* Lab 6 user-space client. The lecture calls the executable test.o. */
#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#define MESSAGE_CAPACITY 1024

int main(int argc, char **argv)
{
	const char *path = argc > 1 ? argv[1] : "/dev/demo";
	const char *message = argc > 2 ? argv[2] : "Data Input 123456 hello world";
	unsigned char received[MESSAGE_CAPACITY + 1];
	struct stat st;
	size_t length = strlen(message), total = 0;
	ssize_t result;
	int fd, status = EXIT_FAILURE;

	if (argc > 3 || (argc > 1 && strcmp(argv[1], "--help") == 0)) {
		fprintf(argc > 3 ? stderr : stdout,
			"Usage: %s [device [message]]\n", argv[0]);
		return argc > 3 ? EXIT_FAILURE : EXIT_SUCCESS;
	}
	if (!length || length > MESSAGE_CAPACITY) {
		fprintf(stderr, "Message must contain 1..%d bytes.\n", MESSAGE_CAPACITY);
		return EXIT_FAILURE;
	}
	fd = open(path, O_RDWR);
	if (fd == -1) {
		perror(path);
		return EXIT_FAILURE;
	}
	if (fstat(fd, &st) == -1) {
		perror("fstat");
		goto done;
	}
	if (!S_ISCHR(st.st_mode)) {
		fprintf(stderr, "%s is not a character device.\n", path);
		goto done;
	}
	do {
		result = write(fd, message, length);
	} while (result == -1 && errno == EINTR);
	if (result == -1) {
		perror("write");
		goto done;
	}
	if ((size_t)result != length) {
		fprintf(stderr, "Short write: %zd/%zu bytes.\n", result, length);
		goto done;
	}
	printf("WRITE %zd bytes: %s\n", result, message);
	while (total < sizeof(received)) {
		result = read(fd, received + total, sizeof(received) - total);
		if (result == -1 && errno == EINTR)
			continue;
		if (result == -1) {
			perror("read");
			goto done;
		}
		if (result == 0)
			break;
		total += (size_t)result;
	}
	printf("READ  %zu bytes: ", total);
	fwrite(received, 1, total, stdout);
	putchar('\n');
	if (total != length || memcmp(received, message, length) != 0) {
		fprintf(stderr, "FAIL: readback differs from the written message.\n");
		goto done;
	}
	puts("PASS: readback matches; end of file reached.");
	status = EXIT_SUCCESS;
done:
	if (close(fd) == -1) {
		perror("close");
		status = EXIT_FAILURE;
	}
	return status;
}
