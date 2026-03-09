//go:build !windows

package capture

type WebcamDeviceInfo struct {
	Index  int
	Name   string
	MaxFPS int
}

func ListWebcams() ([]WebcamDeviceInfo, error) {
	return []WebcamDeviceInfo{}, nil
}

func ClampWebcamFPS(_ int, requestedFPS int, _ bool) (int, error) {
	if requestedFPS < 1 {
		requestedFPS = 30
	}
	if requestedFPS > 120 {
		requestedFPS = 120
	}
	return requestedFPS, nil
}
