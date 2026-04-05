/*
 * Sample C++ Plugin — fully unloadable, no runtime baggage.
 *
 * Exports the standard Overlord plugin ABI:
 *   PluginOnLoad, PluginOnEvent, PluginOnUnload, PluginSetCallback,
 *   PluginGetRuntime  (returns "cpp" — tells the host this DLL can be freed)
 *
 * Build (Windows / MSVC):
 *   cl /LD /EHsc /O2 plugin.cpp /Fe:sample-cpp-windows-amd64.dll
 *   — or with MinGW —
 *   x86_64-w64-mingw32-g++ -shared -O2 -o sample-cpp-windows-amd64.dll plugin.cpp
 *
 * Build (Linux):
 *   g++ -shared -fPIC -O2 -o sample-cpp-linux-amd64.so plugin.cpp
 */

#include <cstdint>
#include <cstring>
#include <cstdio>
#include <string>
#include <mutex>
#include <unordered_map>

/* ------------------------------------------------------------------ */
/* Platform helpers                                                    */
/* ------------------------------------------------------------------ */

#ifdef _WIN32
#  define EXPORT extern "C" __declspec(dllexport)
#  define WIN32_LEAN_AND_MEAN
#  include <windows.h>
   BOOL WINAPI DllMain(HINSTANCE hDll, DWORD reason, LPVOID reserved) {
       (void)hDll; (void)reserved;
       return TRUE;
   }
#else
#  define EXPORT extern "C" __attribute__((visibility("default")))
#endif

/* ------------------------------------------------------------------ */
/* Host callback                                                       */
/* ------------------------------------------------------------------ */

#ifdef _WIN32
typedef void (__stdcall *host_callback_t)(
    const char *event, uintptr_t eventLen,
    const char *payload, uintptr_t payloadLen);
#else
typedef void (*host_callback_t)(
    uintptr_t ctx,
    const char *event, int eventLen,
    const char *payload, int payloadLen);
#endif

static host_callback_t g_callback = nullptr;
#ifndef _WIN32
static uintptr_t       g_callback_ctx = 0;
#endif

static void send_event(const char *event, const char *payload) {
    if (!g_callback) return;
    int elen = event   ? static_cast<int>(strlen(event))   : 0;
    int plen = payload ? static_cast<int>(strlen(payload))  : 0;
#ifdef _WIN32
    g_callback(event, static_cast<uintptr_t>(elen),
               payload, static_cast<uintptr_t>(plen));
#else
    g_callback(g_callback_ctx, event, elen, payload, plen);
#endif
}

/* ------------------------------------------------------------------ */
/* Plugin state — demonstrates C++ features (std::string, maps, mutex) */
/* ------------------------------------------------------------------ */

static std::mutex g_mu;
static std::string g_client_id;
static std::unordered_map<std::string, int> g_event_counts;

/* Extract a JSON string value by key (simple, no full JSON parser) */
static std::string json_extract(const char *json, int len, const char *key) {
    if (!json || len <= 0) return "";
    std::string haystack(json, static_cast<size_t>(len));
    std::string needle = std::string("\"") + key + "\":\"";
    auto pos = haystack.find(needle);
    if (pos == std::string::npos) {
        needle = std::string("\"") + key + "\": \"";
        pos = haystack.find(needle);
    }
    if (pos == std::string::npos) return "";
    pos += needle.size();
    auto end = haystack.find('"', pos);
    if (end == std::string::npos) return "";
    return haystack.substr(pos, end - pos);
}

/* ------------------------------------------------------------------ */
/* Exported ABI                                                        */
/* ------------------------------------------------------------------ */

EXPORT const char *PluginGetRuntime() {
    return "cpp";
}

#ifdef _WIN32
EXPORT void PluginSetCallback(uint64_t cb) {
    g_callback = reinterpret_cast<host_callback_t>(static_cast<uintptr_t>(cb));
}

EXPORT int PluginOnLoad(const char *hostInfo, int hostInfoLen, uint64_t cb) {
    g_callback = reinterpret_cast<host_callback_t>(static_cast<uintptr_t>(cb));
#else
EXPORT int PluginOnLoad(const char *hostInfo, int hostInfoLen,
                        uintptr_t cb, uintptr_t ctx) {
    g_callback     = reinterpret_cast<host_callback_t>(cb);
    g_callback_ctx = ctx;
#endif

    {
        std::lock_guard<std::mutex> lk(g_mu);
        g_client_id = json_extract(hostInfo, hostInfoLen, "clientId");
        g_event_counts.clear();
    }

    fprintf(stderr, "[sample-cpp] loaded, clientId=%s\n", g_client_id.c_str());
    send_event("ready", "{\"message\":\"sample-cpp plugin ready\"}");
    return 0;
}

EXPORT int PluginOnEvent(const char *event, int eventLen,
                         const char *payload, int payloadLen) {
    std::string ev(event, static_cast<size_t>(eventLen));

    {
        std::lock_guard<std::mutex> lk(g_mu);
        g_event_counts[ev]++;
    }

    if (ev == "ping") {
        send_event("pong", nullptr);
        return 0;
    }

    if (ev == "ui_message") {
        std::string pl(payload ? payload : "", payload ? static_cast<size_t>(payloadLen) : 0u);
        fprintf(stderr, "[sample-cpp] got ui_message: %s\n", pl.c_str());
        std::string resp = "{\"message\":\"echo from C++: " + pl + "\"}";
        send_event("echo", resp.c_str());
        return 0;
    }

    if (ev == "stats") {
        std::lock_guard<std::mutex> lk(g_mu);
        std::string json = "{";
        bool first = true;
        for (auto &kv : g_event_counts) {
            if (!first) json += ",";
            json += "\"" + kv.first + "\":" + std::to_string(kv.second);
            first = false;
        }
        json += "}";
        send_event("stats_reply", json.c_str());
        return 0;
    }

    fprintf(stderr, "[sample-cpp] unhandled event: %s\n", ev.c_str());
    return 0;
}

EXPORT void PluginOnUnload() {
    fprintf(stderr, "[sample-cpp] unloading\n");
    g_callback = nullptr;
#ifndef _WIN32
    g_callback_ctx = 0;
#endif
    std::lock_guard<std::mutex> lk(g_mu);
    g_client_id.clear();
    g_event_counts.clear();
}
