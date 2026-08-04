//go:build !windows

package capture

type ShellDropHit struct {
	Directory string
	ItemName  string
	Desktop   bool
}

func ResolveShellDropHit(x, y int32) ShellDropHit { return ShellDropHit{} }
