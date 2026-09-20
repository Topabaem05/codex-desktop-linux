// SPDX-License-Identifier: MIT
#ifndef CODEX_COMMUNITY_TUNING_H
#define CODEX_COMMUNITY_TUNING_H
#include <string.h>
static inline int community_ablation(const char *value) {
    if (!value || !*value || !strcmp(value, "none")) return 0;
    if (!strcmp(value, "no-heap")) return 1;
    if (!strcmp(value, "no-observer")) return 2;
    if (!strcmp(value, "upstream-highlight")) return 3;
    return -1;
}
#endif
