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
	err := jpeg.Encode(buf, img, &jpeg.Options{Quality: quality})
	if err != nil {
		jpegBufPool.Put(buf)
		return nil, err
	}
	out := make([]byte, buf.Len())
	copy(out, buf.Bytes())
	jpegBufPool.Put(buf)
	return out, nil
}
