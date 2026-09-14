#!/usr/bin/env python3
"""Plan/apply additional reliability alarms using the existing alert actions."""
import argparse
import json
import os
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--profile", default=os.environ.get("AWS_PROFILE", "zodldashboard"))
    parser.add_argument("--region", default=os.environ.get("AWS_REGION", "us-east-1"))
    args = parser.parse_args()
    base = ["aws", "--profile", args.profile, "--region", args.region, "--output", "json"]

    def aws(*command):
        output = subprocess.check_output(base + list(command))
        return json.loads(output) if output.strip() else {}

    reference = aws("cloudwatch", "describe-alarms", "--alarm-names", "xmonitor-api-5xx-spike")
    actions = reference["MetricAlarms"][0]["AlarmActions"]
    if not actions:
        raise RuntimeError("Existing X Monitor alert actions must be configured first")
    alarms = [
        ("xmonitor-rds-connections-high", "AWS/RDS", "DatabaseConnections", "DBInstanceIdentifier", "xmonitor-pg-beta", "Maximum", 70, "GreaterThanThreshold", 60, 1, 1,
         "Database connections exceeded 70; check API concurrency and warm connection pools before the database limit is reached."),
        ("xmonitor-rds-free-memory-low", "AWS/RDS", "FreeableMemory", "DBInstanceIdentifier", "xmonitor-pg-beta", "Minimum", 33554432, "LessThanThreshold", 60, 5, 3,
         "RDS free memory remained below 32 MiB in 3 of 5 minutes."),
        ("xmonitor-x-significance-classifier-exhausted-posts", "XMonitor/Classifier", "ExhaustedClassificationCount", "FunctionName", "xmonitor-x-significance-classifier", "Maximum", 0, "GreaterThanThreshold", 300, 3, 2,
         "Posts have exhausted classification attempts and require recovery; these are not included in retryable backlog."),
        ("xmonitor-x-significance-classifier-provider-overload", "XMonitor/Classifier", "ProviderOverloadCount", "FunctionName", "xmonitor-x-significance-classifier", "Sum", 10, "GreaterThanThreshold", 300, 3, 2,
         "Repeated provider HTTP 429 responses persist despite backoff and model fallback."),
        ("xmonitor-x-significance-classifier-apply-errors", "XMonitor/Classifier", "ApplyErrorCount", "FunctionName", "xmonitor-x-significance-classifier", "Sum", 0, "GreaterThanThreshold", 300, 3, 2,
         "Classification results repeatedly failed to persist, including stale-lease conflicts."),
    ]
    for name, namespace, metric, dimension, resource, stat, threshold, comparison, period, evaluations, datapoints, description in alarms:
        alarm = {"AlarmName": name, "AlarmDescription": description, "ActionsEnabled": True,
                 "AlarmActions": actions, "Namespace": namespace, "MetricName": metric,
                 "Dimensions": [{"Name": dimension, "Value": resource}], "Statistic": stat,
                 "Threshold": threshold, "ComparisonOperator": comparison, "Period": period,
                 "EvaluationPeriods": evaluations, "DatapointsToAlarm": datapoints, "TreatMissingData": "notBreaching"}
        print(json.dumps({"alarm": name, "threshold": threshold, "apply": args.apply}))
        if args.apply:
            with tempfile.NamedTemporaryFile(mode="w+", suffix=".json") as stream:
                json.dump(alarm, stream)
                stream.flush()
                aws("cloudwatch", "put-metric-alarm", "--cli-input-json", "file://" + stream.name)


if __name__ == "__main__":
    main()
