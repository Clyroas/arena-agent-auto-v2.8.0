"""Dev-only static preview: opening the live preview root shows the opt-in glass study.

Run from the repository root: python3 dev/glass-preview-server.py
Never packaged with the Chrome extension; every other path is served unchanged.
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class PreviewHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/":
            self.send_response(302)
            self.send_header("Location", "/dev/preview.html?design=glass")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return
        super().do_GET()


if __name__ == "__main__":
    print("Liquid Glass study: http://0.0.0.0:8080/dev/preview.html?design=glass", flush=True)
    ThreadingHTTPServer(("0.0.0.0", 8080), PreviewHandler).serve_forever()
