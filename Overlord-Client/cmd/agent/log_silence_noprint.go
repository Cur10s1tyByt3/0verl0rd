//go:build noprint
// +build noprint

package main

import (
	"io"
	"log"
	"os"
)

var devNullFile *os.File

func init() {
	log.SetOutput(io.Discard)

	file, err := os.OpenFile(os.DevNull, os.O_WRONLY, 0)
	if err != nil {
		return
	}
	devNullFile = file
	os.Stdout = file
	os.Stderr = file
}
