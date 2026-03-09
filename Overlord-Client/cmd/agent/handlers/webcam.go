package handlers

import (
	"context"
	"log"
	"time"

	"overlord-client/cmd/agent/capture"
	rt "overlord-client/cmd/agent/runtime"
)

func WebcamStart(ctx context.Context, env *rt.Env) error {
	fps := env.WebcamFPS
	if fps <= 0 {
		fps = 30
	}
	if env.WebcamUseMaxFPS {
		fps = 60
	}
	if fps > 120 {
		fps = 120
	}
	interval := time.Second / time.Duration(fps)
	log.Printf("webcam: starting stream (max fps %d)", fps)
	defer capture.CleanupWebcam()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	lastErrText := ""
	lastErrLogAt := time.Time{}

	for {
		select {
		case <-ctx.Done():
			log.Printf("webcam: stopping stream")
			return nil
		case <-ticker.C:
			if err := capture.NowWebcam(ctx, env); err != nil {
				if ctx.Err() != nil {
					log.Printf("webcam: stopping stream")
					return nil
				}
				errText := err.Error()
				now := time.Now()
				if errText != lastErrText || now.Sub(lastErrLogAt) >= 2*time.Second {
					log.Printf("webcam: capture error: %v", err)
					lastErrText = errText
					lastErrLogAt = now
				}
			} else {
				lastErrText = ""
				lastErrLogAt = time.Time{}
			}
		}
	}
}
