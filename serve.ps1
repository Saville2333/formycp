# Cthulhu Table — 零依赖本地静态服务器（仅用于开发预览）
#
# 浏览器的 ES Module 安全策略禁止从 file:// 加载模块，
# 因此本地预览需要一个极简的 HTTP 静态服务器。它不是应用后端：
# 只把当前目录中的静态文件发送给浏览器；GitHub Pages 不需要它。
#
# 用法：powershell -ExecutionPolicy Bypass -File .\serve.ps1 -Port 8000
# 或双击「启动本地预览.bat」。

param(
  [int]$Port = 8000,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path $PSScriptRoot).Path.TrimEnd('\')
$listener = $null

function Get-MimeType([string]$path) {
  switch ([System.IO.Path]::GetExtension($path).ToLowerInvariant()) {
    '.html' { return 'text/html; charset=utf-8' }
    '.css'  { return 'text/css; charset=utf-8' }
    '.js'   { return 'text/javascript; charset=utf-8' }
    '.mjs'  { return 'text/javascript; charset=utf-8' }
    '.json' { return 'application/json; charset=utf-8' }
    '.svg'  { return 'image/svg+xml' }
    '.png'  { return 'image/png' }
    '.jpg'  { return 'image/jpeg' }
    '.jpeg' { return 'image/jpeg' }
    '.webp' { return 'image/webp' }
    '.ico'  { return 'image/x-icon' }
    '.woff' { return 'font/woff' }
    '.woff2' { return 'font/woff2' }
    '.txt'  { return 'text/plain; charset=utf-8' }
    '.md'   { return 'text/markdown; charset=utf-8' }
    default { return 'application/octet-stream' }
  }
}

function Send-Response([System.Net.Sockets.NetworkStream]$stream, [int]$status, [string]$contentType, [byte[]]$body, [bool]$headOnly) {
  $reason = switch ($status) {
    200 { 'OK' }
    400 { 'Bad Request' }
    403 { 'Forbidden' }
    404 { 'Not Found' }
    405 { 'Method Not Allowed' }
    default { 'Error' }
  }
  $header = "HTTP/1.1 $status $reason`r`nContent-Type: $contentType`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`nConnection: close`r`n`r`n"
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
  $stream.Write($headerBytes, 0, $headerBytes.Length)
  if (-not $headOnly -and $body.Length -gt 0) {
    $stream.Write($body, 0, $body.Length)
  }
  $stream.Flush()
}

try {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
  $listener.Start()
} catch {
  Write-Host ""
  Write-Host "无法启动本地服务器：$($_.Exception.Message)" -ForegroundColor Red
  Write-Host "端口 $Port 可能已被占用。可改用：powershell -ExecutionPolicy Bypass -File .\serve.ps1 -Port 8080"
  exit 1
}

$url = "http://127.0.0.1:$Port/"
Write-Host ""
Write-Host "  Cthulhu Table · 本地预览" -ForegroundColor Yellow
Write-Host "  $url" -ForegroundColor Cyan
Write-Host "  根目录：$root"
Write-Host "  按 Ctrl+C 停止服务器。" -ForegroundColor DarkGray
Write-Host ""

if (-not $NoBrowser) {
  Start-Process $url
}

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    $stream = $null
    $reader = $null
    try {
      $client.ReceiveTimeout = 15000
      $stream = $client.GetStream()
      $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
      $requestLine = $reader.ReadLine()
      if ([string]::IsNullOrWhiteSpace($requestLine)) {
        $client.Close()
        continue
      }

      $parts = $requestLine.Split(' ')
      if ($parts.Length -lt 2) {
        $body = [System.Text.Encoding]::UTF8.GetBytes('Bad Request')
        Send-Response $stream 400 'text/plain; charset=utf-8' $body $false
        continue
      }

      $method = $parts[0].ToUpperInvariant()
      $rawPath = $parts[1].Split('?')[0]
      $headOnly = ($method -eq 'HEAD')

      while ($true) {
        $line = $reader.ReadLine()
        if ($null -eq $line -or $line -eq '') { break }
      }

      if ($method -ne 'GET' -and $method -ne 'HEAD') {
        $body = [System.Text.Encoding]::UTF8.GetBytes('Method Not Allowed')
        Send-Response $stream 405 'text/plain; charset=utf-8' $body $false
        continue
      }

      $decoded = [System.Uri]::UnescapeDataString($rawPath)
      if ($decoded -eq '/' -or [string]::IsNullOrWhiteSpace($decoded)) {
        $decoded = '/index.html'
      }

      $relative = $decoded.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
      $fullPath = [System.IO.Path]::GetFullPath((Join-Path $root $relative))
      $isInside = $fullPath.Equals($root, [System.StringComparison]::OrdinalIgnoreCase) -or $fullPath.StartsWith($root + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)

      if (-not $isInside) {
        $body = [System.Text.Encoding]::UTF8.GetBytes('Forbidden')
        Send-Response $stream 403 'text/plain; charset=utf-8' $body $headOnly
        continue
      }

      if (Test-Path -LiteralPath $fullPath -PathType Container) {
        $fullPath = Join-Path $fullPath 'index.html'
      }

      if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        $body = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found`n`n$decoded")
        Send-Response $stream 404 'text/plain; charset=utf-8' $body $headOnly
        continue
      }

      $bytes = [System.IO.File]::ReadAllBytes($fullPath)
      Send-Response $stream 200 (Get-MimeType $fullPath) $bytes $headOnly
    } catch {
      # 单个请求失败不应终止整个预览服务器。
      Write-Host "请求处理失败：$($_.Exception.Message)" -ForegroundColor DarkYellow
    } finally {
      if ($reader) { $reader.Dispose() }
      if ($stream) { $stream.Dispose() }
      if ($client) { $client.Close() }
    }
  }
} finally {
  if ($listener) { $listener.Stop() }
  Write-Host ""
  Write-Host "本地服务器已停止。" -ForegroundColor DarkGray
}
