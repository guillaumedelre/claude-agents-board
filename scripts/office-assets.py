"""Extract the office view sprites from the MetroCity packs by JIK-A-4.

Usage: python3 scripts/office-assets.py ~/Bureau/MetroCity
Writes web/public/office/. Coordinates match the sheets as downloaded from itch.io.
"""

import sys
from pathlib import Path

from PIL import Image

SRC = Path(sys.argv[1]).expanduser()
OUT = Path(__file__).resolve().parent.parent / "web" / "public" / "office"
OUT.mkdir(parents=True, exist_ok=True)


def load(rel):
    return Image.open(SRC / rel).convert("RGBA")


def save(im, name):
    im.save(OUT / name, optimize=True)


# Characters: body (6 skins), outfits (6) and hairs (8), 24 frames of 32x32 per row:
# down 0-5, right 6-11, up 12-17, left 18-23
save(load("MetroCity/CharacterModel/Character Model.png"), "body.png")
outfits = [load(f"MetroCity/Outfits/Outfit{i}.png") for i in range(1, 7)]
sheet = Image.new("RGBA", (768, 32 * len(outfits)))
for i, o in enumerate(outfits):
    sheet.paste(o, (0, 32 * i))
save(sheet, "outfits.png")
save(load("MetroCity/Hair/Hairs.png"), "hairs.png")

# Reception counter with a monitor; the medical cross is covered with the neighbouring panel
misc = load("Interior/Hospital/Miscellaneous-Sheet.png")
counter = misc.crop((2819, 15, 2941, 60))
counter.paste(counter.crop((25, 21, 49, 45)), (49, 21))
save(counter, "counter.png")

# Monitor alone: pixels that differ between the counter with and without it
plain = misc.crop((2691, 15, 2813, 60))
with_monitor = misc.crop((2819, 15, 2941, 60))
monitor = Image.new("RGBA", with_monitor.size)
a, b, m = plain.load(), with_monitor.load(), monitor.load()
for y in range(with_monitor.height):
    for x in range(with_monitor.width):
        if a[x, y] != b[x, y]:
            m[x, y] = b[x, y]
save(monitor.crop(monitor.getbbox()), "monitor.png")

save(load("Interior/Home/LivingRoom-Sheet.png").crop((25, 15, 71, 45)), "table.png")
save(load("Interior/Home/Cupboard-Sheet.png").crop((270, 20, 306, 63)), "bookshelf.png")
save(load("Interior/Home/Flowers-Sheet.png").crop((22, 3, 42, 46)), "plant.png")
save(load("Interior/Home/Doors-Sheet.png").crop((31, 15, 65, 64)), "door.png")
save(load("Interior/Home/Paintings-Sheet.png").crop((199, 7, 217, 28)), "painting.png")

tiles = load("Interior/Home/TilesHouse.png")
save(tiles.crop((16, 0, 64, 64)), "wall.png")
save(tiles.crop((96, 128, 128, 160)), "floor.png")

# Lounge: kitchen cabinet (coffee machine drawn in code), flat TV, low table (same as the desks), sofa seen from behind, carpet, floor lamp
save(load("Interior/Home/Kitchen-Sheet.png").crop((799, 21, 833, 55)), "cabinet.png")
save(load("Interior/Home/TV-Sheet.png").crop((136, 2, 184, 29)), "tv.png")
save(load("Interior/Home/LivingRoom1-Sheet.png").crop((120, 121, 168, 142)), "sofa.png")
save(load("Interior/Home/Carpet-Sheet.png").crop((128, 0, 192, 64)), "carpet.png")
save(load("Interior/Home/Lights-Sheet.png").crop((152, 0, 168, 32)), "lamp.png")
