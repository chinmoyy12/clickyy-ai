# Renders the original Clickyy icon (a warm orb with a thin champagne ring) to PNG at 512 px.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$size = 512
$out = Join-Path $PSScriptRoot '..\apps\desktop\resources\icon.png'
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::Transparent)

$bgPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 110; $w = $size
$bgPath.AddArc(0, 0, $r, $r, 180, 90); $bgPath.AddArc($w - $r, 0, $r, $r, 270, 90)
$bgPath.AddArc($w - $r, $w - $r, $r, $r, 0, 90); $bgPath.AddArc(0, $w - $r, $r, $r, 90, 90); $bgPath.CloseFigure()
$g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 16, 17, 20))), $bgPath)

$glow = New-Object System.Drawing.Drawing2D.GraphicsPath
$glow.AddEllipse(56, 56, 400, 400)
$pg = New-Object System.Drawing.Drawing2D.PathGradientBrush $glow
$pg.CenterColor = [System.Drawing.Color]::FromArgb(90, 212, 163, 115)
$pg.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 212, 163, 115))
$g.FillPath($pg, $glow)

$orb = New-Object System.Drawing.Drawing2D.GraphicsPath
$orb.AddEllipse(136, 136, 240, 240)
$ob = New-Object System.Drawing.Drawing2D.PathGradientBrush $orb
$ob.CenterPoint = New-Object System.Drawing.PointF 210, 200
$ob.CenterColor = [System.Drawing.Color]::FromArgb(255, 74, 60, 44)
$ob.SurroundColors = @([System.Drawing.Color]::FromArgb(255, 18, 18, 20))
$g.FillPath($ob, $orb)
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 212, 163, 115)), 9
$g.DrawEllipse($pen, 136, 136, 240, 240)
$pen2 = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(120, 142, 216, 232)), 4
$g.DrawArc($pen2, 108, 108, 296, 296, 200, 70)

$g.Dispose()
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "wrote $out"
