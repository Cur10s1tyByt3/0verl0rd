package handlers

import (
	"context"
	"log"
	"overlord-client/cmd/agent/capture"
	rt "overlord-client/cmd/agent/runtime"
	"sync"
	"time"
)

var (
	persistedDisplayValue int
	persistedDisplayMu    sync.Mutex
)

func persistDisplaySelection(display int) {
	persistedDisplayMu.Lock()
	persistedDisplayValue = display
	persistedDisplayMu.Unlock()
}

func GetPersistedDisplay() int {
	persistedDisplayMu.Lock()
	defer persistedDisplayMu.Unlock()
	return persistedDisplayValue
}

func DesktopStart(ctx context.Context, env *rt.Env) error {
	interval, fps := streamInterval("OVERLORD_DESKTOP_MAX_FPS", 120)
	if fps < 60 {
		fps = 60
		interval = time.Second / time.Duration(fps)
	}
	capture.SetH264TargetFPS(fps)
	log.Printf("desktop: starting stream (target fps %d)", fps)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			log.Printf("desktop: stopping stream")
			return nil
		case <-ticker.C:
			if err := capture.Now(ctx, env); err != nil {
				if ctx.Err() != nil {
					log.Printf("desktop: stopping stream")
					return nil
				}
				log.Printf("desktop: capture error: %v", err)
			}
		}
	}
}

func DesktopSelect(ctx context.Context, env *rt.Env, display int) error {
	prev := env.SelectedDisplay
	maxDisplays := capture.MonitorCount()
	if display < 0 || display >= maxDisplays {
		log.Printf("desktop: WARNING - requested display %d out of range (0-%d), clamping to 0", display, maxDisplays-1)
		display = 0
	}
	env.SelectedDisplay = display

	persistDisplaySelection(display)
	if prev != display {
		capture.ResetPrev()
		capture.ResetDesktopCapture()
	}
	log.Printf("desktop: set selected display from %d to %d (reported monitors=%d, will capture monitor at index %d)", prev, display, maxDisplays, display)
	return nil
}

func DesktopMouseControl(ctx context.Context, env *rt.Env, enabled bool) error {
	env.MouseControl = enabled
	return nil
}

func DesktopKeyboardControl(ctx context.Context, env *rt.Env, enabled bool) error {
	env.KeyboardControl = enabled
	return nil
}

func DesktopCursorControl(ctx context.Context, env *rt.Env, enabled bool) error {
	env.CursorCapture = enabled
	capture.SetCursorCapture(enabled)
	return nil
}

func DesktopDuplicationControl(ctx context.Context, env *rt.Env, enabled bool) error {
	env.DesktopDuplication = enabled
	capture.SetDesktopDuplication(enabled)
	capture.ResetPrev()
	capture.ResetDesktopCapture()
	capture.ResetMonitorCache()
	return nil
}
