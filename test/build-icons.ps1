# BOOYAHX official icon pipeline (ASCII-only, no unicode dashes)
# Source: assets/branding/booyahx-logo.png (exact provided logo, untouched)
# Detects content bbox, crops to centered square (aspect preserved),
# exports favicon PNG32, apple-touch180,192,512 + temp16/48 for .ico.
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$brand = Join-Path $root 'assets\branding'
$srcPath = Join-Path $brand 'booyahx-logo.png'
if (!(Test-Path $srcPath)) { Write-Error ('source logo missing: ' + $srcPath); exit 1 }

$src = New-Object System.Drawing.Bitmap($srcPath)
$W = $src.Width; $H = $src.Height

$rect = New-Object System.Drawing.Rectangle(0, 0, $W, $H)
$data = $src.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$bytes = New-Object byte[] ($data.Stride * $H)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
$src.UnlockBits($data)

$b0 = $bytes[0]; $g0 = $bytes[1]; $r0 = $bytes[2]
$minX = $W; $maxX = 0; $minY = $H; $maxY = 0
for ($y = 0; $y -lt $H; $y++) {
  $row = $y * $data.Stride
  for ($x = 0; $x -lt $W; $x++) {
    $i = $row + $x * 3
    $d = [Math]::Abs($bytes[$i] - $b0) + [Math]::Abs($bytes[$i + 1] - $g0) + [Math]::Abs($bytes[$i + 2] - $r0)
    if ($d -gt 45) {
      if ($x -lt $minX) { $minX = $x }
      if ($x -gt $maxX) { $maxX = $x }
      if ($y -lt $minY) { $minY = $y }
      if ($y -gt $maxY) { $maxY = $y }
    }
  }
}
Write-Output ('source: ' + $W + 'x' + $H + ' content bbox: x=' + $minX + '..' + $maxX + ' y=' + $minY + '..' + $maxY + ' bg RGB=' + $r0 + ',' + $g0 + ',' + $b0)

$pad = 8
$minX = [Math]::Max(0, $minX - $pad); $minY = [Math]::Max(0, $minY - $pad)
$maxX = [Math]::Min($W - 1, $maxX + $pad); $maxY = [Math]::Min($H - 1, $maxY + $pad)
$bw = $maxX - $minX + 1; $bh = $maxY - $minY + 1
$side = [Math]::Max($bw, $bh)
$cx = [int](($minX + $maxX) / 2); $cy = [int](($minY + $maxY) / 2)
$cropX = [Math]::Max(0, [Math]::Min($W - $side, $cx - [int]($side / 2)))
$cropY = [Math]::Max(0, [Math]::Min($H - $side, $cy - [int]($side / 2)))
Write-Output ('cropped square: ' + $side + 'x' + $side + ' at ' + $cropX + ',' + $cropY + ' (aspect preserved)')

$cropRect = New-Object System.Drawing.Rectangle($cropX, $cropY, $side, $side)
$cropped = New-Object System.Drawing.Bitmap($side, $side)
$gg = [System.Drawing.Graphics]::FromImage($cropped)
$gg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$gg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$gg.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $side, $side)), $cropRect, [System.Drawing.GraphicsUnit]::Pixel)
$gg.Dispose()

function Save-IconSize {
  param([int]$Size, [string]$OutPath)
  $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $srcRect = New-Object System.Drawing.Rectangle(0, 0, $script:side, $script:side)
  $dstRect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
  $g.DrawImage($script:cropped, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $kb = [Math]::Round((Get-Item $OutPath).Length / 1KB, 1)
  Write-Output ('  wrote ' + $Size + 'x' + $Size + ': ' + (Split-Path -Leaf $OutPath) + ' (' + $kb + ' KB)')
}

Save-IconSize -Size 32 -OutPath (Join-Path $brand 'booyahx-icon.png')
Save-IconSize -Size 180 -OutPath (Join-Path $brand 'apple-touch-icon.png')
Save-IconSize -Size 192 -OutPath (Join-Path $brand 'booyahx-icon-192.png')
Save-IconSize -Size 512 -OutPath (Join-Path $brand 'booyahx-icon-512.png')
Save-IconSize -Size 16 -OutPath (Join-Path $brand '.tmp-icon-16.png')
Save-IconSize -Size 48 -OutPath (Join-Path $brand '.tmp-icon-48.png')

$cropped.Dispose(); $src.Dispose()
Write-Output 'ICON PIPELINE: DONE (source logo untouched)'
