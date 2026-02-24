# Windows OCR helper script for Familiar.
# Uses the Windows.Media.Ocr WinRT API (built into Windows 10+) to extract text from screenshots.
# Accepts one or more image paths as arguments and outputs JSON to stdout.
#
# IMPORTANT: Must run under Windows PowerShell 5.1 (powershell.exe), NOT PowerShell 7+ (pwsh.exe).
# WinRT type loading is not supported in PowerShell Core.
#
# Usage: powershell.exe -ExecutionPolicy Bypass -File windows-ocr.ps1 "image1.png" "image2.png"
#
# Output format (JSON):
# {
#   "results": {
#     "C:/path/to/image1.png": {
#       "meta": { "image_width": 1920, "image_height": 1080 },
#       "lines": ["Line of text", "Another line"],
#       "words": [
#         { "text": "Line", "x": 10, "y": 5, "w": 40, "h": 12 },
#         { "text": "of", "x": 55, "y": 5, "w": 20, "h": 12 },
#         ...
#       ]
#     },
#     "C:/path/to/image2.png": {
#       "error": "Failed to load image"
#     }
#   }
# }

param(
    [switch]$Preprocess,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ImagePaths
)

# Suppress progress bars (e.g. from Add-Type) that would pollute stdout.
$ProgressPreference = 'SilentlyContinue'

if (-not $ImagePaths -or $ImagePaths.Count -eq 0) {
    @{ results = @{} } | ConvertTo-Json -Depth 5
    exit 0
}

# --- Load WinRT assemblies ---

Add-Type -AssemblyName System.Runtime.WindowsRuntime

$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Foundation.IAsyncOperation`1, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.RandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]

# --- Async helper ---
# WinRT methods return IAsyncOperation<T> which PowerShell cannot natively await.
# We use reflection to call GetAwaiter().GetResult() synchronously.

$getAwaiterBaseMethod = [WindowsRuntimeSystemExtensions].GetMember('GetAwaiter').Where({
    $PSItem.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
}, 'First')[0]

function Await {
    param($AsyncTask, $ResultType)
    $getAwaiterBaseMethod.MakeGenericMethod($ResultType).Invoke($null, @($AsyncTask)).GetResult()
}

# --- Image preprocessing (optional) ---
# Converts image to high-contrast grayscale before OCR.
# Removes noise from syntax highlighting, UI chrome colours, and
# coloured backgrounds that can confuse the OCR engine on code/terminal content.
# Uses GDI+ ColorMatrix for grayscale and contrast boost.

if ($Preprocess) {
    Add-Type -AssemblyName System.Drawing
}

function PreprocessImage {
    param([string]$InputPath)

    if (-not $Preprocess) { return $InputPath }

    try {
        $img = [System.Drawing.Image]::FromFile($InputPath)

        # Create grayscale + contrast-boosted version using a ColorMatrix.
        # Standard luminance weights (ITU-R BT.601) with a slight contrast boost
        # via the matrix diagonal being >1.0 on the colour channels.
        $cm = New-Object System.Drawing.Imaging.ColorMatrix
        # Grayscale luminance weights, slightly boosted for contrast.
        $cm.Matrix00 = 0.35  # R contribution (standard: 0.299)
        $cm.Matrix01 = 0.35
        $cm.Matrix02 = 0.35
        $cm.Matrix10 = 0.55  # G contribution (standard: 0.587)
        $cm.Matrix11 = 0.55
        $cm.Matrix12 = 0.55
        $cm.Matrix20 = 0.15  # B contribution (standard: 0.114)
        $cm.Matrix21 = 0.15
        $cm.Matrix22 = 0.15
        $cm.Matrix33 = 1.0   # Alpha
        $cm.Matrix44 = 1.0   # W

        $attr = New-Object System.Drawing.Imaging.ImageAttributes
        $attr.SetColorMatrix($cm)

        $bmp = New-Object System.Drawing.Bitmap($img.Width, $img.Height)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.DrawImage(
            $img,
            (New-Object System.Drawing.Rectangle(0, 0, $img.Width, $img.Height)),
            0, 0, $img.Width, $img.Height,
            [System.Drawing.GraphicsUnit]::Pixel,
            $attr
        )
        $g.Dispose()
        $img.Dispose()

        # Save preprocessed image to a temp file (PNG for lossless quality).
        $tempPath = [System.IO.Path]::Combine(
            [System.IO.Path]::GetTempPath(),
            "familiar-preprocess-" + [System.IO.Path]::GetRandomFileName() + ".png"
        )
        $bmp.Save($tempPath, [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()

        return $tempPath
    }
    catch {
        # Preprocessing failed -- fall back to original image.
        return $InputPath
    }
}

# --- Create OCR engine (once, reused for all images) ---

$ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $ocrEngine) {
    # No OCR language pack installed. Output error for every image.
    $errorResults = @{}
    foreach ($imagePath in $ImagePaths) {
        $errorResults[$imagePath] = @{ error = 'No OCR language pack available on this system' }
    }
    @{ results = $errorResults } | ConvertTo-Json -Depth 5
    exit 0
}

# --- Process each image ---

$results = @{}

foreach ($imagePath in $ImagePaths) {
    try {
        $fullPath = (Resolve-Path $imagePath -ErrorAction Stop).Path

        # Optional preprocessing: convert to grayscale + contrast boost.
        $ocrInputPath = PreprocessImage $fullPath
        $isPreprocessed = ($ocrInputPath -ne $fullPath)

        # Load image: File -> Stream -> BitmapDecoder -> SoftwareBitmap
        $storageFile = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ocrInputPath)) ([Windows.Storage.StorageFile])
        $fileStream  = Await ($storageFile.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
        $decoder     = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($fileStream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $bitmap      = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

        # Extract image dimensions from the decoder.
        $imageWidth  = [int]$decoder.PixelWidth
        $imageHeight = [int]$decoder.PixelHeight

        # Run OCR.
        $ocrResult = Await ($ocrEngine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

        # Extract line text and word-level bounding boxes.
        # Strip ASCII control characters (0x00-0x1F) that the OCR engine occasionally
        # returns -- these break ConvertTo-Json and cause Node.js JSON.parse() to fail.
        $lineTexts = @()
        $wordData = @()
        foreach ($line in $ocrResult.Lines) {
            $lineTexts += ($line.Text -replace '[\x00-\x1f]', '')

            # Extract word-level bounding box data for layout inference.
            # Each OcrWord has .Text and .BoundingRect (x, y, width, height).
            foreach ($word in $line.Words) {
                $rect = $word.BoundingRect
                $wordData += @{
                    text = ($word.Text -replace '[\x00-\x1f]', '')
                    x    = [int]$rect.X
                    y    = [int]$rect.Y
                    w    = [int]$rect.Width
                    h    = [int]$rect.Height
                }
            }
        }

        $results[$imagePath] = @{
            meta  = @{
                image_width  = $imageWidth
                image_height = $imageHeight
            }
            lines = $lineTexts
            words = $wordData
        }

        # Clean up streams to avoid file locks.
        $fileStream.Dispose()

        # Clean up preprocessed temp file if we created one.
        if ($isPreprocessed -and (Test-Path $ocrInputPath)) {
            Remove-Item $ocrInputPath -Force -ErrorAction SilentlyContinue
        }
    }
    catch {
        $results[$imagePath] = @{ error = $_.Exception.Message }
        # Ensure temp file cleanup on error too.
        if ($isPreprocessed -and $ocrInputPath -and (Test-Path $ocrInputPath)) {
            Remove-Item $ocrInputPath -Force -ErrorAction SilentlyContinue
        }
    }
}

@{ results = $results } | ConvertTo-Json -Depth 6
