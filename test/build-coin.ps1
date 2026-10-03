# BOOYAHX - BX COIN icon pipeline (ASCII-only)
# Source: "Crowned BX Coin Emblem.png" (official artwork, read-only, never altered)
# The source is square 1254x1254 Format32bppArgb - it already carries its own
# alpha (transparent/soft background), so NO masking, cropping or compositing is
# applied: every output is a pure high-quality downscale of the original pixels.
# Method: progressive bicubic halving (each step InterpolationMode.HighQualityBicubic,
# PixelOffsetMode.HighQuality, SmoothingMode.HighQuality) down to <= 2x the target,
# then one final exact-size bicubic resize. GDI+ interpolates over premultiplied
# alpha, so transparency is preserved without dark fringing.
# Exports: bx-coin.png (256), bx-coin-small.png (64), bx-coin-192.png, bx-coin-512.png
# Idempotent - regenerates derived icons only; source artwork is untouched.
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$brand = Join-Path $root 'assets\branding'
$srcPath = 'C:\Users\madik\Downloads\Crowned BX Coin Emblem.png'
if (!(Test-Path $srcPath)) { Write-Error ('source coin art missing: ' + $srcPath); exit 1 }
if (!(Test-Path $brand)) { New-Item -ItemType Directory -Path $brand | Out-Null }

$src = New-Object System.Drawing.Bitmap($srcPath)
$srcW = $src.Width; $srcH = $src.Height
if ($srcW -ne $srcH) { Write-Error ('source is not square: ' + $srcW + 'x' + $srcH); exit 1 }
Write-Output ('source: ' + $srcPath + ' (' + $srcW + 'x' + $srcH + ', ' + $src.PixelFormat + ')')

function New-HqBitmap {
  param([System.Drawing.Image]$Img, [int]$Size)
  $out = New-Object System.Drawing.Bitmap($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($out)
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
  $srcRect = New-Object System.Drawing.Rectangle(0, 0, $Img.Width, $Img.Height)
  $dstRect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
  $g.DrawImage($Img, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  return $out
}

function Save-Coin {
  param([int]$Size, [string]$OutPath)
  # progressive halving: step down while the current canvas is more than 2x target
  $cur = $src
  $own = $false
  while (($cur.Width -gt ($Size * 2)) -and ($cur.Width -gt $Size)) {
    $next = New-HqBitmap $cur ([int][Math]::Floor($cur.Width / 2))
    if ($own) { $cur.Dispose() }
    $cur = $next
    $own = $true
  }
  $final = New-HqBitmap $cur $Size
  if ($own) { $cur.Dispose() }
  $final.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $final.Dispose()
  $kb = [Math]::Round((Get-Item $OutPath).Length / 1KB, 1)
  Write-Output ('  wrote ' + $Size + 'x' + $Size + ': ' + $OutPath + ' (' + $kb + ' KB)')
}

Save-Coin 256 (Join-Path $brand 'bx-coin.png')
Save-Coin 64  (Join-Path $brand 'bx-coin-small.png')
Save-Coin 192 (Join-Path $brand 'bx-coin-192.png')
Save-Coin 512 (Join-Path $brand 'bx-coin-512.png')

$src.Dispose()
Write-Output 'BX COIN PIPELINE: DONE (source artwork untouched)'
