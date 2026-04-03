//go:build windows
// +build windows

package criticalproc

import (
	"fmt"
	"log"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	modntdll                    = windows.NewLazySystemDLL("ntdll.dll")
	procNtSetInformationProcess = modntdll.NewProc("NtSetInformationProcess")
)

const processBreakOnTermination = 29

func Setup() {
	if !windows.GetCurrentProcessToken().IsElevated() {
		log.Printf("[criticalproc] not running as administrator, skipping critical process flag")
		return
	}
	if err := enableSeDebugPrivilege(); err != nil {
		log.Printf("[criticalproc] failed to enable SeDebugPrivilege: %v", err)
		return
	}
	if err := ntSetBreakOnTermination(1); err != nil {
		log.Printf("[criticalproc] failed to set critical process: %v", err)
		return
	}
	log.Printf("[criticalproc] process marked as critical")
}

func Teardown() {
	if !windows.GetCurrentProcessToken().IsElevated() {
		return
	}
	if err := ntSetBreakOnTermination(0); err != nil {
		log.Printf("[criticalproc] failed to unset critical process: %v", err)
	}
}

func enableSeDebugPrivilege() error {
	var hToken windows.Token
	err := windows.OpenProcessToken(
		windows.CurrentProcess(),
		windows.TOKEN_ADJUST_PRIVILEGES|windows.TOKEN_QUERY,
		&hToken,
	)
	if err != nil {
		return fmt.Errorf("OpenProcessToken: %w", err)
	}
	defer hToken.Close()

	seDebugName, err := windows.UTF16PtrFromString("SeDebugPrivilege")
	if err != nil {
		return fmt.Errorf("UTF16PtrFromString: %w", err)
	}
	var luid windows.LUID
	if err := windows.LookupPrivilegeValue(nil, seDebugName, &luid); err != nil {
		return fmt.Errorf("LookupPrivilegeValue: %w", err)
	}

	tp := windows.Tokenprivileges{
		PrivilegeCount: 1,
		Privileges: [1]windows.LUIDAndAttributes{
			{Luid: luid, Attributes: windows.SE_PRIVILEGE_ENABLED},
		},
	}
	return windows.AdjustTokenPrivileges(hToken, false, &tp, 0, nil, nil)
}

func ntSetBreakOnTermination(val uint32) error {
	ret, _, _ := procNtSetInformationProcess.Call(
		uintptr(windows.CurrentProcess()),
		processBreakOnTermination,
		uintptr(unsafe.Pointer(&val)),
		unsafe.Sizeof(val),
	)
	if ret != 0 {
		return fmt.Errorf("NtSetInformationProcess(ProcessBreakOnTermination) failed: NTSTATUS 0x%x", ret)
	}
	return nil
}
