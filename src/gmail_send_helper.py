#!/usr/bin/env python3
"""Gmail send helper — reads HTML body from file and sends via Google Workspace OAuth."""

import sys
import json
import os
import argparse
from types import SimpleNamespace

# Add google_api.py to path
sys.path.insert(0, os.path.expanduser("~/.hermes/skills/productivity/google-workspace/scripts"))
from google_api import gmail_send

def main():
    parser = argparse.ArgumentParser(description="Send Gmail from file")
    parser.add_argument("--body-file", required=True, help="Path to HTML body file")
    parser.add_argument("--to", required=True, help="Recipients, comma-separated")
    parser.add_argument("--subject", required=True, help="Email subject")
    args = parser.parse_args()

    with open(args.body_file, "r") as f:
        html_body = f.read()

    # Build the args namespace to match what gmail_send expects
    send_args = SimpleNamespace(
        to=args.to,
        subject=args.subject,
        body=html_body,
        html=True,
        cc=None,
        from_header=None,
        thread_id=None,
    )

    gmail_send(send_args)

if __name__ == "__main__":
    main()
