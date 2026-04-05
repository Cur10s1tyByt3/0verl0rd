//go:build darwin && cgo

package plugins

/*
#include <dlfcn.h>
#include <stdint.h>
#include <stdlib.h>

static void* so_dlopen(const char* path, char** errOut) {
	void* h = dlopen(path, RTLD_NOW | RTLD_LOCAL);
	if (!h && errOut) *errOut = (char*)dlerror();
	return h;
}

static void* so_dlsym(void* h, const char* name, char** errOut) {
	void* s = dlsym(h, name);
	if (!s && errOut) *errOut = (char*)dlerror();
	return s;
}

static int so_dlclose(void* h) {
	if (h) return dlclose(h);
	return 0;
}

// Go callback bridge — forward-declared here, implemented via //export below.
extern void goPluginHostCallback(
	uintptr_t ctx,
	char* event, int eventLen,
	char* payload, int payloadLen);

// Call the plugin's PluginOnLoad, injecting our callback bridge + context.
static int so_call_onload(void* fn, const char* info, int infoLen, uintptr_t ctx) {
	typedef int (*fn_t)(const char*, int, uintptr_t, uintptr_t);
	return ((fn_t)fn)(info, infoLen, (uintptr_t)goPluginHostCallback, ctx);
}

static int so_call_onevent(void* fn, const char* ev, int evLen, const char* pl, int plLen) {
	typedef int (*fn_t)(const char*, int, const char*, int);
	return ((fn_t)fn)(ev, evLen, pl, plLen);
}

static void so_call_onunload(void* fn) {
	typedef void (*fn_t)(void);
	((fn_t)fn)();
}

static const char* so_call_getruntime(void* fn) {
	typedef const char* (*fn_t)(void);
	return ((fn_t)fn)();
}
*/
import "C"

import (
	"errors"
	"fmt"
	"os"
	"runtime/cgo"
	"sync"
	"unsafe"
)

//export goPluginHostCallback
func goPluginHostCallback(ctx C.uintptr_t, event *C.char, eventLen C.int, payload *C.char, payloadLen C.int) {
	h := cgo.Handle(ctx)
	send := h.Value().(func(string, []byte))
	ev := C.GoStringN(event, eventLen)
	var pl []byte
	if payloadLen > 0 {
		pl = C.GoBytes(unsafe.Pointer(payload), payloadLen)
	}
	send(ev, pl)
}

func loadNativePlugin(data []byte) (NativePlugin, error) {
	if len(data) == 0 {
		return nil, errors.New("empty plugin binary")
	}

	f, err := os.CreateTemp("", "*.dylib")
	if err != nil {
		return nil, fmt.Errorf("create temp: %w", err)
	}
	tmpPath := f.Name()

	if _, err := f.Write(data); err != nil {
		f.Close()
		os.Remove(tmpPath)
		return nil, fmt.Errorf("write temp: %w", err)
	}
	f.Close()

	cPath := C.CString(tmpPath)
	defer C.free(unsafe.Pointer(cPath))
	var cErr *C.char
	handle := C.so_dlopen(cPath, &cErr)

	os.Remove(tmpPath)

	if handle == nil {
		return nil, fmt.Errorf("dlopen: %s", C.GoString(cErr))
	}

	resolve := func(name string) (unsafe.Pointer, error) {
		cName := C.CString(name)
		defer C.free(unsafe.Pointer(cName))
		var cErr *C.char
		s := C.so_dlsym(handle, cName, &cErr)
		if s == nil {
			return nil, fmt.Errorf("dlsym(%s): %s", name, C.GoString(cErr))
		}
		return s, nil
	}

	onLoad, err := resolve("PluginOnLoad")
	if err != nil {
		C.so_dlclose(handle)
		return nil, err
	}
	onEvent, err := resolve("PluginOnEvent")
	if err != nil {
		C.so_dlclose(handle)
		return nil, err
	}
	onUnload, err := resolve("PluginOnUnload")
	if err != nil {
		C.so_dlclose(handle)
		return nil, err
	}

	pluginRT := "go"
	if getRuntimeFn, err := resolve("PluginGetRuntime"); err == nil {
		if cs := C.so_call_getruntime(getRuntimeFn); cs != nil {
			pluginRT = C.GoString(cs)
		}
	}

	return &soPlugin{
		handle:        handle,
		onLoadFn:      onLoad,
		onEventFn:     onEvent,
		onUnloadFn:    onUnload,
		pluginRuntime: pluginRT,
	}, nil
}

type soPlugin struct {
	handle        unsafe.Pointer
	onLoadFn      unsafe.Pointer
	onEventFn     unsafe.Pointer
	onUnloadFn    unsafe.Pointer
	cbHandle      cgo.Handle
	pluginRuntime string
	mu            sync.Mutex
}

func (p *soPlugin) Load(send func(string, []byte), hostInfo []byte) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.cbHandle = cgo.NewHandle(send)

	var infoPtr *C.char
	if len(hostInfo) > 0 {
		infoPtr = (*C.char)(unsafe.Pointer(&hostInfo[0]))
	}

	ret := C.so_call_onload(p.onLoadFn, infoPtr, C.int(len(hostInfo)), C.uintptr_t(p.cbHandle))
	if ret != 0 {
		p.cbHandle.Delete()
		p.cbHandle = 0
		return errors.New("PluginOnLoad returned error")
	}
	return nil
}

func (p *soPlugin) Event(event string, payload []byte) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	evBytes := []byte(event)
	var evPtr, plPtr *C.char
	if len(evBytes) > 0 {
		evPtr = (*C.char)(unsafe.Pointer(&evBytes[0]))
	}
	if len(payload) > 0 {
		plPtr = (*C.char)(unsafe.Pointer(&payload[0]))
	}

	ret := C.so_call_onevent(p.onEventFn, evPtr, C.int(len(evBytes)), plPtr, C.int(len(payload)))
	if ret != 0 {
		return errors.New("PluginOnEvent returned error")
	}
	return nil
}

func (p *soPlugin) Unload() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.onUnloadFn != nil {
		C.so_call_onunload(p.onUnloadFn)
		p.onUnloadFn = nil
	}
}

func (p *soPlugin) Close() error {
	p.Unload()
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.cbHandle != 0 {
		p.cbHandle.Delete()
		p.cbHandle = 0
	}
	if p.handle != nil {
		if p.pluginRuntime != "go" {
			C.so_dlclose(p.handle)
		}
		p.handle = nil
	}
	return nil
}

func (p *soPlugin) Runtime() string {
	return p.pluginRuntime
}
