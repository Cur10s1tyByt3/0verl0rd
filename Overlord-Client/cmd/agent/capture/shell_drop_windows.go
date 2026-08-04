//go:build windows

package capture

import (
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
	"unsafe"
)

type ShellDropHit struct {
	Directory string
	ItemName  string
	Desktop   bool
}

func ResolveShellDropHit(x, y int32) ShellDropHit {
	result := make(chan ShellDropHit, 1)
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()

		out := ShellDropHit{}
		hr, _, _ := procCoInitializeEx.Call(0, COINIT_MULTITHREADED)
		if hr != 0 && hr != 1 {
			result <- out
			return
		}
		defer procCoUninitialize.Call()

		var automation *iuiAutomation
		hr, _, _ = procCoCreateInstance.Call(
			uintptr(unsafe.Pointer(&CLSID_CUIAutomation)), 0, CLSCTX_INPROC_SERVER,
			uintptr(unsafe.Pointer(&IID_IUIAutomation)), uintptr(unsafe.Pointer(&automation)),
		)
		if hr != S_OK || automation == nil {
			result <- out
			return
		}
		defer automation.Release()
		walker := automation.GetControlViewWalker()
		if walker == nil {
			result <- out
			return
		}
		defer walker.Release()

		elem := automation.ElementFromPoint(point{x: x, y: y})
		if elem == nil {
			result <- out
			return
		}
		out.ItemName = strings.TrimSpace(elem.GetCurrentName())
		sawCabinet := false
		sawShellList := false
		for current, depth := elem, 0; current != nil && depth < 32; depth++ {
			className := current.GetCurrentClassName()
			if className == "CabinetWClass" {
				sawCabinet = true
				out.Directory = explorerDirectoryFromUIA(walker, current)
			}
			if className == "SysListView32" || className == "SHELLDLL_DefView" {
				sawShellList = true
			}
			parent := walker.GetParentElement(current)
			current.Release()
			current = parent
		}
		if sawCabinet {
			out.Desktop = false
		} else if sawShellList {
			out.Desktop = true
			if home, err := os.UserHomeDir(); err == nil {
				out.Directory = filepath.Join(home, "Desktop")
			}
		}
		result <- out
	}()
	select {
	case hit := <-result:
		return hit
	case <-time.After(4 * time.Second):
		return ShellDropHit{}
	}
}

func explorerDirectoryFromUIA(walker *iuiAutomationTreeWalker, root *iuiAutomationElement) string {
	visited := 0
	var walk func(*iuiAutomationElement) string
	walk = func(parent *iuiAutomationElement) string {
		for child := shellDropFirstChild(walker, parent); child != nil && visited < 2500; {
			visited++
			next := shellDropNextSibling(walker, child)
			name := strings.TrimSpace(child.GetCurrentName())
			if strings.HasPrefix(strings.ToLower(name), "address:") {
				candidate := shellDirectoryCandidate(name)
				if candidate == "" {
					// Continue into the element; localized or virtual shell paths
					// may not be filesystem destinations.
				} else {
					child.Release()
					if next != nil {
						next.Release()
					}
					return candidate
				}
			}
			if pattern := child.GetCurrentPattern(uiaValuePatternID); pattern != nil {
				valuePattern := (*iuiAutomationValuePattern)(unsafe.Pointer(pattern))
				candidate := shellDirectoryCandidate(valuePattern.GetCurrentValue())
				valuePattern.Release()
				if candidate != "" {
					child.Release()
					if next != nil {
						next.Release()
					}
					return candidate
				}
			}
			if candidate := walk(child); candidate != "" {
				child.Release()
				if next != nil {
					next.Release()
				}
				return candidate
			}
			child.Release()
			child = next
		}
		return ""
	}
	return walk(root)
}

func shellDropFirstChild(walker *iuiAutomationTreeWalker, elem *iuiAutomationElement) *iuiAutomationElement {
	var child *iuiAutomationElement
	hr := callSyscallN(walker.lpVtbl.GetFirstChildElement,
		uintptr(unsafe.Pointer(walker)),
		uintptr(unsafe.Pointer(elem)),
		uintptr(unsafe.Pointer(&child)),
	)
	if hr != S_OK || child == nil {
		return nil
	}
	return child
}

func shellDropNextSibling(walker *iuiAutomationTreeWalker, elem *iuiAutomationElement) *iuiAutomationElement {
	var sibling *iuiAutomationElement
	hr := callSyscallN(walker.lpVtbl.GetNextSiblingElement,
		uintptr(unsafe.Pointer(walker)),
		uintptr(unsafe.Pointer(elem)),
		uintptr(unsafe.Pointer(&sibling)),
	)
	if hr != S_OK || sibling == nil {
		return nil
	}
	return sibling
}

func shellDirectoryCandidate(value string) string {
	value = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(value), "Address:"))
	if strings.HasPrefix(strings.ToLower(value), "file:") {
		if parsed, err := url.Parse(value); err == nil {
			value = parsed.Path
			if len(value) >= 3 && value[0] == '/' && value[2] == ':' {
				value = value[1:]
			}
			value, _ = url.PathUnescape(value)
		}
	}
	if !filepath.IsAbs(value) {
		return ""
	}
	if info, err := os.Stat(value); err == nil && info.IsDir() {
		return filepath.Clean(value)
	}
	return ""
}
