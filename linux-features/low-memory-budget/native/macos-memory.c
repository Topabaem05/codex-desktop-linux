// SPDX-License-Identifier: MIT
// Read-only macOS observer. No task_for_pid entitlement, limit setting or signals.
#include <dispatch/dispatch.h>
#include <errno.h>
#include <inttypes.h>
#include <libproc.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/proc_info.h>
#include <sys/resource.h>
#include <unistd.h>

typedef struct { struct proc_bsdinfo info; int selected; } record;
static int compare(const void *a, const void *b) {
    const record *x = a, *y = b;
    return (x->info.pbi_pid > y->info.pbi_pid) - (x->info.pbi_pid < y->info.pbi_pid);
}
static record *lookup(record *rows, size_t count, uint32_t pid) {
    record key = {0}; key.info.pbi_pid = pid;
    return bsearch(&key, rows, count, sizeof(record), compare);
}
static int same(const struct proc_bsdinfo *a, const struct proc_bsdinfo *b) {
    return a->pbi_pid == b->pbi_pid && a->pbi_uid == b->pbi_uid &&
        a->pbi_start_tvsec == b->pbi_start_tvsec && a->pbi_start_tvusec == b->pbi_start_tvusec;
}
static void identity(const struct proc_bsdinfo *b) {
    printf("\"pid\":%u,\"ppid\":%u,\"uid\":%u,\"startId\":\"%" PRIu64 ":%" PRIu64 "\"",
        b->pbi_pid, b->pbi_ppid, b->pbi_uid, b->pbi_start_tvsec, b->pbi_start_tvusec);
}
static int take_snapshot(pid_t root_pid) {
    struct proc_bsdinfo original = {0}, final = {0};
    if (proc_pidinfo(root_pid, PROC_PIDTBSDINFO, 0, &original, sizeof(original)) != (int)sizeof(original) || original.pbi_uid != getuid()) {
        fprintf(stderr, "Root missing or not owned by this user\n"); return 3;
    }
    int estimate = proc_listallpids(NULL, 0);
    if (estimate <= 0 || estimate > 131072) return 3;
    int capacity = estimate + 256;
    pid_t *pids = calloc((size_t)capacity, sizeof(pid_t));
    record *rows = calloc((size_t)capacity, sizeof(record));
    if (!pids || !rows) { free(pids); free(rows); return 3; }
    int count = proc_listallpids(pids, capacity * (int)sizeof(pid_t));
    if (count <= 0 || count >= capacity) { free(pids); free(rows); return 3; }
    size_t used = 0;
    for (int i = 0; i < count; i++) {
        struct proc_bsdinfo b = {0};
        if (pids[i] > 0 && proc_pidinfo(pids[i], PROC_PIDTBSDINFO, 0, &b, sizeof(b)) == (int)sizeof(b) && b.pbi_uid == getuid()) rows[used++].info = b;
    }
    free(pids);
    qsort(rows, used, sizeof(record), compare);
    record *root = lookup(rows, used, (uint32_t)root_pid);
    if (!root || !same(&original, &root->info)) { free(rows); return 3; }
    root->selected = 1;
    int changed;
    do {
        changed = 0;
        for (size_t i = 0; i < used; i++) {
            if (rows[i].selected) continue;
            record *parent = lookup(rows, used, rows[i].info.pbi_ppid);
            if (parent && parent->selected) { rows[i].selected = 1; changed = 1; }
        }
    } while (changed);
    printf("{\"root\":{"); identity(&original); printf("},\"processes\":[");
    int first = 1;
    for (size_t i = 0; i < used; i++) {
        if (!rows[i].selected) continue;
        struct rusage_info_v2 usage = {0}; struct proc_bsdinfo after = {0};
        int ok = proc_pid_rusage((pid_t)rows[i].info.pbi_pid, RUSAGE_INFO_V2, (rusage_info_t *)&usage) == 0 &&
            proc_pidinfo((pid_t)rows[i].info.pbi_pid, PROC_PIDTBSDINFO, 0, &after, sizeof(after)) == (int)sizeof(after) && same(&rows[i].info, &after);
        if (!first) printf(",");
        first = 0; printf("{"); identity(&rows[i].info);
        if (ok) printf(",\"rssBytes\":%" PRIu64 ",\"footprintBytes\":%" PRIu64 "}", usage.ri_resident_size, usage.ri_phys_footprint);
        else printf(",\"rssBytes\":null,\"footprintBytes\":null}");
    }
    printf("]}\n"); free(rows);
    // A nonzero exit invalidates the whole output when the root races with exit/reuse.
    return proc_pidinfo(root_pid, PROC_PIDTBSDINFO, 0, &final, sizeof(final)) == (int)sizeof(final) && same(&original, &final) ? 0 : 3;
}
static int watch_pressure(void) {
    dispatch_source_t source = dispatch_source_create(DISPATCH_SOURCE_TYPE_MEMORYPRESSURE, 0,
        DISPATCH_MEMORYPRESSURE_NORMAL | DISPATCH_MEMORYPRESSURE_WARN | DISPATCH_MEMORYPRESSURE_CRITICAL, dispatch_get_main_queue());
    if (!source) return 3;
    dispatch_source_set_event_handler(source, ^{
        unsigned long flags = dispatch_source_get_data(source);
        const char *state = (flags & DISPATCH_MEMORYPRESSURE_CRITICAL) ? "critical" :
            (flags & DISPATCH_MEMORYPRESSURE_WARN) ? "warning" : "normal";
        printf("{\"pressure\":\"%s\"}\n", state);
    });
    // Dispatch reports changes, so absence of an event does not mean normal pressure.
    printf("{\"pressure\":\"unknown\"}\n");
    dispatch_resume(source); dispatch_main();
    return 0;
}
int main(int argc, char **argv) {
    setvbuf(stdout, NULL, _IOLBF, 0);
    if (argc != 2) { fprintf(stderr, "usage: macos-memory PID | --pressure\n"); return 2; }
    if (!strcmp(argv[1], "--pressure")) return watch_pressure();
    char *end = NULL; errno = 0; long value = strtol(argv[1], &end, 10);
    if (errno || !end || *end || value < 1 || value > INT_MAX) return 2;
    return take_snapshot((pid_t)value);
}
