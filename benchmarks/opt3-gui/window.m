// Diagnostic CI account only. No Accessibility privileges or global app matching.
#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(int argc,char **argv) {
 @autoreleasepool {
  if(argc!=3)return 2;
  char *end;errno=0;long value=strtol(argv[2],&end,10);
  if(errno||*end||value<1||value>INT_MAX)return 2;
  NSRunningApplication *app=[NSRunningApplication runningApplicationWithProcessIdentifier:(pid_t)value];
  if(!strcmp(argv[1],"hide")||!strcmp(argv[1],"show")||!strcmp(argv[1],"quit")) {
   BOOL ok=NO;
   if(app)ok=!strcmp(argv[1],"hide")?[app hide]:!strcmp(argv[1],"show")?[app unhide]:[app terminate];
   puts(ok?"{\"accepted\":true}":"{\"accepted\":false}");return 0;
  }
  if(strcmp(argv[1],"windows"))return 2;
  CFArrayRef a=CGWindowListCopyWindowInfo(kCGWindowListOptionAll,kCGNullWindowID);
  if(!a)return 3;
  int ordinary=0,visible=0;
  for(CFIndex i=0;i<CFArrayGetCount(a);i++) {
   CFDictionaryRef d=CFArrayGetValueAtIndex(a,i);
   int owner=0,layer=-1;CGRect rect=CGRectZero;
   CFNumberRef p=CFDictionaryGetValue(d,kCGWindowOwnerPID),l=CFDictionaryGetValue(d,kCGWindowLayer);
   if(p)CFNumberGetValue(p,kCFNumberIntType,&owner);
   if(l)CFNumberGetValue(l,kCFNumberIntType,&layer);
   CFDictionaryRef b=CFDictionaryGetValue(d,kCGWindowBounds);
   if(b)CGRectMakeWithDictionaryRepresentation(b,&rect);
   if(owner==value&&layer==0&&rect.size.width>=200&&rect.size.height>=150){
    ordinary++;CFBooleanRef onscreen=CFDictionaryGetValue(d,kCGWindowIsOnscreen);
    if(onscreen&&CFBooleanGetValue(onscreen))visible++;
   }
  }
  CFRelease(a);
  printf("{\"ordinary\":%d,\"onscreen\":%d,\"hidden\":%s}\n",ordinary,visible,app&&app.hidden?"true":"false");
  return 0;
 }
}
