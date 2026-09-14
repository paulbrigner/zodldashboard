#!/usr/bin/env python3
"""Plan/apply narrow X Monitor runtime settings, preserving all other variables.

Defaults to read-only. Deploy the matching API and classifier code before --apply.
Requires an explicit private --backup-dir when applying changes.
"""
import argparse
import datetime
import json
import os
from pathlib import Path
import subprocess
import tempfile

POOL = {
    "PGPOOL_MAX": "2",
    "PGPOOL_IDLE_TIMEOUT_MS": "1000",
    "PGPOOL_CONNECTION_TIMEOUT_MS": "5000",
    "PGPOOL_MAX_LIFETIME_SECONDS": "60",
}
SETTINGS = {
    "xmonitor-vpc-api": (POOL, 10),
    "xmonitor-vpc-compose-worker": (POOL, 2),
    "xmonitor-vpc-email-scheduler": (POOL, 1),
    "xmonitor-x-significance-classifier": ({
        "XMON_SIGNIFICANCE_LLM_MODEL": "deepseek-v4-flash-0731",
        "XMON_SIGNIFICANCE_LLM_FALLBACK_MODELS": "z-ai-glm-5-3-flash",
        "XMON_SIGNIFICANCE_BATCH_SIZE": "4",
        "XMON_SIGNIFICANCE_LLM_MAX_ATTEMPTS": "2",
        "XMON_SIGNIFICANCE_LLM_INITIAL_BACKOFF_MS": "1000",
        "XMON_SIGNIFICANCE_VERSION": "ai_v3",
    }, 1),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--profile", default=os.environ.get("AWS_PROFILE", "zodldashboard"))
    parser.add_argument("--region", default=os.environ.get("AWS_REGION", "us-east-1"))
    parser.add_argument("--backup-dir", type=Path)
    parser.add_argument("--functions", nargs="+", choices=SETTINGS, default=list(SETTINGS))
    args = parser.parse_args()
    if args.apply and args.backup_dir is None:
        parser.error("--apply requires a private --backup-dir outside the repository")
    if args.apply:
        if args.backup_dir.resolve().is_relative_to(Path(__file__).resolve().parents[2]):
            parser.error("credential-bearing backups must be outside the repository")
        args.backup_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(args.backup_dir, 0o700)
    base = ["aws", "--profile", args.profile, "--region", args.region, "--output", "json"]

    def aws(*command):
        result = subprocess.run(base + list(command), check=True, capture_output=True, text=True)
        return json.loads(result.stdout) if result.stdout.strip() else {}

    for name in args.functions:
        config = aws("lambda", "get-function-configuration", "--function-name", name)
        concurrency = aws("lambda", "get-function-concurrency", "--function-name", name)
        desired, limit = SETTINGS[name]
        current = config.get("Environment", {}).get("Variables", {})
        changes = {key: value for key, value in desired.items() if current.get(key) != value}
        print(json.dumps({"function": name, "environment_changes": changes, "reserved_concurrency": limit, "apply": args.apply}), flush=True)
        if not args.apply:
            continue
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backup = args.backup_dir / f"{name}-{stamp}.json"
        with open(backup, "x", opener=lambda path, flags: os.open(path, flags, 0o600)) as stream:
            json.dump({"Configuration": config, "Concurrency": concurrency}, stream, indent=2)
        if changes:
            payload = {"FunctionName": name, "RevisionId": config["RevisionId"], "Environment": {"Variables": {**current, **desired}}}
            with tempfile.NamedTemporaryFile(mode="w+", suffix=".json") as stream:
                json.dump(payload, stream)
                stream.flush()
                aws("lambda", "update-function-configuration", "--cli-input-json", "file://" + stream.name)
            aws("lambda", "wait", "function-updated", "--function-name", name)
        if concurrency.get("ReservedConcurrentExecutions") != limit:
            aws("lambda", "put-function-concurrency", "--function-name", name, "--reserved-concurrent-executions", str(limit))
        live = aws("lambda", "get-function-configuration", "--function-name", name)
        actual = live.get("Environment", {}).get("Variables", {})
        if actual != {**current, **desired} or live.get("LastUpdateStatus") != "Successful":
            raise RuntimeError(f"Configuration verification failed for {name}")
        if aws("lambda", "get-function-concurrency", "--function-name", name).get("ReservedConcurrentExecutions") != limit:
            raise RuntimeError(f"Concurrency verification failed for {name}")
        print(json.dumps({"function": name, "verified": True}), flush=True)


if __name__ == "__main__":
    main()
