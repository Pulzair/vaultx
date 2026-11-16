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

    if cmd == "detail":
        return {"ok": True, "detail": activity_detail(get_client(), req["activityId"])}

    if cmd == "wellness":
        return {"ok": True, "days": wellness(get_client(), int(req.get("days", 14)))}

    return {"error": f"Unknown command: {cmd}"}


def safe(fn, *args, **kwargs):
    """Garmin endpoints fail for days/devices without data; treat as empty."""
    try:
        return fn(*args, **kwargs)
    except Exception:
        return None


def activity_detail(g, activity_id):
    """Samples, laps and HR zones in the same shape VaultX stores for FIT files."""
    out = {"samples": {}, "laps": [], "zones": []}
    det = safe(g.get_activity_details, activity_id, maxchart=1500, maxpoly=0) or {}
    keys = {d["metricsIndex"]: d["key"] for d in det.get("metricDescriptors", [])}
    wanted = {
        "sumDuration": "t", "directHeartRate": "hr", "directSpeed": "speed",
        "directElevation": "alt", "directRunCadence": "cad", "directBikeCadence": "cad",
        "directDoubleCadence": "cad", "directPower": "pwr", "sumDistance": "dist",
    }
    cols = {}
    for row in det.get("activityDetailMetrics", []):
        metrics = row.get("metrics", [])
        for idx, key in keys.items():
            name = wanted.get(key)
            if name and idx < len(metrics):
                cols.setdefault(name, []).append(metrics[idx])
    if "t" in cols:
        out["samples"] = cols

    splits = safe(g.get_activity_splits, activity_id) or {}
    for lap in splits.get("lapDTOs", []):
        out["laps"].append({
            "durationS": lap.get("duration"), "distanceM": lap.get("distance"),
            "avgHr": lap.get("averageHR"), "maxHr": lap.get("maxHR"),
            "avgSpeed": lap.get("averageSpeed"), "ascentM": lap.get("elevationGain"),
            "cadence": lap.get("averageRunCadence") or lap.get("averageBikeCadence"),
            "avgPower": lap.get("averagePower"),
        })

    zones = safe(g.get_activity_hr_in_timezones, activity_id) or []
    if isinstance(zones, dict):  # shape differs between library versions
        zones = next((v for v in zones.values() if isinstance(v, list)), [])
    out["zones"] = [
        {"zone": z.get("zoneNumber"), "seconds": z.get("secsInZone"), "low": z.get("zoneLowBoundary")}
        for z in zones
    ]
    return out


def wellness(g, days):
    """One normalised record per day: sleep, HRV, resting HR, stress, Body Battery, steps."""
    out = []
    today = dt.date.today()
    for i in range(days):
        d = (today - dt.timedelta(days=i)).isoformat()
        rec = {"date": d}
        stats = safe(g.get_stats, d) or {}
        for src, dst in [
            ("restingHeartRate", "restingHr"), ("totalSteps", "steps"),
            ("averageStressLevel", "stressAvg"), ("bodyBatteryHighestValue", "bodyBatteryHigh"),
            ("bodyBatteryLowestValue", "bodyBatteryLow"), ("totalKilocalories", "kcalTotal"),
            ("activeKilocalories", "kcalActive"), ("floorsAscended", "floors"),
            ("moderateIntensityMinutes", "intensityModerate"),
            ("vigorousIntensityMinutes", "intensityVigorous"),
        ]:
            if stats.get(src) is not None:
                rec[dst] = stats[src]
        sleep = (safe(g.get_sleep_data, d) or {}).get("dailySleepDTO") or {}
        for src, dst in [
            ("sleepTimeSeconds", "sleepS"), ("deepSleepSeconds", "sleepDeepS"),
            ("lightSleepSeconds", "sleepLightS"), ("remSleepSeconds", "sleepRemS"),
            ("awakeSleepSeconds", "sleepAwakeS"),
        ]:
            if sleep.get(src) is not None:
                rec[dst] = sleep[src]
        score = ((sleep.get("sleepScores") or {}).get("overall") or {}).get("value")
        if score is not None:
            rec["sleepScore"] = score
        hrv = (safe(g.get_hrv_data, d) or {}).get("hrvSummary") or {}
        if hrv.get("lastNightAvg") is not None:
            rec["hrv"] = hrv["lastNightAvg"]
        if hrv.get("weeklyAvg") is not None:
            rec["hrvWeekly"] = hrv["weeklyAvg"]
        if hrv.get("status"):
            rec["hrvStatus"] = hrv["status"]
        if len(rec) > 1:
            out.append(rec)
    return out


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
