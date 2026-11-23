import pymupdf

from .errors import CompressionError
from .levels import jpeg_quality, pdf_image_dpi


def compress_pdf(data: bytes, level: int) -> bytes:
    try:
        document = pymupdf.open(stream=data, filetype="pdf")
    except RuntimeError as error:
        raise CompressionError("This PDF is damaged or unreadable.") from error

    with document:
        if document.needs_pass:
            raise CompressionError("Password-protected PDFs are not supported.")
        target_dpi = pdf_image_dpi(level)
        document.rewrite_images(
            dpi_threshold=target_dpi + 1,
            dpi_target=target_dpi,
            quality=jpeg_quality(level),
            bitonal=False,
        )
        document.subset_fonts()
        return document.tobytes(
            garbage=4,
            clean=True,
            deflate=True,
            deflate_images=True,
            deflate_fonts=True,
            use_objstms=1,
        )
