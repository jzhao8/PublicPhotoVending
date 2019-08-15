command = "powershell.exe -nologo -command C:\Users\Administrator\Desktop\printerNotify.ps1"

Set oShell = CreateObject("Shell.Application")
oShell.ShellExecute "powershell.exe", "C:\Users\Administrator\Desktop\printerNotify.ps1", "", "runas", 0