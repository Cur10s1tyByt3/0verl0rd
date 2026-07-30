package capture

func jpegEncoderQuality(quality int) int {
	if quality < 1 {
		quality = 1
	}
	if quality > 100 {
		quality = 100
	}
	deficit := 100 - quality
	return 100 - (deficit*deficit+99)/100
}
