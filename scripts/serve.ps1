<#
  K-JAMDS 시뮬레이터 — Windows 내장 PowerShell 정적 서버 (설치 불필요)

  serve.sh는 bash 전용이라 Windows에서 더블클릭하면 메모장이 열린다. 이 스크립트는
  Windows에 기본 포함된 .NET HttpListener만 써서 같은 일을 한다 — Python·Node·git 불요.

  실행:  scripts\serve.bat        (더블클릭, 권장)
     또는 powershell -ExecutionPolicy Bypass -File scripts\serve.ps1 [포트]

  중지: 이 창에서 Ctrl+C
#>
param([int]$Port = 8000)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

# ES module Worker(sim-worker.mjs)는 MIME이 text/javascript가 아니면 로드에 실패한다.
$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.htm' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8';   '.json' = 'application/json; charset=utf-8'
  '.md'   = 'text/markdown; charset=utf-8'; '.svg' = 'image/svg+xml'
  '.png'  = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.gif' = 'image/gif'
  '.ico'  = 'image/x-icon'; '.pdf' = 'application/pdf'; '.woff2' = 'font/woff2'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
try { $listener.Start() }
catch {
  Write-Host "포트 $Port 를 열 수 없습니다. 다른 포트로 실행하세요:  scripts\serve.bat 9000" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "K-JAMDS 시뮬레이터 로컬 서버 시작 → http://localhost:$Port" -ForegroundColor Green
Write-Host "  루트: $root"
Write-Host "  중지: 이 창에서 Ctrl+C"
Write-Host ""
try { Start-Process "http://localhost:$Port/" } catch { }

while ($listener.IsListening) {
  try { $ctx = $listener.GetContext() } catch { break }
  try {
    # 한글 파일명(docs/모의논리서.html)이 있어 URL 디코딩이 필요하다.
    $rel = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($rel -eq '') { $rel = 'index.html' }
    $path = Join-Path $root ($rel -replace '/', '\')
    if ((Test-Path $path -PathType Container)) { $path = Join-Path $path 'index.html' }

    # 저장소 밖 경로 요청 차단
    $full = [System.IO.Path]::GetFullPath($path)
    if (-not $full.StartsWith([System.IO.Path]::GetFullPath($root), [StringComparison]::OrdinalIgnoreCase)) {
      $ctx.Response.StatusCode = 403; $ctx.Response.Close(); continue
    }

    if (Test-Path $full -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      $ctx.Response.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $rel")
      $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
    }
  } catch {
    try { $ctx.Response.StatusCode = 500 } catch { }
  } finally {
    try { $ctx.Response.Close() } catch { }
  }
}
$listener.Stop()
