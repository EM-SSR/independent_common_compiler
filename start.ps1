# Common scope notebook を起動する
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
python "$here\server.py"
