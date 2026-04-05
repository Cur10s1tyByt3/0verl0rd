//go:build windows

package plugins

import (
	"errors"
	"fmt"
	"sync"
	"syscall"
	"unsafe"
)

func loadNativePlugin(data []byte) (NativePlugin, error) {
	if len(data) == 0 {
		return nil, errors.New("empty plugin binary")
	}

	mm, err := LoadMemoryModule(data)
	if err != nil {
		return nil, fmt.Errorf("pe load: %w", err)
	}

	if err := mm.CallEntryPoint(dllProcessAttach); err != nil {
		mm.Free()
		return nil, fmt.Errorf("DllMain init: %w", err)
	}

	onLoad, err := mm.GetExport("PluginOnLoad")
	if err != nil {
		mm.Free()
		return nil, err
	}
	onEvent, err := mm.GetExport("PluginOnEvent")
	if err != nil {
		mm.Free()
		return nil, err
	}
	onUnload, err := mm.GetExport("PluginOnUnload")
	if err != nil {
		mm.Free()
		return nil, err
	}

	setCallback, _ := mm.GetExport("PluginSetCallback")

	runtime := "go"
	if getRuntimeAddr, err := mm.GetExport("PluginGetRuntime"); err == nil {
		ret, _, _ := syscall.SyscallN(getRuntimeAddr)
		if ret != 0 {
			var buf [32]byte
			for i := range buf {
				b := *(*byte)(unsafe.Pointer(ret + uintptr(i)))
				if b == 0 {
					runtime = string(buf[:i])
					break
				}
				buf[i] = b
			}
		}
	}

	dp := &dllPlugin{
		mem:             mm,
		onLoadAddr:      onLoad,
		onEventAddr:     onEvent,
		onUnloadAddr:    onUnload,
		setCallbackAddr: setCallback,
		pluginRuntime:   runtime,
	}
	return dp, nil
}

type dllPlugin struct {
	mem             *MemoryModule
	onLoadAddr      uintptr
	onEventAddr     uintptr
	onUnloadAddr    uintptr
	setCallbackAddr uintptr
	callbackHandle  uintptr // prevent GC of the callback closure
	pluginRuntime   string  // "go", "c", "cpp", etc.
	mu              sync.Mutex
}

func (p *dllPlugin) Load(send func(string, []byte), hostInfo []byte) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	// Create a stdcall callback the DLL can invoke to send events to the host.
	cb := syscall.NewCallback(func(eventPtr, eventLen, payloadPtr, payloadLen uintptr) uintptr {
		event := make([]byte, eventLen)
		if eventLen > 0 {
			copy(event, unsafe.Slice((*byte)(unsafe.Pointer(eventPtr)), eventLen))
		}
		payload := make([]byte, payloadLen)
		if payloadLen > 0 {
			copy(payload, unsafe.Slice((*byte)(unsafe.Pointer(payloadPtr)), payloadLen))
		}
		send(string(event), payload)
		return 0
	})
	p.callbackHandle = cb

	if p.setCallbackAddr != 0 {
		syscall.SyscallN(p.setCallbackAddr, cb)
	}

	var infoPtr uintptr
	infoLen := uintptr(len(hostInfo))
	if len(hostInfo) > 0 {
		infoPtr = uintptr(unsafe.Pointer(&hostInfo[0]))
	}
	ret, _, _ := syscall.SyscallN(p.onLoadAddr, infoPtr, infoLen, cb)
	if int32(ret) != 0 {
		return errors.New("PluginOnLoad returned non-zero")
	}
	return nil
}

func (p *dllPlugin) Event(event string, payload []byte) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	eventBytes := []byte(event)
	var eventPtr, payloadPtr uintptr
	eventLen := uintptr(len(eventBytes))
	payloadLen := uintptr(len(payload))
	if len(eventBytes) > 0 {
		eventPtr = uintptr(unsafe.Pointer(&eventBytes[0]))
	}
	if len(payload) > 0 {
		payloadPtr = uintptr(unsafe.Pointer(&payload[0]))
	}

	ret, _, _ := syscall.SyscallN(p.onEventAddr, eventPtr, eventLen, payloadPtr, payloadLen)
	if int32(ret) != 0 {
		return errors.New("PluginOnEvent returned non-zero")
	}
	return nil
}

func (p *dllPlugin) Unload() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.onUnloadAddr != 0 {
		syscall.SyscallN(p.onUnloadAddr)
	}
}

func (p *dllPlugin) Close() error {
	p.Unload()
	if p.pluginRuntime != "go" {
		if p.mem != nil {
			p.mem.Free()
			p.mem = nil
		}
	} else {
		p.mem = nil
	}
	return nil
}

func (p *dllPlugin) Runtime() string {
	return p.pluginRuntime
}
