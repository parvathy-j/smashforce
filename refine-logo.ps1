Add-Type -AssemblyName System.Drawing

$src = 'SmashCourt Badminton Centre logo 3.png'
$dst = 'smashcourt-logo-transparent.png'

$orig = [System.Drawing.Bitmap]::FromFile($src)
$bmp = New-Object System.Drawing.Bitmap($orig.Width, $orig.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.DrawImage($orig, 0, 0, $orig.Width, $orig.Height)
$g.Dispose()
$orig.Dispose()

function IsBg([System.Drawing.Color]$c) {
  $max = [Math]::Max($c.R, [Math]::Max($c.G, $c.B))
  $min = [Math]::Min($c.R, [Math]::Min($c.G, $c.B))
  return ($c.A -gt 0 -and $c.R -ge 238 -and $c.G -ge 238 -and $c.B -ge 238 -and ($max - $min) -le 20)
}

$w = $bmp.Width
$h = $bmp.Height
$q = New-Object 'System.Collections.Generic.Queue[System.Drawing.Point]'

function Mark([int]$x, [int]$y) {
  $c = $bmp.GetPixel($x, $y)
  if (IsBg $c) {
    $bmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, $c.R, $c.G, $c.B))
    $q.Enqueue([System.Drawing.Point]::new($x, $y))
  }
}

for ($x = 0; $x -lt $w; $x++) {
  Mark $x 0
  Mark $x ($h - 1)
}
for ($y = 0; $y -lt $h; $y++) {
  Mark 0 $y
  Mark ($w - 1) $y
}

while ($q.Count -gt 0) {
  $p = $q.Dequeue()
  $x = $p.X
  $y = $p.Y

  if ($x -gt 0) { Mark ($x - 1) $y }
  if ($x -lt ($w - 1)) { Mark ($x + 1) $y }
  if ($y -gt 0) { Mark $x ($y - 1) }
  if ($y -lt ($h - 1)) { Mark $x ($y + 1) }
}

$bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "Updated $dst with tuned edge cleanup"
