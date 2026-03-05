package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"time"
)

const crashLogFileName = "crashlogC.log"

func handleFatalPanic() {
	if r := recover(); r != nil {
		reason := fmt.Sprintf("panic: %v", r)
		stack := debug.Stack()
		path := writeCrashLog(reason, stack)
		log.Printf("[fatal] %s (see %s)", reason, path)
		os.Exit(1)
	}
}

func fatalExit(reason string, err error) {
	if err != nil {
		reason = fmt.Sprintf("%s: %v", reason, err)
	}
	if reason == "" {
		reason = "fatal error"
	}
	stack := debug.Stack()
	path := writeCrashLog(reason, stack)
	log.Printf("[fatal] %s (see %s)", reason, path)
	os.Exit(1)
}

func goSafe(label string, cancel context.CancelFunc, fn func()) {
	go func() {
		defer recoverAndLog(label, cancel)
		fn()
	}()
}

func recoverAndLog(label string, cancel context.CancelFunc) {
	if r := recover(); r != nil {
		reason := fmt.Sprintf("%s panic: %v", label, r)
		stack := debug.Stack()
		path := writeCrashLog(reason, stack)
		log.Printf("[panic] %s (see %s)", reason, path)
		if cancel != nil {
			cancel()
		}
	}
}

func writeCrashLog(reason string, stack []byte) string {
	dir := crashLogDir()
	_ = os.MkdirAll(dir, 0700)
	path := filepath.Join(dir, crashLogFileName)

	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		log.Printf("[fatal] failed to open crash log %s: %v", path, err)
		return path
	}
	defer file.Close()

	timestamp := time.Now().UTC().Format(time.RFC3339)
	_, _ = fmt.Fprintf(file, "\n=== %s ===\n", timestamp)
	_, _ = fmt.Fprintf(file, "GOOS=%s GOARCH=%s\n", runtime.GOOS, runtime.GOARCH)
	_, _ = fmt.Fprintf(file, "Reason: %s\n", reason)
	if len(stack) > 0 {
		_, _ = fmt.Fprintf(file, "Stack:\n%s\n", string(stack))
	}

	return path
}

func crashLogDir() string {
	return os.TempDir()
}
