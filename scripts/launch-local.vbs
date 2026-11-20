Option Explicit
Dim shell, command
Set shell = CreateObject("WScript.Shell")
command = """" & WScript.Arguments(0) & """ """ & WScript.Arguments(1) & """"
If WScript.Arguments.Count = 3 Then
  If WScript.Arguments(2) = "--share-with-talentee" Then command = command & " --share-with-talentee"
End If
WScript.Quit shell.Run(command, 0, True)
