package main

import "time"

func sleepObfuscated(seconds int) {
	if seconds <= 0 {
		return
	}
	const slice = 500 * time.Millisecond
	end := time.Now().Add(time.Duration(seconds) * time.Second)
	for {
		remaining := time.Until(end)
		if remaining <= 0 {
			return
		}
		next := remaining
		if next > slice {
			next = slice
		}
		time.Sleep(next)
	}
}
