$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Wrapper = Join-Path $ScriptDir "claude-yh.js"

& node $Wrapper @args
exit $LASTEXITCODE
