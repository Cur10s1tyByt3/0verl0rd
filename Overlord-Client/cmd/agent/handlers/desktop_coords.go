package handlers

import "overlord-client/cmd/agent/capture"

func resolveDesktopPoint(display int, x, y int32) (int32, int32) {
	bounds := capture.DisplayBounds(display)
	if bounds.Dx() <= 0 || bounds.Dy() <= 0 {
		return x, y
	}

	absX := int32(bounds.Min.X) + x
	absY := int32(bounds.Min.Y) + y

	if absX < int32(bounds.Min.X) {
		absX = int32(bounds.Min.X)
	}
	if absY < int32(bounds.Min.Y) {
		absY = int32(bounds.Min.Y)
	}
	if absX >= int32(bounds.Max.X) {
		absX = int32(bounds.Max.X - 1)
	}
	if absY >= int32(bounds.Max.Y) {
		absY = int32(bounds.Max.Y - 1)
	}

	return absX, absY
}
