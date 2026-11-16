"""VaultX <-> Garmin Connect helper.

Runs as a child process of the VaultX app. Reads one JSON request per line on
stdin and writes one JSON reply per line on stdout. Login tokens are cached in
the directory passed as argv[1]; the password itself is never stored.

Requests:
  {"cmd": "login", "email": "...", "password": "..."} -> {"ok": true} | {"mfa": true}
  {"cmd": "mfa", "code": "123456"}                  -> {"ok": true}
  {"cmd": "sync", "days": 30}                       -> {"ok": true, "activities": [...]}
Errors are returned as {"error": "message"}.
"""

import datetime as dt
import json
import os
import sys

try:
    from garminconnect import Garmin
except ImportError:  # reported on first request so the app can show it
    Garmin = None

TOKEN_DIR = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/.vaultx-garmin")

client = None
pending_mfa = None  # (client, state) while waiting for a one-time code


def save_tokens(g):
    os.makedirs(TOKEN_DIR, exist_ok=True)
    # garminconnect >= 0.3 has its own client; older versions used garth.
    store = getattr(g, "client", None) or getattr(g, "garth", None)
    store.dump(TOKEN_DIR)


def get_client():
    """Returns a logged-in client, resuming from cached tokens if possible."""
    global client
    if client is not None:
        return client
    if not os.path.isdir(TOKEN_DIR) or not os.listdir(TOKEN_DIR):
        raise RuntimeError("Not logged in to Garmin Connect")
    g = Garmin()
    g.login(TOKEN_DIR)
    client = g
    return g


def handle(req):
    global client, pending_mfa
    if Garmin is None:
        return {"error": "The garminconnect package is not installed in the helper environment"}
    cmd = req.get("cmd")

    if cmd == "login":
        g = Garmin(email=req["email"], password=req["password"], return_on_mfa=True)
        result, state = g.login()
        if result == "needs_mfa":
            pending_mfa = (g, state)
            return {"mfa": True}
        save_tokens(g)
        client = g
        return {"ok": True}

    if cmd == "mfa":
        if pending_mfa is None:
            return {"error": "No login is waiting for a code"}
        g, state = pending_mfa
        g.resume_login(state, req["code"])
        pending_mfa = None
        save_tokens(g)
        client = g
        return {"ok": True}

    if cmd == "sync":
        g = get_client()
        days = int(req.get("days", 30))
        end = dt.date.today()
        start = end - dt.timedelta(days=days)
        acts = g.get_activities_by_date(start.isoformat(), end.isoformat())
        return {"ok": True, "activities": acts}

    return {"error": f"Unknown command: {cmd}"}


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            reply = handle(json.loads(line))
        except Exception as e:  # report every failure back to the app
            reply = {"error": f"{type(e).__name__}: {e}"}
        sys.stdout.write(json.dumps(reply, default=str) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
