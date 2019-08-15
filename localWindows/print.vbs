protoURI = Mid(WScript.Arguments(0), InStr(WScript.Arguments(0),":")+1)
printData = Split(protoURI, "/")

category = printData(0)

filename = printData(1)

filepath = "C:\Users\Administrator\Desktop\PrintPhotos\" & category & "\" & filename

Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """C:\Users\Administrator\Desktop\fileprint.bat"" " & filepath, 0