//go:build windows

package capture

import (
	"fmt"
	"math"

	cam "github.com/Kirizu-Official/windows-camera-go/camera/v1"
)

type WebcamDeviceInfo struct {
	Index  int
	Name   string
	MaxFPS int
}

func ListWebcams() ([]WebcamDeviceInfo, error) {
	webcamMu.Lock()
	defer webcamMu.Unlock()

	temporaryInit := false
	if !webcamInitDone {
		if err := cam.Init(); err != nil {
			return nil, fmt.Errorf("webcam init failed: %w", err)
		}
		webcamInitDone = true
		temporaryInit = true
	}

	devices, err := cam.EnumDevice()
	if err != nil {
		if temporaryInit && webcamActive == nil {
			cam.Shutdown()
			webcamInitDone = false
		}
		return nil, fmt.Errorf("webcam enumerate failed: %w", err)
	}

	out := make([]WebcamDeviceInfo, 0, len(devices))
	for i, dev := range devices {
		name := dev.Name
		if name == "" {
			name = fmt.Sprintf("Camera %d", i+1)
		}
		maxFPS := 30
		if webcamActive != nil && webcamActive.deviceIndex == i && webcamActive.captureFPS > 0 {
			maxFPS = int(math.Round(webcamActive.captureFPS))
		} else if fps, fpsErr := webcamMaxSupportedFPSNoLock(dev.SymbolLink); fpsErr == nil && fps > 0 {
			maxFPS = fps
		}
		out = append(out, WebcamDeviceInfo{Index: i, Name: name, MaxFPS: maxFPS})
	}

	if temporaryInit && webcamActive == nil {
		cam.Shutdown()
		webcamInitDone = false
	}

	return out, nil
}

func ClampWebcamFPS(deviceIndex int, requestedFPS int, useMax bool) (int, error) {
	if requestedFPS < 1 {
		requestedFPS = 30
	}
	if requestedFPS > 120 {
		requestedFPS = 120
	}

	maxFPS, err := webcamMaxSupportedFPS(deviceIndex)
	if err != nil {
		return requestedFPS, err
	}
	if maxFPS <= 0 {
		return requestedFPS, nil
	}
	if useMax || requestedFPS > maxFPS {
		return maxFPS, nil
	}
	return requestedFPS, nil
}

func webcamMaxSupportedFPS(deviceIndex int) (int, error) {
	webcamMu.Lock()
	defer webcamMu.Unlock()

	if webcamActive != nil && webcamActive.deviceIndex == deviceIndex && webcamActive.captureFPS > 0 {
		return int(math.Round(webcamActive.captureFPS)), nil
	}

	temporaryInit := false
	if !webcamInitDone {
		if err := cam.Init(); err != nil {
			return 0, fmt.Errorf("webcam init failed: %w", err)
		}
		webcamInitDone = true
		temporaryInit = true
	}

	devices, err := cam.EnumDevice()
	if err != nil {
		if temporaryInit && webcamActive == nil {
			cam.Shutdown()
			webcamInitDone = false
		}
		return 0, fmt.Errorf("webcam enumerate failed: %w", err)
	}
	if len(devices) == 0 {
		if temporaryInit && webcamActive == nil {
			cam.Shutdown()
			webcamInitDone = false
		}
		return 0, fmt.Errorf("no webcam devices detected")
	}
	if deviceIndex < 0 || deviceIndex >= len(devices) {
		deviceIndex = 0
	}

	maxFPS, err := webcamMaxSupportedFPSNoLock(devices[deviceIndex].SymbolLink)
	if err != nil {
		if temporaryInit && webcamActive == nil {
			cam.Shutdown()
			webcamInitDone = false
		}
		return 0, err
	}

	if temporaryInit && webcamActive == nil {
		cam.Shutdown()
		webcamInitDone = false
	}

	return maxFPS, nil
}

func webcamMaxSupportedFPSNoLock(symbolLink string) (int, error) {
	device, err := cam.OpenDevice(symbolLink)
	if err != nil {
		return 0, fmt.Errorf("open webcam failed: %w", err)
	}
	defer device.CloseDevice()

	formats, err := device.EnumerateCaptureFormats()
	if err != nil {
		return 0, fmt.Errorf("enumerate webcam formats failed: %w", err)
	}

	maxFPS := 0
	for _, format := range formats {
		if !isJPEGSubtype(format) && !isH264Subtype(format) {
			continue
		}
		fps := int(math.Round(format.Fps))
		if fps > maxFPS {
			maxFPS = fps
		}
	}

	return maxFPS, nil
}
