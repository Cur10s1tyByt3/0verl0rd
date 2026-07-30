//go:build turbojpeg

package capture

import (
	"bytes"
	"image"
	"image/color"

	ljpeg "github.com/pixiv/go-libjpeg/jpeg"
)

func encodeJPEG(img image.Image, quality int) ([]byte, error) {
	opts := &ljpeg.EncoderOptions{
		Quality:        jpegEncoderQuality(quality),
		OptimizeCoding: true,
		DCTMethod:      ljpeg.DCTISlow,
	}
	buf := bytes.Buffer{}
	if err := ljpeg.Encode(&buf, jpeg444Image(img), opts); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func encodeJPEGToBuf(dst *bytes.Buffer, img image.Image, quality int) error {
	opts := &ljpeg.EncoderOptions{
		Quality:        jpegEncoderQuality(quality),
		OptimizeCoding: true,
		DCTMethod:      ljpeg.DCTISlow,
	}
	return ljpeg.Encode(dst, jpeg444Image(img), opts)
}

// libjpeg preserves the source YCbCr sampling factors, unlike Go's standard
// JPEG encoder, so TurboJPEG builds can retain full chroma resolution.
func jpeg444Image(src image.Image) image.Image {
	if src == nil {
		return src
	}
	if ycbcr, ok := src.(*image.YCbCr); ok && ycbcr.SubsampleRatio == image.YCbCrSubsampleRatio444 {
		return src
	}

	bounds := src.Bounds()
	dst := image.NewYCbCr(bounds, image.YCbCrSubsampleRatio444)
	if rgba, ok := src.(*image.RGBA); ok {
		for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
			srcOffset := rgba.PixOffset(bounds.Min.X, y)
			dstOffset := dst.YOffset(bounds.Min.X, y)
			for x := 0; x < bounds.Dx(); x++ {
				i := srcOffset + x*4
				yy, cb, cr := color.RGBToYCbCr(rgba.Pix[i], rgba.Pix[i+1], rgba.Pix[i+2])
				dst.Y[dstOffset+x] = yy
				dst.Cb[dstOffset+x] = cb
				dst.Cr[dstOffset+x] = cr
			}
		}
		return dst
	}

	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			pixel := color.NRGBAModel.Convert(src.At(x, y)).(color.NRGBA)
			yy, cb, cr := color.RGBToYCbCr(pixel.R, pixel.G, pixel.B)
			offset := dst.YOffset(x, y)
			dst.Y[offset] = yy
			dst.Cb[offset] = cb
			dst.Cr[offset] = cr
		}
	}
	return dst
}
