import argparse
import io
import sys
import webbrowser
import zipfile
from pathlib import PurePath

from flask import Flask, Response, jsonify, request, send_file
from waitress import create_server
from werkzeug.exceptions import RequestEntityTooLarge

from compressor import CompressionError, compress

# Loopback only: the app must never be reachable from other machines.
HOST = "127.0.0.1"
DEFAULT_PORT = 8765
DEFAULT_LEVEL = 50
MAX_UPLOAD_BYTES = 1024 * 1024 * 1024

app = Flask(__name__, static_folder="static", static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES


@app.get("/")
def index():
    return app.send_static_file("index.html")


@app.post("/api/compress")
def compress_upload():
    upload = request.files.get("file")
    if upload is None:
        return _error("No file was received.", 400)
    level = request.form.get("level", DEFAULT_LEVEL, type=int)
    result = compress(upload.read(), level)
    return Response(result.data, mimetype=result.mimetype)


@app.post("/api/zip")
def zip_uploads():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_STORED) as archive:
        for upload in request.files.getlist("files"):
            archive.writestr(PurePath(upload.filename).name, upload.read())
    buffer.seek(0)
    return send_file(
        buffer,
        mimetype="application/zip",
        as_attachment=True,
        download_name="compressed-files.zip",
    )


@app.errorhandler(CompressionError)
def handle_compression_error(error: CompressionError):
    return _error(str(error), 422)


@app.errorhandler(RequestEntityTooLarge)
def handle_too_large(_error: RequestEntityTooLarge):
    return _error("File is too large (limit is 1 GB).", 413)


def _error(message: str, status: int):
    return jsonify(error=message), status


def main() -> None:
    parser = argparse.ArgumentParser(description="Compress PNG, JPEG and PDF files locally.")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--no-browser", action="store_true", help="don't open a browser tab")
    args = parser.parse_args()

    try:
        server = create_server(app, host=HOST, port=args.port)
    except OSError:
        sys.exit(f"Port {args.port} is busy. Try another one: ./run.sh --port {args.port + 1}")

    url = f"http://{HOST}:{args.port}"
    print(f"Local Compress is running at {url}  (press Ctrl+C to stop)", flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.run()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
