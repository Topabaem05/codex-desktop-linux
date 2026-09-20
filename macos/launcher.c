// SPDX-License-Identifier: MIT
// Finder entrypoint: flags are supplied before the original Electron runtime starts.
#include <errno.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#ifndef COMMUNITY_HEAP_MIB
#define COMMUNITY_HEAP_MIB 512
#endif
#ifndef UPSTREAM_EXECUTABLE
#define UPSTREAM_EXECUTABLE "ChatGPT"
#endif
int main(int argc, char **argv) {
    int safe = getenv("CODEX_COMMUNITY_SAFE_MODE") && !strcmp(getenv("CODEX_COMMUNITY_SAFE_MODE"), "1");
    for (int i=1; i<argc; i++) {
        if (!strcmp(argv[i], "--community-safe-mode")) safe = 1;
        if (!strcmp(argv[i], "--community-launch-plan")) {
            printf("{\"heapMiB\":%d,\"kernelHardLimit\":false,\"profile\":\"all-compatible\"}\n", COMMUNITY_HEAP_MIB);
            return 0;
        }
        if (!strncmp(argv[i], "--js-flags", 10)) {
            fprintf(stderr, "Conflicting --js-flags: use --community-safe-mode for an untuned launch.\n");
            return 2;
        }
    }
    char own[PATH_MAX], resolved[PATH_MAX], target[PATH_MAX], flag[96];
    uint32_t size = sizeof(own);
    if (_NSGetExecutablePath(own, &size) || !realpath(own, resolved)) return 2;
    char *slash = strrchr(resolved, '/');
    if (!slash) return 2;
    *slash = '\0';
    if (snprintf(target, sizeof(target), "%s/%s", resolved, UPSTREAM_EXECUTABLE) >= (int)sizeof(target)) return 2;
    char **args = calloc((size_t)argc + 3, sizeof(char *));
    if (!args) return 2;
    int n=0; args[n++]=target;
    if (!safe) { snprintf(flag,sizeof(flag),"--js-flags=--max-old-space-size=%d",COMMUNITY_HEAP_MIB); args[n++]=flag; }
    if (safe && setenv("CODEX_COMMUNITY_SAFE_MODE","1",1)) { free(args); return 2; }
    for(int i=1;i<argc;i++) if(strcmp(argv[i],"--community-safe-mode")) args[n++]=argv[i];
    args[n]=NULL;
    execv(target,args);
    fprintf(stderr,"Unable to launch bundled runtime: %s\n",strerror(errno));
    free(args);return 127;
}
