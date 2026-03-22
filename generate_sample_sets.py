#!/usr/bin/env python3
"""
Generate static sample sets for annotators from the master CSV.

Sorts by WER descending (worst first), takes the top N samples,
and alternates them into separate CSV files for each annotator.

Usage:
    python generate_sample_sets.py [--top N] [--splits S]

Defaults: top 1000, 2 splits (500 each).
"""

import csv
import argparse
import os
from pathlib import Path


def load_master_csv(csv_path):
    rows = []
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                row["WER"] = float(row["WER"])
                row["CER"] = float(row["CER"])
                row["snr_vad"] = float(row.get("snr_vad", 0))
                row["unique_words"] = int(float(row.get("unique_words", 0)))
                row["silence_percentage"] = float(row.get("silence_percentage", 0))
            except (ValueError, TypeError):
                continue
            rows.append(row)
    return rows


def main():
    parser = argparse.ArgumentParser(description="Generate annotator sample sets")
    parser.add_argument(
        "--input",
        default="Corrected Data Stats - sample stats (1).csv",
        help="Path to master CSV",
    )
    parser.add_argument(
        "--top", type=int, default=1000, help="Number of top-WER samples to take"
    )
    parser.add_argument(
        "--splits", type=int, default=2, help="Number of annotator splits"
    )
    parser.add_argument(
        "--prefix", default="split_annotator", help="Output file prefix"
    )
    args = parser.parse_args()

    script_dir = Path(__file__).parent
    input_path = script_dir / args.input

    if not input_path.exists():
        print(f"ERROR: Input CSV not found: {input_path}")
        return

    print(f"Loading {input_path} ...")
    rows = load_master_csv(str(input_path))
    print(f"  Loaded {len(rows)} valid rows")

    rows.sort(key=lambda r: r["WER"], reverse=True)

    top_rows = rows[: args.top]
    print(f"  Taking top {len(top_rows)} by WER (range: {top_rows[0]['WER']:.4f} - {top_rows[-1]['WER']:.4f})")

    fieldnames = ["key", "file_path", "snr_vad", "unique_words", "silence_percentage", "Transcript", "ElevenLabs", "WER", "CER"]

    splits = [[] for _ in range(args.splits)]
    for i, row in enumerate(top_rows):
        splits[i % args.splits].append(row)

    for idx, split_rows in enumerate(splits, start=1):
        out_name = f"{args.prefix}{idx}.csv"
        out_path = script_dir / out_name
        with open(out_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(split_rows)

        wers = [r["WER"] for r in split_rows]
        mean_wer = sum(wers) / len(wers) if wers else 0
        print(f"\n  {out_name}: {len(split_rows)} samples")
        print(f"    WER range: {min(wers):.4f} - {max(wers):.4f}, mean: {mean_wer:.4f}")

    print("\nDone.")


if __name__ == "__main__":
    main()
