// SPDX-License-Identifier: MIT
// Darwin poll can report unread pipe data without HUP; kqueue retains EV_EOF.
#ifndef CODEX_OWNER_EOF_H
#define CODEX_OWNER_EOF_H
#ifdef __APPLE__
#include <sys/event.h>
#endif
struct owner_eof_watch { int fd; };
static int owner_eof_open(struct owner_eof_watch *watch) {
    watch->fd = -1;
#ifdef __APPLE__
    watch->fd = kqueue();
    if (watch->fd < 0) return -1;
    struct kevent change;
    EV_SET(&change, STDIN_FILENO, EVFILT_READ, EV_ADD, 0, 0, NULL);
    if (kevent(watch->fd, &change, 1, NULL, 0, NULL) < 0) {
        close(watch->fd); watch->fd = -1; return -1;
    }
#endif
    return 0;
}
static int owner_eof_check(const struct owner_eof_watch *watch) {
#ifdef __APPLE__
    struct kevent event;
    const struct timespec zero = {0, 0};
    int n = kevent(watch->fd, NULL, 0, &event, 1, &zero);
    if (n < 0) return errno == EINTR ? 0 : -1;
    if (!n) return 0;
    if (event.flags & EV_ERROR) return -1;
    return (event.flags & EV_EOF) != 0;
#else
    (void)watch;
    return 0; // Linux POLLHUP handles this in the main relay loop.
#endif
}
static void owner_eof_close(struct owner_eof_watch *watch) {
    if (watch->fd >= 0) close(watch->fd);
    watch->fd = -1;
}
#endif
