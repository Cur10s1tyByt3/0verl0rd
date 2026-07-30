package h264util

type AccessUnit struct {
	HasSPS bool
	HasPPS bool
	HasIDR bool
}

func InspectAnnexB(data []byte) AccessUnit {
	var out AccessUnit
	for i := 0; i+3 < len(data); {
		startCodeLen := 0
		switch {
		case i+3 < len(data) && data[i] == 0 && data[i+1] == 0 && data[i+2] == 1:
			startCodeLen = 3
		case i+4 < len(data) && data[i] == 0 && data[i+1] == 0 && data[i+2] == 0 && data[i+3] == 1:
			startCodeLen = 4
		}
		if startCodeLen == 0 {
			i++
			continue
		}
		nal := i + startCodeLen
		if nal >= len(data) {
			break
		}
		switch data[nal] & 0x1f {
		case 5:
			out.HasIDR = true
		case 7:
			out.HasSPS = true
		case 8:
			out.HasPPS = true
		}
		if out.HasSPS && out.HasPPS && out.HasIDR {
			return out
		}
		i = nal + 1
	}
	return out
}

func IsIDR(data []byte) bool {
	return InspectAnnexB(data).HasIDR
}
