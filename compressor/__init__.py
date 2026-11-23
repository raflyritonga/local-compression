from collections.abc import Callable
from dataclasses import dataclass

from .errors import CompressionError
from .images import compress_jpeg, compress_png
from .levels import clamp
from .pdf import compress_pdf

__all__ = ["CompressionError", "CompressionResult", "compress"]

Compressor = Callable[[bytes, int], bytes]


@dataclass(frozen=True)
class CompressionResult:
    data: bytes
    mimetype: str


def compress(data: bytes, level: int) -> CompressionResult:
    mimetype, compressor = _detect(data)
    output = compressor(data, clamp(level))
    # Re-encoding an already lean file can grow it; never return something bigger.
    return CompressionResult(output if len(output) < len(data) else data, mimetype)


def _detect(data: bytes) -> tuple[str, Compressor]:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", compress_png
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", compress_jpeg
    if b"%PDF-" in data[:1024]:
        return "application/pdf", compress_pdf
    raise CompressionError("Unsupported file. Use PNG, JPG, JPEG or PDF.")
