package handlers

import "encoding/json"

func extractTimestamp(v interface{}) int64 {
	switch t := v.(type) {
	case uint64:
		if t <= uint64(^uint64(0)>>1) {
			return int64(t)
		}
		return 0
	case uint32:
		return int64(t)
	case uint16:
		return int64(t)
	case uint8:
		return int64(t)
	case int64:
		return t
	case int32:
		return int64(t)
	case int16:
		return int64(t)
	case int8:
		return int64(t)
	case int:
		return int64(t)
	case float64:
		return int64(t)
	case float32:
		return int64(t)
	case json.Number:
		if n, err := t.Int64(); err == nil {
			return n
		}
	}
	return 0
}
