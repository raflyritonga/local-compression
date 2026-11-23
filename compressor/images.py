import io

import imagequant
from PIL import Image, ImageOps

from .errors import CompressionError
from .levels import jpeg_quality, png_colors

PRESERVED_INFO = ("icc_profile", "dpi")


def compress_jpeg(data: bytes, level: int) -> bytes:
    source = _load(data)
    # Bake the EXIF rotation into the pixels, since EXIF itself is dropped on save.
    image = ImageOps.exif_transpose(source)
    if image.mode not in ("L", "RGB", "CMYK"):
        image = image.convert("RGB")
    return _encode(
        image,
        "JPEG",
        quality=jpeg_quality(level),
        optimize=True,
        progressive=True,
        **_preserved_info(source),
    )


def compress_png(data: bytes, level: int) -> bytes:
    source = _load(data)
    if getattr(source, "is_animated", False):
        return data
    colors = png_colors(level)
    image = source if colors is None else imagequant.quantize_pil_image(source, max_colors=colors)
    return _encode(image, "PNG", optimize=True, **_preserved_info(source))


def _preserved_info(image: Image.Image) -> dict:
    return {key: image.info[key] for key in PRESERVED_INFO if key in image.info}


def _load(data: bytes) -> Image.Image:
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except (OSError, Image.DecompressionBombError) as error:
        raise CompressionError("This image is damaged or too large to process.") from error
    return image


def _encode(image: Image.Image, image_format: str, **options) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, image_format, **options)
    return buffer.getvalue()
