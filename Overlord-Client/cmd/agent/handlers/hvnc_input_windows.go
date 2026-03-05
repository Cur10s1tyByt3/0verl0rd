//go:build windows

package handlers

func keyCodeToVKHVNC(code string) uint16 {
	return keyCodeToVK(code)
}
