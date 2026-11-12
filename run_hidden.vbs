Set WshShell = CreateObject("WScript.Shell")
' Current directory context resolution
strPath = WshShell.CurrentDirectory
' Run the run.bat file in the background (0 = Hidden window, false = Async launch)
WshShell.Run "cmd.exe /c """ & strPath & "\run.bat""", 0, false
