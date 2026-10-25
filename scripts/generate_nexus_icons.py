from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1] / "assets" / "images"
ROOT.mkdir(parents=True, exist_ok=True)
SIZE = 1024
BG_TOP = (7, 13, 25)
BG_BOTTOM = (13, 24, 45)
CYAN = (33, 200, 243)
VIOLET = (134, 105, 255)


def blend(a, b, t):
    return tuple(round(a[i] * (1 - t) + b[i] * t) for i in range(3))


def icon_base(size=SIZE):
    image = Image.new("RGB", (size, size))
    draw = ImageDraw.Draw(image)
    for y in range(size):
        t = y / max(1, size - 1)
        color = blend(BG_TOP, BG_BOTTOM, t)
        draw.line((0, y, size, y), fill=color)
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((size * .14, size * .10, size * .88, size * .88), fill=(40, 81, 166, 32))
    glow = glow.filter(ImageFilter.GaussianBlur(size * .13))
    image = Image.alpha_composite(image.convert("RGBA"), glow)
    draw = ImageDraw.Draw(image)
    draw.ellipse((size * .13, size * .13, size * .87, size * .87), outline=(65, 96, 145, 74), width=max(1, size // 500))
    draw.ellipse((size * .22, size * .22, size * .78, size * .78), outline=(95, 87, 165, 50), width=max(1, size // 650))
    return image


def mark_mask(size=SIZE, monochrome=False):
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    scale = size / SIZE
    points = [(300, 690), (300, 330), (724, 690), (724, 330)]
    points = [(round(x * scale), round(y * scale)) for x, y in points]
    width = round(92 * scale)
    draw.line(points, fill=255, width=width, joint="curve")
    radius = width // 2
    for x, y in (points[0], points[-1]):
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=255)
    # Small upward arrow: the Nexus identity's "level up" cue.
    ax, ay = round(512 * scale), round(294 * scale)
    aw, ah = round(48 * scale), round(36 * scale)
    arrow_width = max(3, round(24 * scale))
    draw.line((ax, ay + ah, ax, ay, ax - aw, ay + ah // 2), fill=255, width=arrow_width, joint="curve")
    draw.line((ax, ay, ax + aw, ay + ah // 2), fill=255, width=arrow_width, joint="curve")
    for x, y in ((ax - aw, ay + ah // 2), (ax, ay), (ax + aw, ay + ah // 2)):
        r = arrow_width // 2
        draw.ellipse((x - r, y - r, x + r, y + r), fill=255)
    return mask


def gradient_mark(mask, size=SIZE, monochrome=False):
    if monochrome:
        out = Image.new("RGBA", (size, size), (255, 255, 255, 0))
        out.paste((255, 255, 255, 255), (0, 0, size, size), mask)
        return out
    gradient = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(gradient)
    for x in range(size):
        t = x / max(1, size - 1)
        c = blend(CYAN, VIOLET, t)
        draw.line((x, 0, x, size), fill=(*c, 255))
    return Image.composite(gradient, Image.new("RGBA", (size, size), (0, 0, 0, 0)), mask)


def create_icon(size=SIZE, background=True, monochrome=False):
    if background:
        canvas = icon_base(size)
    else:
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mask = mark_mask(size, monochrome)
    mark = gradient_mark(mask, size, monochrome)
    return Image.alpha_composite(canvas.convert("RGBA"), mark)


# Main launcher, splash, and web icon: full-bleed square, no baked rounded corners.
create_icon(1024, background=True).convert("RGB").save(ROOT / "icon.png", optimize=True)
create_icon(1024, background=True).convert("RGB").save(ROOT / "splash-icon.png", optimize=True)
create_icon(512, background=True).convert("RGB").save(ROOT / "favicon.png", optimize=True)
# Android adaptive layers: keep the mark centered in the safe area; provide a separate monochrome glyph.
create_icon(1024, background=False).save(ROOT / "android-icon-foreground.png", optimize=True)
Image.new("RGB", (1024, 1024), BG_TOP).save(ROOT / "android-icon-background.png", optimize=True)
create_icon(432, background=False, monochrome=True).save(ROOT / "android-icon-monochrome.png", optimize=True)
print("Generated Nexus launcher, splash, favicon, and Android adaptive icon assets.")
