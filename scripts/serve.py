#!/usr/bin/env python3
"""Sirve el juego desde este ordenador para que otros puedan entrar (en tu red o desde internet).

Uso:  python3 scripts/serve.py [puerto]      (por defecto 8000)

A diferencia de `python3 -m http.server`, solo publica los archivos del juego
(index.html, css, js, data y assets/web): nada de .git, scripts ni originales.
Escucha en todas las interfaces (0.0.0.0), no solo en localhost.
"""
import http.server
import os
import socket
import sys
from urllib.parse import unquote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALLOWED = ('/index.html', '/css/', '/js/', '/data/', '/assets/web/')


class GameHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def _allowed(self):
        path = unquote(self.path.split('?', 1)[0].split('#', 1)[0])
        if path == '/':
            return True
        return path.startswith(ALLOWED) and '/.' not in path and '..' not in path

    def do_GET(self):
        if not self._allowed():
            self.send_error(404)
            return
        super().do_GET()

    def do_HEAD(self):
        if not self._allowed():
            self.send_error(404)
            return
        super().do_HEAD()

    def list_directory(self, path):  # sin listados de carpetas
        self.send_error(404)
        return None

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')  # que los invitados vean siempre la última versión
        super().end_headers()


def lan_ip():
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        try:
            s.connect(('192.168.0.1', 1))  # no envía nada: solo elige la interfaz de salida
            return s.getsockname()[0]
        except OSError:
            return '127.0.0.1'


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    try:
        server = http.server.ThreadingHTTPServer(('0.0.0.0', port), GameHandler)
    except OSError:
        sys.exit(f'El puerto {port} ya está en uso. Cierra lo que lo use o elige otro: python3 scripts/serve.py 8080')
    print(f'Growing Season servido en el puerto {port}')
    print(f'  Tú (anfitrión):        http://localhost:{port}')
    print(f'  Tu red de casa:        http://{lan_ip()}:{port}')
    print(f'  Desde fuera de casa:   http://<tu IP pública>:{port}  (requiere abrir el puerto en el router)')
    print('Ctrl+C para parar.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
