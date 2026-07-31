#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <windowsx.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define EXPORT __declspec(dllexport)

typedef void (__stdcall *host_callback_t)(const char *, uintptr_t, const char *, uintptr_t);
static host_callback_t g_callback;
static HINSTANCE g_instance;
static HWND g_window;
static HANDLE g_thread;
static SRWLOCK g_lock = SRWLOCK_INIT;
static char g_game_id[80];
static char g_operator[96] = "operator";
static char g_board[9];
static char g_turn;
static char g_status[24];
static int g_waiting;
static char g_winner;
static ULONGLONG g_confetti_until;

static void send_event(const char *event, const char *payload) {
    if (g_callback) g_callback(event, (uintptr_t)strlen(event), payload, payload ? (uintptr_t)strlen(payload) : 0);
}

static void json_string(const char *json, const char *key, char *out, size_t capacity) {
    const char *start = strstr(json, key);
    if (!start || capacity == 0) return;
    start += strlen(key);
    const char *end = strchr(start, '"');
    if (!end) return;
    size_t length = (size_t)(end - start);
    if (length >= capacity) length = capacity - 1;
    memcpy(out, start, length);
    out[length] = 0;
}

static void parse_board(const char *json) {
    const char *cursor = strstr(json, "\"board\":[");
    memset(g_board, 0, sizeof(g_board));
    if (!cursor) return;
    cursor += 9;
    for (int index = 0; index < 9; index++) {
        cursor = strchr(cursor, '"');
        if (!cursor) break;
        cursor++;
        if (*cursor == 'X' || *cursor == 'O') g_board[index] = *cursor;
        cursor = strchr(cursor, '"');
        if (!cursor) break;
        cursor++;
    }
}

static void parse_state(const char *json) {
    AcquireSRWLockExclusive(&g_lock);
    json_string(json, "\"id\":\"", g_game_id, sizeof(g_game_id));
    json_string(json, "\"status\":\"", g_status, sizeof(g_status));
    int was_client_win = strcmp(g_status, "won") == 0 && g_winner == 'O';
    char winner[4] = {0};
    json_string(json, "\"winner\":\"", winner, sizeof(winner));
    g_winner = winner[0];
    int client_won = strcmp(g_status, "won") == 0 && g_winner == 'O';
    if (client_won && !was_client_win) g_confetti_until = GetTickCount64() + 3000;
    else if (!client_won) g_confetti_until = 0;
    char turn[4] = {0};
    json_string(json, "\"turn\":\"", turn, sizeof(turn));
    g_turn = turn[0];
    const char *player = strstr(json, "\"playerX\":");
    if (player) json_string(player, "\"username\":\"", g_operator, sizeof(g_operator));
    parse_board(json);
    g_waiting = 0;
    ReleaseSRWLockExclusive(&g_lock);
}

static void draw_centered(HDC dc, const char *text, RECT rect, HFONT font, COLORREF color) {
    SelectObject(dc, font);
    SetTextColor(dc, color);
    SetBkMode(dc, TRANSPARENT);
    DrawTextA(dc, text, -1, &rect, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
}

static void draw_confetti(HDC dc, RECT client, ULONGLONG until) {
    ULONGLONG now = GetTickCount64();
    if (!until || now >= until) return;
    ULONGLONG elapsed = 3000 - (until - now);
    int width = client.right - client.left;
    int height = client.bottom - client.top;
    COLORREF colors[] = {RGB(251, 113, 133), RGB(254, 205, 211), RGB(255, 255, 255)};
    for (int index = 0; index < 60; index++) {
        int x = (index * 73) % width;
        int speed = 110 + (index % 5) * 24;
        int y = (int)((elapsed * speed / 1000 + index * 47) % (height + 36)) - 18;
        HBRUSH brush = CreateSolidBrush(colors[index % 3]);
        RECT piece = {x, y, x + 8, y + 14};
        FillRect(dc, &piece, brush);
        DeleteObject(brush);
    }
}

static LRESULT CALLBACK window_proc(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
    if (message == WM_PAINT) {
        PAINTSTRUCT paint;
        HDC dc = BeginPaint(window, &paint);
        RECT client;
        GetClientRect(window, &client);
        HBRUSH background = CreateSolidBrush(RGB(8, 13, 22));
        FillRect(dc, &client, background);
        DeleteObject(background);

        char board[9], status[24], opponent[96];
        char turn, winner;
        ULONGLONG confetti_until;
        AcquireSRWLockShared(&g_lock);
        memcpy(board, g_board, sizeof(board));
        strcpy(status, g_status);
        strcpy(opponent, g_operator);
        turn = g_turn;
        winner = g_winner;
        confetti_until = g_confetti_until;
        ReleaseSRWLockShared(&g_lock);

        HFONT title_font = CreateFontA(24, 0, 0, 0, FW_BOLD, 0, 0, 0, DEFAULT_CHARSET, 0, 0, 0, 0, "Segoe UI");
        HFONT mark_font = CreateFontA(58, 0, 0, 0, FW_BOLD, 0, 0, 0, DEFAULT_CHARSET, 0, 0, 0, 0, "Segoe UI");
        HFONT text_font = CreateFontA(16, 0, 0, 0, FW_NORMAL, 0, 0, 0, DEFAULT_CHARSET, 0, 0, 0, 0, "Segoe UI");
        RECT title = {20, 10, 340, 45};
        char title_text[160];
        snprintf(title_text, sizeof(title_text), "Tic Tac Toe vs %s", opponent);
        draw_centered(dc, title_text, title, title_font, RGB(229, 231, 235));

        HPEN grid_pen = CreatePen(PS_SOLID, 2, RGB(51, 65, 85));
        SelectObject(dc, grid_pen);
        for (int index = 1; index < 3; index++) {
            MoveToEx(dc, 20 + index * 100, 60, NULL); LineTo(dc, 20 + index * 100, 360);
            MoveToEx(dc, 20, 60 + index * 100, NULL); LineTo(dc, 320, 60 + index * 100);
        }
        DeleteObject(grid_pen);
        for (int index = 0; index < 9; index++) {
            if (!board[index]) continue;
            int row = index / 3, column = index % 3;
            RECT cell = {20 + column * 100, 60 + row * 100, 120 + column * 100, 160 + row * 100};
            char mark[2] = {board[index], 0};
            draw_centered(dc, mark, cell, mark_font, board[index] == 'X' ? RGB(56, 189, 248) : RGB(251, 113, 133));
        }
        RECT footer = {20, 370, 320, 405};
        const char *footer_text = strcmp(status, "active") != 0
            ? (strcmp(status, "won") == 0 ? (winner == 'O' ? "You won!" : "You lost.") : "Waiting for game")
            : (turn == 'O' ? "Your turn" : "Operator's turn");
        draw_centered(dc, footer_text, footer, text_font, RGB(148, 163, 184));
        draw_confetti(dc, client, confetti_until);
        DeleteObject(title_font);
        DeleteObject(mark_font);
        DeleteObject(text_font);
        EndPaint(window, &paint);
        return 0;
    }
    if (message == WM_TIMER) {
        ULONGLONG until;
        AcquireSRWLockShared(&g_lock);
        until = g_confetti_until;
        ReleaseSRWLockShared(&g_lock);
        if (until > GetTickCount64()) InvalidateRect(window, NULL, FALSE);
        else KillTimer(window, 1);
        return 0;
    }
    if (message == WM_LBUTTONUP) {
        int x = GET_X_LPARAM(lparam), y = GET_Y_LPARAM(lparam);
        if (x < 20 || x >= 320 || y < 60 || y >= 360) return 0;
        int cell = ((y - 60) / 100) * 3 + ((x - 20) / 100);
        char game_id[80];
        int allowed = 0;
        AcquireSRWLockExclusive(&g_lock);
        if (!g_waiting && strcmp(g_status, "active") == 0 && g_turn == 'O' && !g_board[cell]) {
            g_waiting = 1;
            strcpy(game_id, g_game_id);
            allowed = 1;
        }
        ReleaseSRWLockExclusive(&g_lock);
        if (allowed) {
            char payload[160];
            snprintf(payload, sizeof(payload), "{\"gameId\":\"%s\",\"cell\":%d}", game_id, cell);
            send_event("move", payload);
            InvalidateRect(window, NULL, FALSE);
        }
        return 0;
    }
    if (message == WM_CLOSE) { DestroyWindow(window); return 0; }
    if (message == WM_DESTROY) { PostQuitMessage(0); return 0; }
    return DefWindowProcW(window, message, wparam, lparam);
}

static DWORD WINAPI ui_thread(void *unused) {
    (void)unused;
    const wchar_t *class_name = L"OverlordTicTacToePlugin";
    WNDCLASSW wc = {0};
    wc.lpfnWndProc = window_proc;
    wc.hInstance = g_instance;
    wc.lpszClassName = class_name;
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    RegisterClassW(&wc);
    g_window = CreateWindowExW(WS_EX_TOPMOST, class_name, L"Tic Tac Toe", WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX,
        CW_USEDEFAULT, CW_USEDEFAULT, 360, 455, NULL, NULL, g_instance, NULL);
    if (!g_window) return 1;
    ShowWindow(g_window, SW_SHOW);
    UpdateWindow(g_window);
    SetTimer(g_window, 1, 33, NULL);
    MSG message;
    while (GetMessageW(&message, NULL, 0, 0) > 0) { TranslateMessage(&message); DispatchMessageW(&message); }
    g_window = NULL;
    return 0;
}

static void ensure_window(void) {
    if (g_window) {
        ShowWindow(g_window, SW_RESTORE);
        SetWindowPos(g_window, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
        SetForegroundWindow(g_window);
        return;
    }
    if (g_thread) { CloseHandle(g_thread); g_thread = NULL; }
    g_thread = CreateThread(NULL, 0, ui_thread, NULL, 0, NULL);
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID reserved) {
    (void)reserved;
    if (reason == DLL_PROCESS_ATTACH) { g_instance = instance; DisableThreadLibraryCalls(instance); }
    return TRUE;
}

EXPORT const char *PluginGetRuntime(void) { return "c"; }
EXPORT void PluginSetCallback(uint64_t callback) { g_callback = (host_callback_t)(uintptr_t)callback; }
EXPORT int PluginOnLoad(const char *host_info, int host_info_length, uint64_t callback) {
    (void)host_info; (void)host_info_length;
    g_callback = (host_callback_t)(uintptr_t)callback;
    send_event("ready", "{\"ready\":true}");
    return 0;
}
EXPORT int PluginOnEvent(const char *event, int event_length, const char *payload, int payload_length) {
    if (event_length == 5 && memcmp(event, "state", 5) == 0 && payload && payload_length > 0) {
        char *json = (char *)malloc((size_t)payload_length + 1);
        if (!json) return 1;
        memcpy(json, payload, (size_t)payload_length);
        json[payload_length] = 0;
        parse_state(json);
        free(json);
        ensure_window();
        if (g_window) {
            SetTimer(g_window, 1, 33, NULL);
            InvalidateRect(g_window, NULL, FALSE);
        }
    }
    return 0;
}
EXPORT void PluginOnUnload(void) {
    if (g_window) PostMessageW(g_window, WM_CLOSE, 0, 0);
    if (g_thread) { WaitForSingleObject(g_thread, 2000); CloseHandle(g_thread); g_thread = NULL; }
    g_callback = NULL;
}
