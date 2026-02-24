# Windows foreground window metadata capture for Familiar.
# Uses Win32 APIs to get the currently active window's title and owning process.
# Returns JSON to stdout for consumption by the Node.js wrapper.
#
# IMPORTANT: Must run under Windows PowerShell 5.1 (powershell.exe), NOT PowerShell 7+ (pwsh.exe).
#
# Usage: powershell.exe -ExecutionPolicy Bypass -File windows-foreground.ps1
#
# Output format (JSON):
# {
#   "title": "CLAUDE.md - personal-command-center - Visual Studio Code",
#   "app": "code",
#   "pid": 12345
# }
# On failure: { "title": null, "app": null, "pid": null }

$ProgressPreference = 'SilentlyContinue'

# --- Load Win32 API for foreground window detection ---

Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public class FamiliarWin32 {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@

try {
    $hwnd = [FamiliarWin32]::GetForegroundWindow()

    if ($hwnd -eq [IntPtr]::Zero) {
        @{ title = $null; app = $null; pid = $null } | ConvertTo-Json -Compress
        exit 0
    }

    # Get window title.
    $sb = New-Object System.Text.StringBuilder 512
    [void][FamiliarWin32]::GetWindowText($hwnd, $sb, 512)
    $windowTitle = $sb.ToString()

    # Get owning process.
    $processId = [uint32]0
    [void][FamiliarWin32]::GetWindowThreadProcessId($hwnd, [ref]$processId)

    $appName = $null
    if ($processId -gt 0) {
        $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($proc) {
            $appName = $proc.ProcessName
        }
    }

    @{
        title = if ($windowTitle) { $windowTitle } else { $null }
        app   = if ($appName) { $appName } else { $null }
        pid   = [int]$processId
    } | ConvertTo-Json -Compress
}
catch {
    @{ title = $null; app = $null; pid = $null } | ConvertTo-Json -Compress
}
