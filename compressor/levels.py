MIN_LEVEL = 1
MAX_LEVEL = 100
LOSSLESS_PNG_MAX_LEVEL = 10
MAX_PNG_COLORS = 256
MIN_PNG_COLORS = 16


def clamp(level: int) -> int:
    return max(MIN_LEVEL, min(MAX_LEVEL, level))


def jpeg_quality(level: int) -> int:
    return round(95 - level * 0.85)


def png_colors(level: int) -> int | None:
    if level <= LOSSLESS_PNG_MAX_LEVEL:
        return None
    progress = (level - LOSSLESS_PNG_MAX_LEVEL) / (MAX_LEVEL - LOSSLESS_PNG_MAX_LEVEL)
    return round(MAX_PNG_COLORS * (MIN_PNG_COLORS / MAX_PNG_COLORS) ** progress)


def pdf_image_dpi(level: int) -> int:
    return round(300 - level * 2.28)
