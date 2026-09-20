// SPDX-License-Identifier: MIT
// Lifetime guardian for an explicitly wrapped stdio MCP. Not a sandbox/reaper.
#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#include "owner-eof.h"

static volatile sig_atomic_t stopping = 0;
static void stop_signal(int sig) { stopping = sig; }
static int64_t millis(void) {
    struct timespec ts;
    if (clock_gettime(CLOCK_MONOTONIC, &ts)) return 0;
    return (int64_t)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}
static int nonblock(int fd) {
    int flags = fcntl(fd, F_GETFL);
    return flags < 0 ? -1 : fcntl(fd, F_SETFL, flags | O_NONBLOCK);
}
static void close_fd(int *fd) { if (*fd >= 0) { close(*fd); *fd = -1; } }
static int status_code(int status) {
    return WIFEXITED(status) ? WEXITSTATUS(status) : WIFSIGNALED(status) ? 128 + WTERMSIG(status) : 125;
}
int main(int argc, char **argv) {
    int grace = 1000, start = 1;
    if (argc == 2 && !strcmp(argv[1], "--version")) {
        puts("codex-mcp-guardian 1 (owned process group; no detached-child guarantee)"); return 0;
    }
    if (argc > 3 && !strcmp(argv[1], "--grace-ms")) {
        char *end = NULL; errno = 0; long n = strtol(argv[2], &end, 10);
        if (errno || !end || *end || n < 100 || n > 10000) return 2;
        grace = (int)n; start = 3;
    }
    if (start + 1 >= argc || strcmp(argv[start], "--")) {
        fputs("usage: mcp-guardian [--grace-ms 100..10000] -- COMMAND [ARGS...]\n", stderr); return 2;
    }
    pid_t owner = getppid();
    if (owner <= 1) { fputs("MCP owner already exited\n", stderr); return 125; }
    // Explicitly preserve child zombies until teardown, even under an unusual
    // inherited SIGCHLD disposition. Never signal a potentially reused PGID.
    struct sigaction action; memset(&action, 0, sizeof(action)); sigemptyset(&action.sa_mask);
    action.sa_handler = SIG_DFL; sigaction(SIGCHLD, &action, NULL);
    action.sa_handler = stop_signal;
    sigaction(SIGTERM, &action, NULL); sigaction(SIGINT, &action, NULL); sigaction(SIGHUP, &action, NULL);
    action.sa_handler = SIG_IGN; sigaction(SIGPIPE, &action, NULL);
    int input[2], ready[2];
    if (pipe(input)) return 125;
    if (pipe(ready)) { close(input[0]); close(input[1]); return 125; }
    pid_t command = fork();
    if (command < 0) return 125;
    if (!command) {
        close(input[1]); close(ready[0]);
        action.sa_handler = SIG_DFL;
        sigaction(SIGTERM, &action, NULL); sigaction(SIGINT, &action, NULL);
        sigaction(SIGHUP, &action, NULL); sigaction(SIGPIPE, &action, NULL);
        // No unrelated process can join this session's group from another session.
        if (setsid() < 0 || dup2(input[0], STDIN_FILENO) < 0) _exit(125);
        close(input[0]);
        char ok = 1;
        if (write(ready[1], &ok, 1) != 1) _exit(125);
        close(ready[1]);
        execvp(argv[start + 1], &argv[start + 1]);
        fputs("Unable to execute configured MCP command\n", stderr); _exit(127);
    }
    close(input[0]); close(ready[1]);
    struct pollfd handshake = {ready[0], POLLIN, 0};
    char ok = 0;
    int received;
    do { received = poll(&handshake, 1, 3000); } while (received < 0 && errno == EINTR && !stopping);
    if (received <= 0 || read(ready[0], &ok, 1) != 1 || ok != 1) {
        close(ready[0]); close(input[1]); kill(command, SIGKILL); waitpid(command, NULL, 0); return 125;
    }
    close(ready[0]);
    int out = input[1];
    if (nonblock(out)) { kill(-command, SIGKILL); waitpid(command, NULL, 0); close(out); return 125; }
    struct owner_eof_watch owner_watch;
    if (owner_eof_open(&owner_watch)) {
        kill(-command, SIGKILL); waitpid(command, NULL, 0); close(out); return 125;
    }
    unsigned char buffer[65536]; size_t offset = 0, used = 0;
    int eof = 0, hangup = 0, phase = 0, reservation = 1;
    int64_t deadline = 0, eof_deadline = 0;
    for (;;) {
        siginfo_t info; memset(&info, 0, sizeof(info));
        int w = waitid(P_PID, (id_t)command, &info, WEXITED | WNOHANG | WNOWAIT);
        if (w < 0 && errno != EINTR) {
            // If some external actor has reaped the leader, do not guess ownership.
            reservation = 0; break;
        }
        int64_t now = millis();
        if (!phase && !hangup) {
            int ended = owner_eof_check(&owner_watch);
            if (ended > 0) { hangup = 1; eof_deadline = now + grace; }
            else if (ended < 0) stopping = SIGTERM;
        }
        if (!phase && (stopping || getppid() != owner || (w == 0 && info.si_pid == command))) {
            close_fd(&out); phase = 1; deadline = now + grace;
        }
        if (!phase && ((eof && !used) || (hangup && now >= eof_deadline))) {
            close_fd(&out); phase = 1; deadline = now + grace;
        }
        if (phase && now >= deadline) {
            if (phase == 1) { kill(-command, SIGTERM); phase = 2; deadline = now + grace; }
            else { kill(-command, SIGKILL); break; }
        }
        struct pollfd fds[2] = {{STDIN_FILENO, 0, 0}, {out, 0, 0}};
        // POLLHUP is delivered even with events=0. Observe owner closure
        // while the child is not reading; never overwrite a pending relay buffer.
        if (!phase && !eof && (!used || !hangup)) {
            if (!used) fds[0].events = POLLIN;
        } else fds[0].fd = -1;
        if (!phase && used && out >= 0) fds[1].events = POLLOUT;
        else fds[1].fd = -1;
        int n = poll(fds, 2, 100);
        if (n < 0 && errno != EINTR) { stopping = SIGTERM; continue; }
        if (n <= 0) continue;
        if ((fds[0].revents & (POLLHUP | POLLERR)) && !hangup) {
            hangup = 1; eof_deadline = millis() + grace;
        }
        if (!used && (fds[0].revents & (POLLIN | POLLHUP | POLLERR))) {
            ssize_t got = read(STDIN_FILENO, buffer, sizeof(buffer));
            if (got > 0) { offset = 0; used = (size_t)got; }
            else if (got == 0 || (errno != EINTR && errno != EAGAIN)) {
                eof = 1; eof_deadline = millis() + grace;
            }
        }
        if (used && out >= 0 && (fds[1].revents & (POLLOUT | POLLHUP | POLLERR))) {
            ssize_t put = write(out, buffer + offset, used);
            if (put > 0) { offset += (size_t)put; used -= (size_t)put; }
            else if (put < 0 && errno != EINTR && errno != EAGAIN) stopping = SIGTERM;
        }
    }
    close_fd(&out);
    owner_eof_close(&owner_watch);
    if (!reservation) return 125;
    int status = 0;
    // The group was signaled while its original leader was still reserved.
    int64_t until = millis() + 1000;
    while (millis() < until) {
        pid_t p = waitpid(command, &status, WNOHANG);
        if (p == command) return status_code(status);
        if (p < 0 && errno != EINTR) return 125;
        struct timespec pause = {0, 10000000}; nanosleep(&pause, NULL);
    }
    return 124; // An uninterruptible kernel wait cannot be guaranteed to exit.
}
