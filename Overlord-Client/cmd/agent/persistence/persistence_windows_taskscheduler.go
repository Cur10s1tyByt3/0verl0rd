//go:build windows && persist_taskscheduler
// +build windows,persist_taskscheduler

package persistence

import (
	"fmt"
	"strings"
)

func init() {
	persistInstallFn = installTaskScheduler
	persistUninstallFns = append(persistUninstallFns, uninstallTaskScheduler)
}

func installTaskScheduler(targetPath string) error {
	taskName := deriveTaskName(targetPath)
	safe := strings.ReplaceAll(targetPath, "'", "''")
	script := fmt.Sprintf(
		`$a = New-ScheduledTaskAction -Execute '%s'; `+
			`$t = New-ScheduledTaskTrigger -AtLogOn; `+
			`$s = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable; `+
			`Register-ScheduledTask -TaskName '%s' -Action $a -Trigger $t -Settings $s -Force | Out-Null`,
		safe, taskName)
	return runPowerShell(script)
}

func uninstallTaskScheduler() error {
	return runPowerShell(
		`Get-ScheduledTask -ErrorAction SilentlyContinue | ` +
			`Where-Object { $_.TaskName -like 'ovd_*' } | ` +
			`Unregister-ScheduledTask -Confirm:$false -ErrorAction SilentlyContinue`)
}
