"""
Run this FIRST, before building anything else on top of it.

The whole staleness story depends on an unverified assumption: that two
retain() calls tagged with the same entity, submitted weeks apart, actually
get linked into one consolidated Observation by Hindsight. The docs don't
specify the entity-linking mechanism, so we test it directly.

Usage:
    python scripts/verify_consolidation.py

What to look for: the reflect() answer at the end should mention BOTH the
original guess AND the correction, and should be able to say what changed
between them. If it only reflects one of the two facts, tagging alone isn't
enough to link them -- see the project doc's "Verified Against the API"
section for the fallback plan.
"""
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from agent.hindsight_client import HindsightClient

ENTITY = "TestConsolidationMethod"


def main():
    hindsight = HindsightClient()

    print("1. Retaining an initial AI guess...")
    hindsight.retain(
        content=(
            f"{ENTITY} appears to charge a flat $1/day penalty fee after a "
            f"3-day grace period, based on reading the code."
        ),
        entities=[ENTITY],
        kind="world",
        metadata={"type": "code_derived_inference", "test": True},
    )

    print("2. Waiting 5s to simulate a real time gap...")
    time.sleep(5)

    print("3. Retaining a human correction on the SAME entity tag...")
    hindsight.retain(
        content=(
            f"Confirmed: {ENTITY} charges $1/day after a 3-day grace period, "
            f"but enterprise accounts are fully exempt from this fee."
        ),
        entities=[ENTITY],
        kind="world",
        metadata={"type": "human_validation", "validated_by": "test-script", "test": True},
    )

    print("4. Asking reflect() about it...")
    result = hindsight.reflect(
        question=f"What do we know about {ENTITY}? Has this been validated by a human?"
    )

    print("\n--- reflect() answer ---")
    print(result.get("text"))
    print("\n--- based_on ---")
    print(result.get("based_on"))
    print("\nCheck: does the answer mention BOTH the base fee logic AND the "
          "enterprise exemption, and does it distinguish the validated part "
          "from the inferred part? If yes, consolidation via entity tags "
          "works as assumed. If it only surfaces one fact, read the fallback "
          "plan in the project doc before building further.")


if __name__ == "__main__":
    main()