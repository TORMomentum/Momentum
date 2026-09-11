# Save whatever image is on the clipboard to a file, downscaled.
#
#   powershell -STA -File tools/clip_shot.ps1
#
# WHY THIS EXISTS. Pasting a screenshot into the conversation puts it in the
# history, and the history is resent on every turn. Past 20 images the per-image
# limit drops from 8000 px to 2000 px retroactively, so wide screenshots that
# worked all session start failing at once — and keep failing, because they stay
# in the history.
#
# Capturing from the clipboard instead means the image is read from a FILE. It
# never joins the conversation, so nothing accumulates. Press Win+Shift+S, then
# just say "look at my screen".
#
# -STA is required: the clipboard is a single-threaded-apartment API and returns
# nothing from the default MTA runspace.

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$image = [System.Windows.Forms.Clipboard]::GetImage()
if ($null -eq $image) {
    Write-Output "NO_IMAGE"
    exit 1
}

# Well under the 2000 px threshold, and enough to read a UI at.
$maxEdge = 1400
$scale = [Math]::Min(1.0, $maxEdge / [Math]::Max($image.Width, $image.Height))
$width = [int]($image.Width * $scale)
$height = [int]($image.Height * $scale)

$out = Join-Path $env:TEMP ("clip-" + (Get-Date -Format "HHmmss") + ".png")
$resized = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($resized)
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.DrawImage($image, 0, 0, $width, $height)
$resized.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$resized.Dispose()
$image.Dispose()

Write-Output $out
Write-Output ("{0}x{1}" -f $width, $height)
