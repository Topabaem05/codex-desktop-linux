// SPDX-License-Identifier: MIT
// The backend may KILL its direct child. Keep cleanup outside that kill group.
int main(int argc, char **argv) {
    pid_t backend = getppid(), launcher = getpid();
    if (backend <= 1) return 125;
    struct sigaction action;
    memset(&action, 0, sizeof(action)); sigemptyset(&action.sa_mask);
    action.sa_handler = SIG_DFL; sigaction(SIGCHLD, &action, NULL);
    action.sa_handler = stop_signal;
    sigaction(SIGTERM, &action, NULL); sigaction(SIGINT, &action, NULL); sigaction(SIGHUP, &action, NULL);
    pid_t supervisor = fork();
    if (supervisor < 0) return 125;
    if (!supervisor) {
        // Only lifetime isolation: same UID, sandbox and capabilities are retained.
        if (setsid() < 0 || getppid() != launcher) return 125;
        stopping = 0;
        return run_guardian(argc, argv);
    }
    // The supervisor owns protocol I/O; do not retain extra pipe endpoints.
    close(STDIN_FILENO); close(STDOUT_FILENO); close(STDERR_FILENO);
    int sent = 0, status = 0;
    for (;;) {
        pid_t result = waitpid(supervisor, &status, WNOHANG);
        if (result == supervisor) return status_code(status);
        if (result < 0 && errno != EINTR) return 125;
        if (!sent && (stopping || getppid() != backend)) {
            // The unreaped direct child identity is still reserved here.
            kill(supervisor, SIGTERM); sent = 1;
        }
        struct timespec pause = {0, 100000000}; nanosleep(&pause, NULL);
    }
}
