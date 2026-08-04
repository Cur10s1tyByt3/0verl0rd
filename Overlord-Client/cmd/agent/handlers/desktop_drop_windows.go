//go:build windows

package handlers

import (
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	ddUser32                   = windows.NewLazySystemDLL("user32.dll")
	ddKernel32                 = windows.NewLazySystemDLL("kernel32.dll")
	ddFindWindowW              = ddUser32.NewProc("FindWindowW")
	ddFindWindowExW            = ddUser32.NewProc("FindWindowExW")
	ddSendMessageW             = ddUser32.NewProc("SendMessageW")
	ddScreenToClient           = ddUser32.NewProc("ScreenToClient")
	ddGetWindowThreadProcessID = ddUser32.NewProc("GetWindowThreadProcessId")
	ddOpenProcess              = ddKernel32.NewProc("OpenProcess")
	ddVirtualAllocEx           = ddKernel32.NewProc("VirtualAllocEx")
	ddVirtualFreeEx            = ddKernel32.NewProc("VirtualFreeEx")
	ddWriteProcessMemory       = ddKernel32.NewProc("WriteProcessMemory")
	ddReadProcessMemory        = ddKernel32.NewProc("ReadProcessMemory")
)

const (
	ddProcessVMOperation = 0x0008
	ddProcessVMRead      = 0x0010
	ddProcessVMWrite     = 0x0020
	ddProcessQueryInfo   = 0x0400
	ddMemCommit          = 0x1000
	ddMemReserve         = 0x2000
	ddMemRelease         = 0x8000
	ddPageReadWrite      = 0x04
	ddLVMGetItemCount    = 0x1004
	ddLVMSetItemPosition = 0x100f
	ddLVMGetItemTextW    = 0x1073
)

type desktopDropPoint struct{ X, Y int32 }

type desktopDropLVItem struct {
	Mask       uint32
	IItem      int32
	ISubItem   int32
	State      uint32
	StateMask  uint32
	PszText    uintptr
	CchTextMax int32
	IImage     int32
	LParam     uintptr
}

func positionDesktopUpload(fileName string, x, y int32) {
	listView := desktopListView()
	if listView == 0 {
		return
	}
	point := desktopDropPoint{X: x, Y: y}
	ddScreenToClient.Call(listView, uintptr(unsafe.Pointer(&point)))

	// Explorer may need a moment to observe the newly created file.
	for attempt := 0; attempt < 20; attempt++ {
		if index := desktopListViewItemIndex(listView, fileName); index >= 0 {
			packed := uintptr(uint32(uint16(point.X)) | uint32(uint16(point.Y))<<16)
			ddSendMessageW.Call(listView, ddLVMSetItemPosition, uintptr(index), packed)
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func desktopListView() uintptr {
	progman, _, _ := ddFindWindowW.Call(uintptr(unsafe.Pointer(mustUTF16Ptr("Progman"))), 0)
	if view := findShellDefView(progman); view != 0 {
		list, _, _ := ddFindWindowExW.Call(view, 0, uintptr(unsafe.Pointer(mustUTF16Ptr("SysListView32"))), 0)
		return list
	}
	var after uintptr
	for {
		worker, _, _ := ddFindWindowExW.Call(0, after, uintptr(unsafe.Pointer(mustUTF16Ptr("WorkerW"))), 0)
		if worker == 0 {
			return 0
		}
		if view := findShellDefView(worker); view != 0 {
			list, _, _ := ddFindWindowExW.Call(view, 0, uintptr(unsafe.Pointer(mustUTF16Ptr("SysListView32"))), 0)
			return list
		}
		after = worker
	}
}

func findShellDefView(parent uintptr) uintptr {
	if parent == 0 {
		return 0
	}
	view, _, _ := ddFindWindowExW.Call(parent, 0, uintptr(unsafe.Pointer(mustUTF16Ptr("SHELLDLL_DefView"))), 0)
	return view
}

func desktopListViewItemIndex(listView uintptr, fileName string) int32 {
	var pid uint32
	ddGetWindowThreadProcessID.Call(listView, uintptr(unsafe.Pointer(&pid)))
	process, _, _ := ddOpenProcess.Call(ddProcessVMOperation|ddProcessVMRead|ddProcessVMWrite|ddProcessQueryInfo, 0, uintptr(pid))
	if process == 0 {
		return -1
	}
	defer windows.CloseHandle(windows.Handle(process))

	const textChars = 520
	itemSize := unsafe.Sizeof(desktopDropLVItem{})
	remote, _, _ := ddVirtualAllocEx.Call(process, 0, itemSize+textChars*2, ddMemCommit|ddMemReserve, ddPageReadWrite)
	if remote == 0 {
		return -1
	}
	defer ddVirtualFreeEx.Call(process, remote, 0, ddMemRelease)
	item := desktopDropLVItem{ISubItem: 0, PszText: remote + itemSize, CchTextMax: textChars}
	ddWriteProcessMemory.Call(process, remote, uintptr(unsafe.Pointer(&item)), itemSize, 0)

	count, _, _ := ddSendMessageW.Call(listView, ddLVMGetItemCount, 0, 0)
	want := strings.EqualFold
	stem := strings.TrimSuffix(fileName, filepath.Ext(fileName))
	buf := make([]uint16, textChars)
	for index := int32(0); index < int32(count); index++ {
		ddSendMessageW.Call(listView, ddLVMGetItemTextW, uintptr(index), remote)
		ddReadProcessMemory.Call(process, remote+itemSize, uintptr(unsafe.Pointer(&buf[0])), textChars*2, 0)
		name := syscall.UTF16ToString(buf)
		if want(name, fileName) || (stem != "" && want(name, stem)) {
			return index
		}
	}
	return -1
}

func mustUTF16Ptr(value string) *uint16 {
	pointer, _ := windows.UTF16PtrFromString(value)
	return pointer
}
