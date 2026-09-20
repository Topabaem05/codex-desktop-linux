// Read only: report the first ordinary window owned by one test process.
#include <CoreGraphics/CoreGraphics.h>
#include <CoreFoundation/CoreFoundation.h>
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <unistd.h>
int main(int argc,char **argv) {
    if(argc!=2)return 2;
    char *end;errno=0;long pid=strtol(argv[1],&end,10);
    if(errno||*end||pid<1||pid>INT_MAX)return 2;
    for(int attempt=0;attempt<600;attempt++) {
        CFArrayRef a=CGWindowListCopyWindowInfo(kCGWindowListOptionAll,kCGNullWindowID);
        if(!a)return 3;
        int found=0;
        for(CFIndex i=0;i<CFArrayGetCount(a);i++) {
            CFDictionaryRef d=CFArrayGetValueAtIndex(a,i);
            CFNumberRef p=CFDictionaryGetValue(d,kCGWindowOwnerPID), l=CFDictionaryGetValue(d,kCGWindowLayer);
            int owner=0,layer=-1;CGRect bounds=CGRectZero;
            if(p)CFNumberGetValue(p,kCFNumberIntType,&owner);
            if(l)CFNumberGetValue(l,kCFNumberIntType,&layer);
            CFDictionaryRef b=CFDictionaryGetValue(d,kCGWindowBounds);
            if(b)CGRectMakeWithDictionaryRepresentation(b,&bounds);
            if(owner==pid&&layer==0&&bounds.size.width>=200&&bounds.size.height>=150){found=1;break;}
        }
        CFRelease(a);
        if(found){puts("window");return 0;}
        struct timespec wait={0,50000000};nanosleep(&wait,NULL);
    }
    return 4;
}
