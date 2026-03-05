package capture

import "image"

type MonitorInfo struct {
	Width  int `msgpack:"width"`
	Height int `msgpack:"height"`
}

func DisplayBounds(idx int) image.Rectangle {
	return displayBounds(idx)
}

func DisplayScale(idx int) float64 {
	return displayScale(idx)
}
