#script is called when printer has a job queque >0
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope LocalMachine

#http://systemmanager.ru/bv-admin.en/dscript/printerstatuscodes.htm
$printstatus

Function GetPrintStatus
{
 return Get-WmiObject -Class Win32_Printer | WHERE {$_.Name -eq "EPSON PM-400 Series"} |Select -ExpandProperty PrinterState
}

#GetPrintStatus -printstate ($printstatus)


##retrive list of printers and their statuses
#$printstatus Get-WmiObject -Class Win32_Printer | WHERE {$_.Name -eq "EPSON PM-400 Series"} |select -ExpandProperty PrinterState
#we are assuming we are passing by reference

$servMsg = @{} #server Message variable, holds message to be sent depending on error or success

Function setServMsg ($sendMsg)
{
 $servMsg.Value= $sendMsg
}


DO
{
 $printstatus = GetPrintStatus
 switch ($printstatus)
 #what is happening is the printer status is earlier than actual print. we can either add a delay or tweak the settigs, regrettably PrinterState vs PrinterStatus doesn't seem to make a difference
 {
  0 {setServMsg -sendMsg 'success'; Break} #PrinterReady breaks the loop

  1 {setServMsg -sendMsg 'test'; Break}

  2 {setServMsg -sendMsg 'fail'; Break} #PrinterError

  8 {setServMsg -sendMsg 'fail'; Break} #PaperJam

 }
 Start-Sleep -s 1 #pauses script for 1 sec
} While ($printstatus -ne 0) #check for errors via print status, pause the stuff as well.
$servMsg.Value
$webResponse = Invoke-WebRequest -Uri "https://fast-forest-99052.herokuapp.com/print_status?msg=$($servMsg.Value)" -Method POST

$stopWatch = New-Object System.Diagnostics.Stopwatch
$stopWatch.Start()

DO {

  If ($stopWatch.ElapsedMilliseconds -eq 3000) {
   $webResponse
   $stopWatch.Restart()
  }

   If ($webResponse.StatusCode -eq 200){
  $stopWatch.Stop()
  stop-process -Id $PID #closes the powershell process, probably do this after we get statuscode back
}


} While ($true -eq $true)

