from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pitch-video"
SLIDES = OUT / "slides"
W, H = 1920, 1080

INK = (8, 15, 27)
INK_2 = (13, 28, 45)
MUTED = (146, 164, 181)
WHITE = (247, 250, 252)
GREEN = (0, 190, 110)
GREEN_LIGHT = (126, 246, 185)
LINE = (53, 76, 96)
PANEL = (18, 37, 56)


def font(size: int, weight: str = "regular") -> ImageFont.FreeTypeFont:
    names = {
        "regular": "segoeui.ttf",
        "semibold": "seguisb.ttf",
        "bold": "segoeuib.ttf",
    }
    return ImageFont.truetype(f"C:/Windows/Fonts/{names[weight]}", size)


def gradient(dark: bool = True) -> Image.Image:
    image = Image.new("RGB", (W, H))
    pixels = image.load()
    top = INK if dark else (249, 251, 252)
    bottom = (12, 35, 50) if dark else (232, 241, 242)
    for y in range(H):
        ratio = y / (H - 1)
        color = tuple(int(top[i] * (1 - ratio) + bottom[i] * ratio) for i in range(3))
        for x in range(W):
            pixels[x, y] = color
    return image


def text(draw: ImageDraw.ImageDraw, xy, value: str, size: int, fill=WHITE, weight="regular", anchor=None):
    draw.text(xy, value, fill=fill, font=font(size, weight), anchor=anchor)


def wrap(draw: ImageDraw.ImageDraw, value: str, width: int, size: int, fill=WHITE, weight="regular", gap=14):
    words = value.split()
    lines: list[str] = []
    current = ""
    probe = font(size, weight)
    for word in words:
        candidate = f"{current} {word}".strip()
        if draw.textlength(candidate, font=probe) <= width or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def paragraph(draw, xy, value: str, width: int, size=28, fill=MUTED, weight="regular", gap=16):
    x, y = xy
    for line in wrap(draw, value, width, size, fill, weight):
        draw.text((x, y), line, fill=fill, font=font(size, weight))
        y += size + gap
    return y


def rounded(draw, box, radius=18, fill=PANEL, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def brand(draw, x=86, y=70, dark=True, scale=1.0):
    mark_fill = (255, 255, 255) if dark else INK
    draw.rounded_rectangle(
        (x, y + 10 * scale, x + 28 * scale, y + 82 * scale),
        radius=int(14 * scale),
        fill=mark_fill,
    )
    draw.polygon(
        [
            (x + 8 * scale, y + 43 * scale),
            (x + 24 * scale, y + 59 * scale),
            (x + 57 * scale, y + 26 * scale),
            (x + 68 * scale, y + 38 * scale),
            (x + 25 * scale, y + 81 * scale),
        ],
        fill=GREEN,
    )
    text(draw, (x + 90 * scale, y + 18 * scale), "PasinPay", int(32 * scale), INK if not dark else WHITE, "semibold")


def top_label(draw, number: str, label: str, dark=True):
    color = GREEN_LIGHT if dark else GREEN
    text(draw, (86, 78), f"{number}  /  {label.upper()}", 18, color, "semibold")


def accent_lines(draw, dark=True):
    color = (30, 76, 91) if dark else (190, 221, 216)
    for offset in range(0, 4):
        y = 900 + offset * 28
        draw.line((86, y, 720 + offset * 90, y), fill=color, width=1)


def screenshot_card(path: Path, size: tuple[int, int], title: str | None = None) -> Image.Image:
    original = Image.open(path).convert("RGB")
    crop_h = int(original.height * 0.9)
    original = original.crop((0, 0, original.width, crop_h))
    original.thumbnail(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size[0] + 44, size[1] + 44), (0, 0, 0, 0))
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle((16, 18, size[0] + 28, size[1] + 30), radius=16, fill=(0, 0, 0, 110))
    shadow = shadow.filter(ImageFilter.GaussianBlur(14))
    canvas.alpha_composite(shadow)
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((10, 10, size[0] + 22, size[1] + 22), radius=14, fill=(255, 255, 255), outline=(214, 225, 228), width=2)
    canvas.paste(original, (22, 22))
    if title:
        ImageDraw.Draw(canvas).rounded_rectangle((30, 30, 30 + 260, 66), radius=10, fill=INK)
        text(ImageDraw.Draw(canvas), (48, 38), title, 16, WHITE, "semibold")
    return canvas


def slide_intro() -> Image.Image:
    image = gradient()
    draw = ImageDraw.Draw(image)
    brand(draw, 86, 70, True, 1.1)
    draw.ellipse((1240, 130, 2010, 900), outline=(24, 74, 88), width=2)
    draw.ellipse((1370, 260, 1880, 770), outline=(20, 106, 96), width=2)
    draw.ellipse((1510, 400, 1740, 630), fill=(0, 154, 112), outline=(114, 255, 190), width=2)
    draw.line((1070, 515, 1510, 515), fill=GREEN, width=4)
    text(draw, (86, 390), "Pay for shipped", 106, WHITE, "bold")
    text(draw, (86, 510), "code, automatically.", 106, WHITE, "bold")
    paragraph(draw, (92, 690), "A GitHub-native bounty escrow for verified work and programmable USDG settlement on Arbitrum.", 790, 32)
    text(draw, (92, 894), "Evidence in GitHub  •  Settlement on Arbitrum", 22, GREEN_LIGHT, "semibold")
    return image


def slide_problem() -> Image.Image:
    image = gradient()
    draw = ImageDraw.Draw(image)
    top_label(draw, "01", "The payment gap")
    text(draw, (86, 170), "Code ships.", 92, WHITE, "bold")
    text(draw, (86, 275), "Payment lags.", 92, GREEN_LIGHT, "bold")
    paragraph(draw, (90, 445), "Bounties promise alignment, but the proof and payment step still live in disconnected tools.", 720, 31)
    for index, (title, body) in enumerate(
        [
            ("Manual proof", "Screenshots and messages are easy to dispute."),
            ("Trust gap", "Creators need confidence before releasing funds."),
            ("Slow payout", "Contributors wait after the work is already merged."),
        ]
    ):
        x = 970 + (index % 2) * 385
        y = 235 + (index // 2) * 240
        rounded(draw, (x, y, x + 330, y + 170), 18, PANEL, LINE)
        text(draw, (x + 28, y + 28), f"0{index + 1}", 18, GREEN, "bold")
        text(draw, (x + 28, y + 68), title, 24, WHITE, "semibold")
        paragraph(draw, (x + 28, y + 111), body, 270, 17, MUTED, gap=7)
    accent_lines(draw)
    return image


def slide_create() -> Image.Image:
    image = gradient(False)
    draw = ImageDraw.Draw(image)
    top_label(draw, "02", "Create the condition", False)
    text(draw, (86, 160), "Fund the work", 72, INK, "bold")
    text(draw, (86, 246), "before it starts.", 72, GREEN, "bold")
    paragraph(draw, (90, 390), "Choose an installed repository, select an issue, and publish a clear USDG reward with a deadline and review window.", 630, 28, (71, 91, 101))
    shot = screenshot_card(ROOT / "output" / "playwright" / "01-home.png", (850, 478), "LIVE PRODUCT")
    image.paste(shot, (955, 225), shot)
    text(draw, (90, 850), "One condition. One escrow. One public source of truth.", 23, (44, 83, 82), "semibold")
    return image


def slide_pipeline() -> Image.Image:
    image = gradient()
    draw = ImageDraw.Draw(image)
    top_label(draw, "03", "Evidence becomes a claim")
    text(draw, (86, 160), "From merge", 70, WHITE, "bold")
    text(draw, (86, 245), "to payment.", 70, GREEN_LIGHT, "bold")
    steps = [
        ("GITHUB", "Issue + pull request"),
        ("VERIFY", "Repo, author, commit"),
        ("ATTEST", "Typed, signed claim"),
        ("ESCROW", "Review window"),
        ("USDG", "Arbitrum settlement"),
    ]
    y = 520
    for index, (title, body) in enumerate(steps):
        x = 105 + index * 355
        draw.ellipse((x, y, x + 88, y + 88), fill=GREEN if index == 4 else PANEL, outline=GREEN_LIGHT if index == 4 else GREEN, width=2)
        text(draw, (x + 44, y + 44), str(index + 1), 28, INK if index == 4 else GREEN_LIGHT, "bold", "mm")
        text(draw, (x, y + 120), title, 19, GREEN_LIGHT if index == 4 else WHITE, "semibold")
        paragraph(draw, (x, y + 161), body, 220, 17, MUTED, gap=5)
        if index < len(steps) - 1:
            draw.line((x + 100, y + 44, x + 320, y + 44), fill=LINE, width=3)
            draw.polygon([(x + 320, y + 44), (x + 304, y + 36), (x + 304, y + 52)], fill=GREEN)
    return image


def slide_discover() -> Image.Image:
    image = gradient(False)
    draw = ImageDraw.Draw(image)
    top_label(draw, "04", "Public work surface", False)
    text(draw, (86, 155), "Make good work", 68, INK, "bold")
    text(draw, (86, 235), "easy to find.", 68, GREEN, "bold")
    paragraph(draw, (90, 385), "Every bounty has a public page with its reward, status, linked GitHub issue, claims, settlement, and onchain details.", 610, 27, (71, 91, 101))
    shot = screenshot_card(ROOT / "output" / "playwright" / "02-bounties.png", (850, 478), "PUBLIC BOUNTIES")
    image.paste(shot, (955, 225), shot)
    text(draw, (90, 850), "Searchable. Shareable. Built for open-source work.", 23, (44, 83, 82), "semibold")
    return image


def slide_security() -> Image.Image:
    image = gradient()
    draw = ImageDraw.Draw(image)
    top_label(draw, "05", "Escrow rules")
    text(draw, (86, 160), "The contract", 68, WHITE, "bold")
    text(draw, (86, 242), "guards the promise.", 68, GREEN_LIGHT, "bold")
    paragraph(draw, (90, 385), "PasinPay uses EIP-712 attestations, nonce replay protection, recipient checks, creator approval, and a review window.", 660, 27)
    rounded(draw, (930, 180, 1790, 820), 22, PANEL, LINE, 2)
    text(draw, (990, 225), "CLAIM", 18, GREEN, "semibold")
    fields = [
        ("repositoryHash", "0x8c…a12f"),
        ("issueNumber", "#17"),
        ("prNumber", "#412"),
        ("commitHash", "8b72c4…"),
        ("recipient", "0xd3…0b50"),
        ("nonce", "one-time"),
    ]
    for index, (key, value) in enumerate(fields):
        y = 300 + index * 68
        draw.line((990, y + 46, 1730, y + 46), fill=(45, 67, 84), width=1)
        text(draw, (990, y), key, 20, MUTED, "regular")
        text(draw, (1555, y), value, 20, WHITE, "semibold")
    draw.ellipse((1430, 745, 1680, 995), fill=(0, 126, 92), outline=GREEN_LIGHT, width=2)
    text(draw, (1555, 870), "OK", 52, WHITE, "bold", "mm")
    return image


def slide_settlement() -> Image.Image:
    image = gradient(False)
    draw = ImageDraw.Draw(image)
    top_label(draw, "06", "Settlement", False)
    text(draw, (86, 160), "A real payment", 68, INK, "bold")
    text(draw, (86, 242), "on Arbitrum.", 68, GREEN, "bold")
    paragraph(draw, (90, 385), "After approval and the review window, the escrow releases USDG and links the result to a verifiable chain receipt.", 650, 28, (71, 91, 101))
    rounded(draw, (955, 170, 1775, 760), 22, (255, 255, 255), (205, 221, 220), 2)
    text(draw, (1010, 225), "SETTLEMENT RECEIPT", 18, GREEN, "semibold")
    text(draw, (1010, 290), "0.01 USDG", 54, INK, "bold")
    text(draw, (1010, 380), "Arbitrum Sepolia", 22, (71, 91, 101), "semibold")
    text(draw, (1010, 430), "Escrow", 16, (117, 137, 145))
    text(draw, (1010, 458), "0x1BC0…03D21", 22, INK, "semibold")
    text(draw, (1010, 535), "Transaction", 16, (117, 137, 145))
    text(draw, (1010, 563), "0xb338…f165d", 22, INK, "semibold")
    draw.rounded_rectangle((1010, 640, 1690, 704), radius=12, fill=(228, 248, 239))
    text(draw, (1050, 658), "PAID  •  receipt verified", 21, (0, 121, 77), "semibold")
    text(draw, (90, 850), "USDG reward. Arbitrum finality. A receipt anyone can inspect.", 23, (44, 83, 82), "semibold")
    return image


def slide_outcomes() -> Image.Image:
    image = gradient()
    draw = ImageDraw.Draw(image)
    top_label(draw, "07", "Why it matters")
    text(draw, (86, 160), "A better loop", 72, WHITE, "bold")
    text(draw, (86, 250), "for shipped work.", 72, GREEN_LIGHT, "bold")
    cards = [
        ("CREATORS", "Pay when the agreed work is verified.", "Predictable delivery"),
        ("CONTRIBUTORS", "Get a transparent path from merge to money.", "Fairer incentives"),
        ("PROTOCOL", "Preserve evidence, receipts, and trust.", "Durable infrastructure"),
    ]
    for index, (title, body, footer) in enumerate(cards):
        x = 86 + index * 580
        rounded(draw, (x, 500, x + 510, 790), 20, PANEL, LINE)
        text(draw, (x + 32, 540), title, 18, GREEN_LIGHT, "semibold")
        paragraph(draw, (x + 32, 600), body, 420, 27, WHITE, "semibold", gap=12)
        draw.line((x + 32, 710, x + 460, 710), fill=LINE, width=1)
        text(draw, (x + 32, 737), footer, 18, MUTED, "regular")
    return image


def slide_outro() -> Image.Image:
    image = gradient()
    draw = ImageDraw.Draw(image)
    brand(draw, 86, 70, True, 1.1)
    draw.ellipse((1320, 160, 1910, 750), outline=(29, 91, 99), width=2)
    draw.ellipse((1450, 290, 1780, 620), fill=(0, 148, 105), outline=GREEN_LIGHT, width=2)
    text(draw, (1615, 455), "P", 110, WHITE, "bold", "mm")
    text(draw, (86, 370), "Evidence in GitHub.", 76, WHITE, "bold")
    text(draw, (86, 470), "Settlement on Arbitrum.", 76, GREEN_LIGHT, "bold")
    text(draw, (90, 670), "PasinPay", 32, WHITE, "semibold")
    text(draw, (90, 735), "The testnet product is live.", 26, MUTED)
    text(draw, (90, 805), "pasinpay.upstand.dev", 28, GREEN_LIGHT, "semibold")
    return image


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    SLIDES.mkdir(parents=True, exist_ok=True)
    makers = [
        slide_intro,
        slide_problem,
        slide_create,
        slide_pipeline,
        slide_discover,
        slide_security,
        slide_settlement,
        slide_outcomes,
        slide_outro,
    ]
    for index, maker in enumerate(makers, start=1):
        maker().save(SLIDES / f"slide-{index:02d}.png")

    narration = [
        "PasinPay is pay for shipped code, automatically. It connects GitHub evidence to USDG settlement on Arbitrum.",
        "Today, bounties often rely on manual proof, informal promises, and delayed payment. Contributors ship value, then wait for someone to verify what happened.",
        "With PasinPay, a creator picks an installed GitHub repository, selects an issue, and funds a bounty in USDG. The reward condition is clear before work begins.",
        "When a pull request merges, PasinPay checks the repository, issue, pull request, commit, and author. The evidence becomes a signed, replay-resistant claim.",
        "Creators see the full public trail: the bounty, linked issue, claim, status, settlement, and onchain receipt. Search and filters make open work easy to discover.",
        "The escrow contract enforces the state machine. Creator approval starts the review window. Only the attested recipient can claim, and invalid transitions revert.",
        "After the review window closes, the escrow pays USDG on Arbitrum. The escrow lifecycle has been verified end to end on testnet, from funding to an Arbiscan-confirmed receipt.",
        "Creators get predictable delivery. Contributors get a transparent path to payment. The protocol gets a durable, verifiable record of work shipped.",
        "PasinPay: evidence in GitHub, settlement on Arbitrum. The testnet product is live at pasinpay dot upstand dot dev.",
    ]
    (OUT / "pitch-script.txt").write_text("\n\n".join(narration), encoding="utf-8")
    (OUT / "pitch-manifest.json").write_text(
        json.dumps({"resolution": [W, H], "slides": len(makers), "narration": narration}, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
