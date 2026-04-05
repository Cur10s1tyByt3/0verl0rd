/*
 * Sample C Plugin — fully unloadable, no runtime baggage.
 *
 * Exports the standard Overlord plugin ABI:
 *   PluginOnLoad, PluginOnEvent, PluginOnUnload, PluginSetCallback,
 *   PluginGetRuntime  (returns "c" — tells the host this DLL can be freed)
 *
 * Build (Windows):
 *   cl /LD /O2 plugin.c /Fe:sample-c-windows-amd64.dll
 *   — or with MinGW —
 *   x86_64-w64-mingw32-gcc -shared -O2 -o sample-c-windows-amd64.dll plugin.c
 *
 * Build (Linux):
 *   gcc -shared -fPIC -O2 -o sample-c-linux-amd64.so plugin.c
 */

#include <stdint.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>

/* ------------------------------------------------------------------ */
/* Platform helpers                                                    */
/* ------------------------------------------------------------------ */

#ifdef _WIN32
#  define EXPORT __declspec(dllexport)
#  define WIN32_LEAN_AND_MEAN
#  include <windows.h>
   BOOL WINAPI DllMain(HINSTANCE hDll, DWORD reason, LPVOID reserved) {
       (void)hDll; (void)reserved;
       switch (reason) {
       case DLL_PROCESS_ATTACH: break;
       case DLL_PROCESS_DETACH: break;
       }
       return TRUE;
   }
#else
#  define EXPORT __attribute__((visibility("default")))
#endif

/* ------------------------------------------------------------------ */
/* Host callback                                                       */
/* ------------------------------------------------------------------ */

#ifdef _WIN32
/* Windows: callback is void(__stdcall*)(ptr,len,ptr,len) */
typedef void (__stdcall *host_callback_t)(
    const char *event, uintptr_t eventLen,
    const char *payload, uintptr_t payloadLen);
#else
/* Unix: callback is void(*)(ctx, event, eventLen, payload, payloadLen) */
typedef void (*host_callback_t)(
    uintptr_t ctx,
    const char *event, int eventLen,
    const char *payload, int payloadLen);
#endif

static host_callback_t g_callback = NULL;
#ifndef _WIN32
static uintptr_t       g_callback_ctx = 0;
#endif

static void send_event(const char *event, const char *payload) {
    if (!g_callback) return;
    int elen = event   ? (int)strlen(event)   : 0;
    int plen = payload ? (int)strlen(payload)  : 0;
#ifdef _WIN32
    g_callback(event, (uintptr_t)elen, payload, (uintptr_t)plen);
#else
    g_callback(g_callback_ctx, event, elen, payload, plen);
#endif
}

/* ------------------------------------------------------------------ */
/* Plugin state (trivial example)                                      */
/* ------------------------------------------------------------------ */

static char g_client_id[256];

/* ------------------------------------------------------------------ */
/* Exported ABI                                                        */
/* ------------------------------------------------------------------ */

EXPORT const char *PluginGetRuntime(void) {
    return "c";
}

#ifdef _WIN32
EXPORT void PluginSetCallback(uint64_t cb) {
    g_callback = (host_callback_t)(uintptr_t)cb;
}

EXPORT int PluginOnLoad(const char *hostInfo, int hostInfoLen, uint64_t cb) {
    g_callback = (host_callback_t)(uintptr_t)cb;
#else
EXPORT int PluginOnLoad(const char *hostInfo, int hostInfoLen,
                        uintptr_t cb, uintptr_t ctx) {
    g_callback     = (host_callback_t)cb;
    g_callback_ctx = ctx;
#endif
    /* Minimal JSON-ish parse to grab clientId — keeps the example dependency-free */
    g_client_id[0] = '\0';
    if (hostInfo && hostInfoLen > 0) {
        const char *key = "\"clientId\":\"";
        const char *p   = strstr(hostInfo, key);  /* safe: hostInfo is nul-terminated by the Go caller copying it */
        if (!p) {
            key = "\"clientId\": \"";
            p   = strstr(hostInfo, key);
        }
        if (p) {
            p += strlen(key);
            const char *end = strchr(p, '"');
            if (end) {
                size_t n = (size_t)(end - p);
                if (n >= sizeof(g_client_id)) n = sizeof(g_client_id) - 1;
                memcpy(g_client_id, p, n);
                g_client_id[n] = '\0';
            }
        }
    }

    fprintf(stderr, "[sample-c] loaded, clientId=%s\n", g_client_id);
    send_event("ready", "{\"message\":\"sample-c plugin ready\"}");
    return 0;
}

EXPORT int PluginOnEvent(const char *event, int eventLen,
                         const char *payload, int payloadLen) {
    (void)payloadLen;

    /* Simple echo for "ping" */
    if (eventLen == 4 && memcmp(event, "ping", 4) == 0) {
        send_event("pong", NULL);
        return 0;
    }

    /* Echo back ui_message */
    if (eventLen == 10 && memcmp(event, "ui_message", 10) == 0) {
        fprintf(stderr, "[sample-c] got ui_message: %.*s\n", payloadLen, payload ? payload : "");
        /* Build a tiny JSON response — payload is already JSON from the host */
        char buf[512];
        snprintf(buf, sizeof(buf), "{\"message\":\"echo from C: %.*s\"}",
                 payloadLen < 400 ? payloadLen : 400, payload ? payload : "");
        send_event("echo", buf);
        return 0;
    }

    fprintf(stderr, "[sample-c] unhandled event: %.*s\n", eventLen, event);
    return 0;
}

EXPORT void PluginOnUnload(void) {
    fprintf(stderr, "[sample-c] unloading\n");
    g_callback = NULL;
#ifndef _WIN32
    g_callback_ctx = 0;
#endif
    g_client_id[0] = '\0';
}
