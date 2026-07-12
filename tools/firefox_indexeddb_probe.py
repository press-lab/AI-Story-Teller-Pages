import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path


FIREFOX = os.environ.get("FIREFOX_PATH", r"C:\Program Files\Mozilla Firefox\firefox.exe")
DEFAULT_APP_URL = os.environ.get("AIST_APP_URL", "https://press-lab.github.io/AI-Story-Teller/")


class Marionette:
    def __init__(self, port: int):
        self.port = port
        self.sock: socket.socket | None = None
        self.next_id = 1

    def connect(self, timeout: float = 20.0) -> None:
        deadline = time.time() + timeout
        last_error: Exception | None = None
        while time.time() < deadline:
            try:
                self.sock = socket.create_connection(("127.0.0.1", self.port), timeout=1)
                self._read_packet()
                return
            except Exception as error:
                last_error = error
                time.sleep(0.25)
        raise RuntimeError(f"Could not connect to Marionette: {last_error}")

    def close(self) -> None:
        if self.sock:
            self.sock.close()
            self.sock = None

    def _read_packet(self):
        assert self.sock is not None
        header = bytearray()
        while True:
            b = self.sock.recv(1)
            if not b:
                raise EOFError("socket closed while reading header")
            if b == b":":
                break
            header.extend(b)
        length = int(header.decode("ascii"))
        chunks = bytearray()
        while len(chunks) < length:
            chunk = self.sock.recv(length - len(chunks))
            if not chunk:
                raise EOFError("socket closed while reading body")
            chunks.extend(chunk)
        return json.loads(chunks.decode("utf-8"))

    def _send_packet(self, payload) -> None:
        assert self.sock is not None
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.sock.sendall(str(len(body)).encode("ascii") + b":" + body)

    def command(self, name: str, params=None):
        message_id = self.next_id
        self.next_id += 1
        self._send_packet([0, message_id, name, params or {}])
        while True:
            packet = self._read_packet()
            if isinstance(packet, list) and len(packet) >= 4 and packet[1] == message_id:
                error = packet[2]
                result = packet[3]
                if error:
                    raise RuntimeError(f"{name} failed: {error}")
                return result


READ_SCRIPT = r"""
const done = arguments[arguments.length - 1];
function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}
(async () => {
  const open = indexedDB.open("ai-story-teller", 1);
  const db = await requestToPromise(open);
  const tx = db.transaction("adventures", "readonly");
  const store = tx.objectStore("adventures");
  const adventures = await requestToPromise(store.getAll());
  db.close();
  done({
    href: location.href,
    count: adventures.length,
    adventures: adventures.map((adventure) => ({
      id: adventure.id,
      title: adventure.title,
      updatedAt: adventure.updatedAt,
      brains: (adventure.brains || []).map((brain) => ({
        characterName: brain.characterName,
        thoughts: Object.keys(brain.thoughts || {}).length,
        archivedThoughts: Object.keys(brain.archivedThoughts || {}).length
      }))
    }))
  });
})().catch((error) => done({ error: String(error && error.message || error), href: location.href }));
"""


def main() -> int:
    if len(sys.argv) not in (3, 4):
        print("usage: firefox_indexeddb_probe.py PROFILE_DIR PORT [APP_URL]", file=sys.stderr)
        print("optional env: FIREFOX_PATH, AIST_APP_URL", file=sys.stderr)
        return 2
    profile = Path(sys.argv[1]).resolve()
    port = int(sys.argv[2])
    app_url = sys.argv[3] if len(sys.argv) == 4 else DEFAULT_APP_URL
    env = os.environ.copy()
    env["MOZ_MARIONETTE_PORT"] = str(port)
    proc = subprocess.Popen(
        [FIREFOX, "--no-remote", "--headless", "--marionette", "--profile", str(profile), "about:blank"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )
    client = Marionette(port)
    try:
        try:
            client.connect()
        except Exception:
            if proc.poll() is not None:
                stdout, stderr = proc.communicate(timeout=2)
                raise RuntimeError(f"Firefox exited with {proc.returncode}\nSTDOUT:\n{stdout}\nSTDERR:\n{stderr}") from None
            raise
        client.command("WebDriver:NewSession", {"capabilities": {"alwaysMatch": {"acceptInsecureCerts": True}}})
        client.command("WebDriver:Navigate", {"url": app_url})
        time.sleep(3)
        result = client.command("WebDriver:ExecuteAsyncScript", {"script": READ_SCRIPT, "args": [], "newSandbox": False, "scriptTimeout": 30000})
        print(json.dumps(result, indent=2))
        try:
            client.command("Marionette:Quit", {"flags": ["eForceQuit"]})
        except Exception:
            pass
    finally:
        client.close()
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
