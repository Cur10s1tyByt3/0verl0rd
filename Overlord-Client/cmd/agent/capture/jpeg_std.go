//go:build !turbojpeg

package capture

import (
	"bytes"
	"image"
	"image/jpeg"
	"sync"
)

var jpegBufPool = sync.Pool{
	New: func() interface{} {
		b := bytes.NewBuffer(make([]byte, 0, 128*1024))
		return b
	},
}

func encodeJPEG(img image.Image, quality int) ([]byte, error) {
	buf := jpegBufPool.Get().(*bytes.Buffer)
	buf.Reset()
	err := jpeg.Encode(buf, img, &jpeg.Options{Quality: jpegEncoderQuality(quality)})
	if err != nil {
		jpegBufPool.Put(buf)
		return nil, err
	}
	out := make([]byte, buf.Len())
	copy(out, buf.Bytes())
	jpegBufPool.Put(buf)
	return out, nil
}

func encodeJPEGToBuf(dst *bytes.Buffer, img image.Image, quality int) error {
	buf := jpegBufPool.Get().(*bytes.Buffer)
	buf.Reset()
	if err := jpeg.Encode(buf, img, &jpeg.Options{Quality: jpegEncoderQuality(quality)}); err != nil {
		jpegBufPool.Put(buf)
		return err
	}
	dst.Write(buf.Bytes())
	jpegBufPool.Put(buf)
	return nil
}
