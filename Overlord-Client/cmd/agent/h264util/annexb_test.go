package h264util

import "testing"

func TestInspectAnnexB(t *testing.T) {
	data := []byte{
		0, 0, 0, 1, 0x67, 1, 2, 3,
		0, 0, 1, 0x68, 4, 5,
		0, 0, 0, 1, 0x65, 6, 7,
	}
	got := InspectAnnexB(data)
	if !got.HasSPS || !got.HasPPS || !got.HasIDR {
		t.Fatalf("InspectAnnexB() = %+v", got)
	}
}

func TestInspectAnnexBRejectsDeltaFrame(t *testing.T) {
	got := InspectAnnexB([]byte{0, 0, 1, 0x41, 1, 2, 3})
	if got.HasSPS || got.HasPPS || got.HasIDR {
		t.Fatalf("delta frame was misclassified: %+v", got)
	}
}
