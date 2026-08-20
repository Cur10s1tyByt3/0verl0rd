package wire

import "testing"

func TestGeneratedWireContract(t *testing.T) {
	if WireProtocolVersion != 1 {
		t.Fatalf("unexpected wire protocol version: %d", WireProtocolVersion)
	}
	if len(CommandTypes) != 143 {
		t.Fatalf("unexpected command count: %d", len(CommandTypes))
	}
	if len(CommandVersionSupport) != len(CommandTypes) {
		t.Fatalf("command version catalog has %d entries, want %d", len(CommandVersionSupport), len(CommandTypes))
	}
	for _, command := range CommandTypes {
		versionRange, ok := CommandVersionSupport[command]
		if !ok {
			t.Fatalf("missing version range for %s", command)
		}
		wantMax := 1
		switch command {
		case CommandBackstageStartBrowserInjected, CommandBackstageStartChromeInjected, CommandBackstageStartProcessInjected:
			wantMax = 2
		}
		if versionRange.Min != 1 || versionRange.Max != wantMax {
			t.Fatalf("unexpected version range for %s: %+v", command, versionRange)
		}
		if !IsSupportedCommandVersion(string(command), 1) {
			t.Fatalf("%s must support v1", command)
		}
		if IsSupportedCommandVersion(string(command), 2) != (wantMax == 2) {
			t.Fatalf("unexpected v2 support for %s", command)
		}
	}
	if !IsCommandType("desktop_start") {
		t.Fatal("desktop_start must be a known command")
	}
	if !IsCommandType("virtual_window_list") {
		t.Fatal("virtual_window_list must be a known command")
	}
	if !IsCommandType("file_upload_desktop") {
		t.Fatal("file_upload_desktop must be a known command")
	}
	if IsCommandType("not_a_command") {
		t.Fatal("unknown command was accepted")
	}
	if !IsServerToAgentMessageType("hello_ack") {
		t.Fatal("hello_ack must be a known server message")
	}
	if IsServerToAgentMessageType("console_output") {
		t.Fatal("agent-only message was accepted as a server message")
	}
}
