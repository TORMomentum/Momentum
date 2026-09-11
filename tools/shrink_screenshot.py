"""
Shrink a screenshot so it can be pasted into a Claude conversation safely.

    python tools/shrink_screenshot.py <image> [more images...]

WHY 2000 PIXELS. A conversation resends every image on every turn. While a
conversation holds 20 images or fewer, the per-image limit is 8000 px and a
full-window capture is fine. The moment it holds 21, a stricter limit applies
RETROACTIVELY TO EVERY IMAGE IN THE HISTORY: neither dimension may exceed
2000 px. Images that worked all session are suddenly rejected, and because they
stay in the history the failure repeats on every later turn.

So the fix is not to shrink the image that broke — it is to keep every image
under the threshold that changes the rule.

https://platform.claude.com/docs/en/build-with-claude/vision — "Request limits"
"""

import sys
from pathlib import Path

from PIL import Image

# The many-image threshold, from the vision documentation. Not a taste call:
# above this, the API rejects the image outright.
MAX_EDGE = 2000


def shrink(path: Path) -> None:
    with Image.open(path) as image:
        width, height = image.size
        if max(width, height) <= MAX_EDGE:
            print(f"{path.name}: {width}x{height} — already safe")
            return

        scale = MAX_EDGE / max(width, height)
        resized = image.resize((round(width * scale), round(height * scale)))
        out = path.with_name(f"{path.stem}-small{path.suffix}")
        resized.save(out)
        print(f"{path.name}: {width}x{height} → {resized.width}x{resized.height}  {out.name}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    for argument in sys.argv[1:]:
        shrink(Path(argument))
