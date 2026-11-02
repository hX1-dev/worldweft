# Starts the player-dialogue chat window (player_dialogue_chat.mjs), listening on 127.0.0.1 only.
# With -KeyFile, the DeepSeek key is read from that file into this process's environment only
# (never printed or logged) and the NPCs call DeepSeek; without it the chat runs dry.
param(
  [string]$KeyFile = '',
  [int]$Port = 8766
)
$ErrorActionPreference = 'Stop'
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  $node = (Get-ChildItem "$env:LOCALAPPDATA\OpenAI\Codex\runtimes\cua_node\*\bin\node.exe" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
}
if (-not $node) { throw 'node_not_found' }
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..\..'))
$nodeArgs = @('--experimental-specifier-resolution=node', '--loader', 'ts-node/esm', 'godot-taixu-client/tools/player_dialogue_chat.mjs', '--port', "$Port")
if ($KeyFile) {
  $key = (Get-Content -LiteralPath $KeyFile -Raw).Trim().Trim('"').Trim("'").Trim()
  if ($key.Length -lt 16 -or $key -match '\s') { throw 'key_file_invalid' }
  $env:XIANXIA_PI_NPC_DEEPSEEK_API_KEY = $key
  $key = $null
} else {
  $nodeArgs += '--dry'
}
$env:NODE_NO_WARNINGS = '1'
# Node's stderr must not stop this script (PowerShell 5.1 turns it into errors).
$ErrorActionPreference = 'Continue'
& $node @nodeArgs 2>&1 | ForEach-Object { "$_" }
$code = $LASTEXITCODE
$env:XIANXIA_PI_NPC_DEEPSEEK_API_KEY = $null
exit $code
