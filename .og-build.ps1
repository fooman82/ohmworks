Add-Type -AssemblyName System.Drawing
$root = 'c:\inetpub\ohmworks\public\images'
$W = 1200; $H = 630
$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'HighQuality'; $g.InterpolationMode = 'HighQualityBicubic'
$g.Clear([System.Drawing.Color]::Black)
$logo = [System.Drawing.Image]::FromFile("$root\logo.jpg")
$name = [System.Drawing.Image]::FromFile("$root\logo_name.jpg")
$lh = 340; $lw = [int]($logo.Width * $lh / $logo.Height)
$nw = 840; $nh = [int]($name.Height * $nw / $name.Width)
$gap = 40; $top = [int](($H - ($lh + $gap + $nh)) / 2)
$g.DrawImage($logo, [int](($W - $lw) / 2), $top, $lw, $lh)
$g.DrawImage($name, [int](($W - $nw) / 2), $top + $lh + $gap, $nw, $nh)
$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters 1
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]95)
$out = "$root\og-image.jpg"
$bmp.Save($out, $enc, $ep)
$g.Dispose(); $bmp.Dispose(); $logo.Dispose(); $name.Dispose()

$chk = [System.Drawing.Bitmap]::FromFile($out)
$pts = @(@(0,0), @(1199,0), @(0,629), @(1199,629), @(600,5), @(5,315), @(1194,315), @(600,624), @(300,100), @(900,500))
$lines = @("size $($chk.Width)x$($chk.Height) bytes $((Get-Item $out).Length)")
foreach ($pt in $pts) { $px = $chk.GetPixel($pt[0], $pt[1]); $lines += "($($pt[0]),$($pt[1])) = $($px.R),$($px.G),$($px.B)" }
$chk.Dispose()
$lines | Set-Content "$env:TEMP\og.txt"
