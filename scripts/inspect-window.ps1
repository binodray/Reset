param([int]$ProcessId)
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class ResetWindowInspection {
  public delegate bool Callback(IntPtr hwnd, IntPtr data);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Callback cb, IntPtr data);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, Callback cb, IntPtr data);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint process);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int length);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
}
'@
$windowRows = [System.Collections.Generic.List[object]]::new()
$seenHandles = [System.Collections.Generic.HashSet[long]]::new()
$callback = [ResetWindowInspection+Callback]{ param($handle, $data)
    [uint32]$windowPid = 0
    [void][ResetWindowInspection]::GetWindowThreadProcessId($handle, [ref]$windowPid)
    if ($windowPid -eq $ProcessId -and $seenHandles.Add($handle.ToInt64())) {
        $title = [System.Text.StringBuilder]::new(256)
        [void][ResetWindowInspection]::GetWindowText($handle, $title, 256)
        $bounds = [ResetWindowInspection+Rect]::new()
        [void][ResetWindowInspection]::GetWindowRect($handle, [ref]$bounds)
        $parent = [ResetWindowInspection]::GetAncestor($handle, 1);
        $parentTitle = [System.Text.StringBuilder]::new(256)
        [void][ResetWindowInspection]::GetWindowText($parent, $parentTitle, 256)
        $windowRows.Add([pscustomobject]@{ Handle=$handle.ToInt64(); Title=$title.ToString(); Visible=[ResetWindowInspection]::IsWindowVisible($handle);
            Left=$bounds.Left; Top=$bounds.Top; Width=$bounds.Right-$bounds.Left; Height=$bounds.Bottom-$bounds.Top;
            Parent=$parent.ToInt64(); ParentTitle=$parentTitle.ToString() })
    }
    return $true
}
$topLevelCallback = [ResetWindowInspection+Callback]{ param($handle, $data)
    [void]$callback.Invoke($handle, $data)
    [void][ResetWindowInspection]::EnumChildWindows($handle, $callback, [IntPtr]::Zero)
    return $true
}
[void][ResetWindowInspection]::EnumWindows($topLevelCallback, [IntPtr]::Zero)
$windowRows | ConvertTo-Json -Depth 3
