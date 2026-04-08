package capture

import (
	"image"
	"sync"
)

var rgbaPool sync.Pool

func GetRGBA(w, h int) *image.RGBA {
	need := w * h * 4
	if need <= 0 {
		return image.NewRGBA(image.Rect(0, 0, w, h))
	}
	if v := rgbaPool.Get(); v != nil {
		buf := v.([]byte)
		if cap(buf) >= need {
			return &image.RGBA{
				Pix:    buf[:need],
				Stride: w * 4,
				Rect:   image.Rect(0, 0, w, h),
			}
		}
	}
	return image.NewRGBA(image.Rect(0, 0, w, h))
}

func PutRGBA(img *image.RGBA) {
	if img == nil || len(img.Pix) == 0 {
		return
	}
	rgbaPool.Put(img.Pix)
}
