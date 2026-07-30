package capture

import (
	"overlord-client/cmd/agent/h264util"
	"overlord-client/cmd/agent/webrtcpub"
)

func videoAccessUnitIsKey(codec string, data []byte) bool {
	if codec == "hevc" {
		return inspectHEVCAccessUnit(data).hasIRAP
	}
	return h264util.IsIDR(data)
}

type hevcAccessUnit struct {
	hasVPS  bool
	hasSPS  bool
	hasPPS  bool
	hasIRAP bool
}

func inspectHEVCAccessUnit(data []byte) hevcAccessUnit {
	var out hevcAccessUnit
	for i := 0; i+4 < len(data); {
		startCodeLen := 0
		switch {
		case data[i] == 0 && data[i+1] == 0 && data[i+2] == 1:
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
		nalType := (data[nal] >> 1) & 0x3f
		switch nalType {
		case 32:
			out.hasVPS = true
		case 33:
			out.hasSPS = true
		case 34:
			out.hasPPS = true
		default:
			if nalType >= 16 && nalType <= 21 {
				out.hasIRAP = true
			}
		}
		i = nal + 1
	}
	return out
}

func videoAccessUnitIsRecoveryPoint(codec string, data []byte) bool {
	if codec == "hevc" {
		accessUnit := inspectHEVCAccessUnit(data)
		return accessUnit.hasVPS && accessUnit.hasSPS && accessUnit.hasPPS && accessUnit.hasIRAP
	}
	accessUnit := h264util.InspectAnnexB(data)
	return accessUnit.HasSPS && accessUnit.HasPPS && accessUnit.HasIDR
}

func retainKeyframeRequestUntilOutput(kind webrtcpub.Kind, requested bool, codec string, data []byte) bool {
	isKey := videoAccessUnitIsKey(codec, data)
	if requested && !videoAccessUnitIsRecoveryPoint(codec, data) {
		webrtcpub.RequestKeyframe(kind)
	}
	return isKey
}
