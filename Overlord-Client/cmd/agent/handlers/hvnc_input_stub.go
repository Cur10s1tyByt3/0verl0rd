//go:build !windows

package handlers

func setCursorPosHVNC(x, y int32)        {}
func sendMouseDownHVNC(button int)       {}
func sendMouseUpHVNC(button int)         {}
func sendKeyDownHVNC(vk uint16)          {}
func sendKeyUpHVNC(vk uint16)            {}
func keyCodeToVKHVNC(code string) uint16 { return 0 }
